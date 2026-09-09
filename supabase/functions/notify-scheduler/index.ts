/**
 * notify-scheduler — per-minute push notification dispatcher (M2).
 *
 * Invoked every minute by pg_cron (via pg_net.http_post). For the current
 * minute it works out which event OCCURRENCES have a lead-time reminder due,
 * dispatches them through Expo Push, and records each send so it cannot
 * re-fire.
 *
 * Occurrence expansion goes through the shared `packages/recurrence` engine
 * (mirrored into `_shared/recurrence`). It is deliberately NOT done in SQL: a
 * third implementation of RRULE would diverge from the tested one, and
 * recurrence correctness is the project's #1 risk.
 *
 * Environment variables (Supabase Dashboard -> Settings -> Edge Functions):
 *   SUPABASE_URL              project REST URL
 *   SUPABASE_SERVICE_ROLE_KEY bypasses RLS (needed to read all users' events)
 *   CRON_SECRET               shared secret; callers must send it as
 *                             `X-Cron-Secret`. Without this the endpoint is
 *                             open to anyone holding the public anon key.
 *   EXPO_ACCESS_TOKEN         optional; for Enhanced Push on Expo servers
 */
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0';
import type { Database } from '../_shared/database.types.ts';
import {
  expandOccurrences,
  mapEventRow,
  UnsupportedRRuleError,
  type EventRow,
} from '../_shared/recurrence/index.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BATCH_SIZE = 100; // Expo's recommended max per request
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
/** notification_preferences bounds each lead time at 28 days. */
const MAX_LEAD_MINUTES = 40_320;

interface PrefRow {
  user_id: string;
  lead_times_minutes: number[];
  push_enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
}

interface DeviceRow {
  expo_push_token: string;
  user_id: string;
}

interface UserRow {
  id: string;
  timezone_id: string;
}

interface Candidate {
  eventId: string;
  occurrenceDate: string;
  title: string;
  utcStartMs: number;
  leadMinutes: number;
  token: string;
}

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

Deno.serve(async (req: Request) => {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const cronSecret = Deno.env.get('CRON_SECRET');
  const expoToken = Deno.env.get('EXPO_ACCESS_TOKEN'); // optional

  if (!supabaseUrl || !serviceKey || !cronSecret) {
    console.error('notify-scheduler misconfigured: missing SUPABASE_URL, service role key or CRON_SECRET');
    return jsonResponse({ error: 'Server misconfigured.' }, 500);
  }

  // This function dispatches pushes and writes to the database with the
  // service role. Supabase's default JWT check only proves the caller has the
  // (public) anon key, so require a shared secret as well.
  if (req.headers.get('X-Cron-Secret') !== cronSecret) {
    return jsonResponse({ error: 'Forbidden.' }, 403);
  }

  const supabase = createClient<Database>(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // The dispatch window is the current minute, plus a short lookback so a
  // missed tick (cold start, deploy, transient failure) does not silently drop
  // reminders forever. `notification_sends` makes the replay idempotent.
  const now = Date.now();
  const windowEndMs = Math.floor(now / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  const windowStartMs = windowEndMs - 5 * MINUTE_MS;

  let candidates: Candidate[];
  try {
    candidates = await collectCandidates(supabase, windowStartMs, windowEndMs);
  } catch (error) {
    console.error('candidate collection failed:', error);
    return jsonResponse({ error: 'Failed to collect notifications.' }, 500);
  }

  if (candidates.length === 0) {
    await pruneOccasionally(supabase);
    return jsonResponse({ dispatched: 0, candidates: 0 });
  }

  // Drop anything already sent. Done as one query rather than per-message.
  const fresh = await filterAlreadySent(supabase, candidates);
  if (fresh.length === 0) {
    await pruneOccasionally(supabase);
    return jsonResponse({ dispatched: 0, candidates: candidates.length });
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (expoToken) headers['Authorization'] = `Bearer ${expoToken}`;

  let dispatched = 0;
  const deadTokens = new Set<string>();

  for (let i = 0; i < fresh.length; i += BATCH_SIZE) {
    const batch = fresh.slice(i, i + BATCH_SIZE);
    const payloads = batch.map((c) => ({
      to: c.token,
      title: c.title,
      body: formatLeadTimeBody(c.leadMinutes),
      data: { eventId: c.eventId, occurrenceDate: c.occurrenceDate },
      sound: 'default' as const,
      channelId: 'default',
    }));

    let tickets: ExpoTicket[] | null = null;
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(payloads),
      });
      if (!res.ok) {
        console.error('Expo batch failed', res.status, await res.text());
      } else {
        const body = await res.json();
        tickets = Array.isArray(body?.data) ? (body.data as ExpoTicket[]) : null;
      }
    } catch (error) {
      console.error('Expo fetch error:', error);
    }

    if (!tickets) continue; // whole batch failed — leave unrecorded so it retries

    // Expo returns HTTP 200 with PER-MESSAGE status. Recording the whole batch
    // on `res.ok` alone (the previous behaviour) marked failed pushes as
    // delivered and never pruned dead tokens.
    const delivered: Candidate[] = [];
    tickets.forEach((ticket, idx) => {
      const candidate = batch[idx];
      if (!candidate) return;
      if (ticket.status === 'ok') {
        delivered.push(candidate);
        return;
      }
      console.error('Expo ticket error', ticket.details?.error, ticket.message);
      if (ticket.details?.error === 'DeviceNotRegistered') {
        deadTokens.add(candidate.token);
      }
    });

    if (delivered.length > 0) {
      const { error } = await supabase.from('notification_sends').upsert(
        delivered.map((c) => ({
          event_id: c.eventId,
          occurrence_date: c.occurrenceDate,
          expo_push_token: c.token,
          lead_time_minutes: c.leadMinutes,
        })),
        { onConflict: 'event_id,occurrence_date,expo_push_token,lead_time_minutes' },
      );
      if (error) console.error('recording sends failed:', error);
      else dispatched += delivered.length;
    }
  }

  // Expo tells us definitively when a token is gone; keeping it wastes a slot
  // in every future batch.
  if (deadTokens.size > 0) {
    const { error } = await supabase
      .from('devices').delete().in('expo_push_token', [...deadTokens]);
    if (error) console.error('pruning dead devices failed:', error);
  }

  await pruneOccasionally(supabase);

  // One line per tick, so M10's materialised-queue rewrite starts from measured
  // numbers rather than from guesses about where the time goes. §D's scale note
  // reasons that a few hundred rows and tens of milliseconds is fine at 200
  // users and that pre-empting it is not worth it — this is what would show
  // that reasoning going wrong, and at one line a minute it costs nothing.
  console.log(
    JSON.stringify({
      at: 'notify-scheduler.tick',
      durationMs: Date.now() - now,
      candidates: candidates.length,
      dispatched,
      deadTokens: deadTokens.size,
    }),
  );

  return jsonResponse({ dispatched, candidates: candidates.length, deadTokens: deadTokens.size });
});

// ---------------------------------------------------------------------------
// Candidate collection
// ---------------------------------------------------------------------------

/**
 * Work out every (occurrence, device, lead time) whose reminder instant falls
 * inside [windowStartMs, windowEndMs).
 */
async function collectCandidates(
  supabase: SupabaseClient<Database>,
  windowStartMs: number,
  windowEndMs: number,
): Promise<Candidate[]> {
  const { data: prefs, error: prefsErr } = await supabase
    .from('notification_preferences')
    .select('user_id,lead_times_minutes,push_enabled,quiet_hours_start,quiet_hours_end')
    .eq('push_enabled', true);
  if (prefsErr) throw prefsErr;
  if (!prefs || prefs.length === 0) return [];

  const userIds = (prefs as PrefRow[]).map((p) => p.user_id);

  const [devicesRes, usersRes] = await Promise.all([
    supabase.from('devices').select('expo_push_token,user_id').in('user_id', userIds),
    supabase.from('users').select('id,timezone_id').in('id', userIds),
  ]);
  if (devicesRes.error) throw devicesRes.error;
  if (usersRes.error) throw usersRes.error;

  const devicesByUser = new Map<string, string[]>();
  for (const d of (devicesRes.data ?? []) as DeviceRow[]) {
    const list = devicesByUser.get(d.user_id) ?? [];
    list.push(d.expo_push_token);
    devicesByUser.set(d.user_id, list);
  }
  const tzByUser = new Map<string, string>();
  for (const u of (usersRes.data ?? []) as UserRow[]) tzByUser.set(u.id, u.timezone_id);

  // Only users with at least one registered device can receive anything.
  const activeUsers = (prefs as PrefRow[]).filter(
    (p) => (devicesByUser.get(p.user_id)?.length ?? 0) > 0 && p.lead_times_minutes.length > 0,
  );
  if (activeUsers.length === 0) return [];

  // The furthest-out occurrence any lead time could reach.
  const maxLead = Math.min(
    Math.max(...activeUsers.flatMap((p) => p.lead_times_minutes)),
    MAX_LEAD_MINUTES,
  );
  const horizonEndMs = windowEndMs + maxLead * MINUTE_MS;

  // Expand in whole UTC days — a generous superset of the window, then filter
  // precisely on the computed fire instant below.
  const fromDate = isoDate(windowStartMs - DAY_MS);
  const toDate = isoDate(horizonEndMs + DAY_MS);

  const { data: eventRows, error: eventsErr } = await supabase
    .from('events')
    .select(EVENT_COLUMNS)
    .in('owner_id', activeUsers.map((p) => p.user_id))
    .or(
      `and(is_master.eq.true,utc_start.lt.${new Date(horizonEndMs + DAY_MS).toISOString()}),` +
      `and(is_master.eq.false,recurrence_exception_date.gte.${fromDate},recurrence_exception_date.lte.${toDate})`,
    );
  if (eventsErr) throw eventsErr;

  const rowsByOwner = new Map<string, EventRow[]>();
  for (const row of eventRows ?? []) {
    const list = rowsByOwner.get(row.owner_id) ?? [];
    list.push(row);
    rowsByOwner.set(row.owner_id, list);
  }

  const candidates: Candidate[] = [];

  for (const pref of activeUsers) {
    const rows = rowsByOwner.get(pref.user_id);
    if (!rows || rows.length === 0) continue;

    let occurrences;
    try {
      occurrences = expandOccurrences(rows.map(mapEventRow), { from: fromDate, to: toDate });
    } catch (error) {
      // One user's bad rule must not stop everyone else's reminders.
      if (error instanceof UnsupportedRRuleError) {
        console.error(`unsupported RRULE for user ${pref.user_id}:`, error.message);
        continue;
      }
      throw error;
    }

    const tz = tzByUser.get(pref.user_id) ?? 'UTC';
    const tokens = devicesByUser.get(pref.user_id) ?? [];

    for (const occ of occurrences) {
      const utcStartMs = Date.parse(occ.utcStart);
      if (Number.isNaN(utcStartMs)) continue;

      for (const lead of pref.lead_times_minutes) {
        const fireMs = utcStartMs - lead * MINUTE_MS;
        if (fireMs < windowStartMs || fireMs >= windowEndMs) continue;
        // Quiet hours are evaluated on the USER's profile timezone at the
        // moment the reminder would fire (the old query used the event's
        // timezone, which is a different thing for travel/imported events).
        if (inQuietHours(fireMs, tz, pref.quiet_hours_start, pref.quiet_hours_end)) continue;

        for (const token of tokens) {
          candidates.push({
            eventId: occ.eventId,
            occurrenceDate: occ.occurrenceDate,
            title: occ.title,
            utcStartMs,
            leadMinutes: lead,
            token,
          });
        }
      }
    }
  }

  return candidates;
}

/**
 * ONE single-quoted literal — see the same constant in occurrences/index.ts.
 * A concatenated select string widens to `string`, which collapses
 * supabase-js's row inference to `GenericStringError` and hides every genuine
 * mismatch between this query and the row type it is assigned to (AD-11).
 */
// deno-fmt-ignore
const EVENT_COLUMNS = 'id,owner_id,title,description,location,local_start,local_end,timezone_id,is_master,master_event_id,recurrence_exception_date,recurrence_rule,is_cancelled,is_variable_schedule,visibility,color_label';

/** Remove candidates already present in `notification_sends`. */
async function filterAlreadySent(
  supabase: SupabaseClient<Database>,
  candidates: Candidate[],
): Promise<Candidate[]> {
  const eventIds = [...new Set(candidates.map((c) => c.eventId))];
  const dates = [...new Set(candidates.map((c) => c.occurrenceDate))];

  const { data, error } = await supabase
    .from('notification_sends')
    .select('event_id,occurrence_date,expo_push_token,lead_time_minutes')
    .in('event_id', eventIds)
    .in('occurrence_date', dates);

  if (error) {
    // Fail closed: an unreadable ledger means we cannot prove a message is new.
    // Sending anyway risks duplicate pushes, which users notice immediately.
    console.error('reading notification_sends failed:', error);
    return [];
  }

  const sent = new Set(
    (data ?? []).map(
      (r: { event_id: string; occurrence_date: string; expo_push_token: string; lead_time_minutes: number }) =>
        `${r.event_id}:${r.occurrence_date}:${r.expo_push_token}:${r.lead_time_minutes}`,
    ),
  );

  return candidates.filter(
    (c) => !sent.has(`${c.eventId}:${c.occurrenceDate}:${c.token}:${c.leadMinutes}`),
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isoDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * True when `utcMs`, rendered in `timeZone`, falls inside the user's quiet
 * window. Handles overnight windows (22:00-07:00) as well as same-day ones.
 */
function inQuietHours(
  utcMs: number,
  timeZone: string,
  start: string | null,
  end: string | null,
): boolean {
  if (!start || !end) return false;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  const nowMinutes = get('hour') * 60 + get('minute');

  const toMinutes = (hhmm: string): number => {
    const [h, m] = hhmm.split(':');
    return Number(h) * 60 + Number(m ?? '0');
  };
  const startMin = toMinutes(start);
  const endMin = toMinutes(end);

  return startMin <= endMin
    ? nowMinutes >= startMin && nowMinutes < endMin
    : nowMinutes >= startMin || nowMinutes < endMin;
}

function formatLeadTimeBody(minutes: number): string {
  if (minutes === 0) return 'Starting now';
  if (minutes < 60) return `Starting in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  if (minutes < 1440) {
    const hours = Math.round(minutes / 60);
    return `Starting in ${hours} hour${hours === 1 ? '' : 's'}`;
  }
  const days = Math.round(minutes / 1440);
  return `Starting in ${days} day${days === 1 ? '' : 's'}`;
}

/** Cheap probabilistic retention — roughly once every ~200 ticks (~3 hours). */
async function pruneOccasionally(supabase: SupabaseClient<Database>): Promise<void> {
  if (Math.random() > 0.005) return;
  const { error } = await supabase.rpc('prune_notification_sends', { p_keep_days: 7 });
  if (error) console.error('prune_notification_sends failed:', error);
}
