/**
 * notify-scheduler — per-minute push notification dispatcher (M2).
 *
 * Invoked every minute by pg_cron (via pg_net.http_post). Calls
 * get_pending_notifications(), dispatches to Expo Push API in batches of 100,
 * then records each successful send with record_notification_sent() so it
 * cannot re-fire on the next tick.
 *
 * Environment variables (set in Supabase Dashboard → Settings → Vault):
 *   SUPABASE_URL            — project REST URL
 *   SUPABASE_SERVICE_ROLE_KEY — bypasses RLS (needed to read all user devices)
 *   EXPO_ACCESS_TOKEN       — optional; for Enhanced Push on Expo servers
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BATCH_SIZE = 100; // Expo's recommended max per request

interface PendingNotification {
  event_id: string;
  owner_id: string;
  title: string;
  local_start: string;
  timezone_id: string;
  utc_start: string;
  expo_push_token: string;
  lead_time_minutes: number;
}

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: 'default';
  channelId: string;
}

Deno.serve(async (_req: Request) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const expoToken = Deno.env.get('EXPO_ACCESS_TOKEN'); // optional

  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const nowUtc = new Date().toISOString();

  // 1. Fetch all notifications due in the next minute.
  const { data: pending, error: fetchError } = await supabase
    .rpc('get_pending_notifications', { p_now: nowUtc })
    .returns<PendingNotification[]>();

  if (fetchError) {
    console.error('get_pending_notifications failed:', fetchError);
    return new Response(JSON.stringify({ error: fetchError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!pending || pending.length === 0) {
    return new Response(JSON.stringify({ dispatched: 0 }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 2. Build Expo push messages.
  const messages: (ExpoPushMessage & { _meta: PendingNotification })[] = pending.map((n) => ({
    to: n.expo_push_token,
    title: n.title ?? 'Upcoming event',
    body: formatLeadTimeBody(n.lead_time_minutes),
    data: { eventId: n.event_id },
    sound: 'default' as const,
    channelId: 'default',
    _meta: n,
  }));

  // 3. Dispatch in batches of 100.
  let dispatched = 0;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (expoToken) headers['Authorization'] = `Bearer ${expoToken}`;

  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);
    const payloads = batch.map(({ _meta: _m, ...msg }) => msg);

    let expoOk = false;
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(payloads),
      });
      expoOk = res.ok;
      if (!res.ok) {
        console.error('Expo batch failed', res.status, await res.text());
      }
    } catch (err) {
      console.error('Expo fetch error:', err);
    }

    if (expoOk) {
      // 4. Record each successful send to prevent re-dispatch.
      for (const msg of batch) {
        const { error: recErr } = await supabase.rpc('record_notification_sent', {
          p_event_id: msg._meta.event_id,
          p_expo_push_token: msg._meta.expo_push_token,
          p_lead_time_minutes: msg._meta.lead_time_minutes,
        });
        if (recErr) console.error('record_notification_sent failed:', recErr);
        else dispatched++;
      }
    }
  }

  return new Response(JSON.stringify({ dispatched, total: pending.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

function formatLeadTimeBody(minutes: number): string {
  if (minutes === 0) return 'Starting now';
  if (minutes < 60) return `Starting in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  return `Starting in ${hours} hour${hours === 1 ? '' : 's'}`;
}
