import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from './db';
import {
  ANON_KEY,
  callFn,
  createTestUser,
  deleteTestUser,
  requireLocalStack,
  type TestUser,
} from './harness';

/**
 * notify-scheduler — the component whose Month 2 defect was "recurring events
 * notified exactly once", and which until now had **no test at all**.
 * `grep notify-scheduler supabase/tests/src` returned nothing.
 *
 * WHAT THIS PROVES: that a due occurrence is found, that quiet hours suppress
 * it, and that the shared secret is enforced.
 *
 * WHAT IT DOES NOT PROVE: delivery. The Expo token here is syntactically valid
 * and fake, so Expo answers `DeviceNotRegistered` and the `devices` row is
 * pruned. That exercises the dead-token path, not the push path. Only a real
 * token from a T25-Android dev build proves delivery, and that is MVP gate #3.
 *
 * The handler needs `CRON_SECRET` in the runtime. The Edge runtime reads
 * function env vars from `supabase/functions/.env` at `supabase start`, so that
 * file must exist BEFORE the stack starts — a container restart will not pick
 * it up. See docs/TESTING.md.
 */

const CRON_SECRET = process.env.CRON_SECRET ?? 'test-cron-secret';

/** Syntactically valid, deliberately unregistered. */
const FAKE_TOKEN_PREFIX = 'ExponentPushToken[planpal-it-';

interface TickResult {
  dispatched: number;
  candidates: number;
  deadTokens?: number;
}

async function tick(secret: string | null) {
  // `apikey` explicitly: this route is gated on the shared secret rather than
  // on a user JWT, so there is no `token` to route it through Kong — and Kong
  // rejects a request carrying neither before the handler ever runs.
  return callFn<TickResult>('notify-scheduler', {
    method: 'POST',
    body: {},
    headers: { apikey: ANON_KEY, ...(secret === null ? {} : { 'X-Cron-Secret': secret }) },
  });
}

const MINUTE_MS = 60_000;

/**
 * An occurrence start whose reminder instant lands **deterministically** inside
 * the handler's dispatch window.
 *
 * The handler dispatches for
 * `[floor(now/min)*min - 4min, floor(now/min)*min + 1min)` and fires a reminder
 * at `occurrenceStart - leadMinutes`. Computing the start as "now + 90s" is
 * therefore a coin flip: with a 1-minute lead the reminder lands past the
 * window's end whenever the wall-clock second is ≥ 30. That is not a
 * hypothetical — it is how the first version of this spec failed, and it is the
 * flake the plan's own risk note warns about.
 *
 * Anchoring 90 s before the *next minute boundary* puts the reminder 90 s inside
 * a 5-minute lookback whatever second the suite starts on, and it stays inside
 * even if the request itself crosses the boundary.
 */
function startForReminderInsideWindow(leadMinutes: number): number {
  const boundary = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  const fireMs = boundary - 90_000;
  return fireMs + leadMinutes * MINUTE_MS;
}

/**
 * A user with push on, one device, one lead time, and an event whose next
 * occurrence's reminder is due in this tick.
 */
async function seedDueReminder(opts: {
  label: string;
  leadMinutes: number;
  quietHours?: { start: string; end: string };
  recurring?: boolean;
}): Promise<TestUser> {
  const user = await createTestUser(opts.label);
  const token = `${FAKE_TOKEN_PREFIX}${opts.label}-${Date.now()}]`;

  // UTC throughout, so the quiet-hours window below is unambiguous.
  await query(
    `update public.users set timezone_id = 'UTC' where id = '${user.id}';
     insert into public.devices (expo_push_token, user_id, platform)
       values ('${token}', '${user.id}', 'android');
     update public.notification_preferences
        set push_enabled = true,
            lead_times_minutes = array[${opts.leadMinutes}],
            quiet_hours_start = ${opts.quietHours ? `'${opts.quietHours.start}'` : 'null'},
            quiet_hours_end   = ${opts.quietHours ? `'${opts.quietHours.end}'` : 'null'}
      where user_id = '${user.id}';`,
  );

  const startMs = startForReminderInsideWindow(opts.leadMinutes);
  const localStart = new Date(startMs).toISOString().slice(0, 19);
  const localEnd = new Date(startMs + 30 * MINUTE_MS).toISOString().slice(0, 19);

  await query(
    `insert into public.events
       (owner_id, title, local_start, local_end, timezone_id, is_master,
        recurrence_rule, visibility)
     values ('${user.id}', 'Standup', '${localStart}', '${localEnd}', 'UTC', true,
             ${opts.recurring ? `'FREQ=DAILY'` : 'null'}, 'private');`,
  );

  return user;
}

const created: TestUser[] = [];

beforeAll(async () => {
  await requireLocalStack();
});

afterAll(async () => {
  for (const user of created) await deleteTestUser(user.id);
});

describe('notify-scheduler', () => {
  it('finds a candidate for a recurring event inside the lead window', async () => {
    const user = await seedDueReminder({
      label: 'sched-due',
      leadMinutes: 5,
      recurring: true,
    });
    created.push(user);

    const res = await tick(CRON_SECRET);

    expect(res.status, res.text.slice(0, 300)).toBe(200);
    const body = JSON.parse(res.text) as TickResult;
    expect(body.candidates).toBeGreaterThanOrEqual(1);
  });

  it('suppresses a candidate inside quiet hours', async () => {
    // Comparative, not absolute, and deliberately so. Asserting "no candidate
    // while quiet hours are set" passes just as well when the reminder was
    // never due at all — which is exactly how the first version of this test
    // passed against a seed whose reminder fell outside the dispatch window.
    // Toggling quiet hours on the SAME user, in the same minute, makes the
    // difference attributable to quiet hours and nothing else.
    const user = await seedDueReminder({
      label: 'sched-quiet',
      leadMinutes: 5,
      recurring: true,
      quietHours: { start: '00:00', end: '23:59' },
    });
    created.push(user);

    const suppressed = JSON.parse((await tick(CRON_SECRET)).text) as TickResult;

    await query(
      `update public.notification_preferences
          set quiet_hours_start = null, quiet_hours_end = null
        where user_id = '${user.id}'`,
    );
    const released = JSON.parse((await tick(CRON_SECRET)).text) as TickResult;

    expect(released.candidates).toBeGreaterThan(suppressed.candidates);
  });

  it('rejects a wrong X-Cron-Secret with 403', async () => {
    const res = await tick('not-the-secret');

    expect(res.status).toBe(403);
    expect(res.text).toContain('Forbidden');
  });

  it('rejects a missing X-Cron-Secret with 403', async () => {
    // Supabase's own JWT check only proves the caller holds the public anon
    // key, so the header is the only thing standing between the internet and a
    // service-role dispatcher.
    const res = await tick(null);

    expect(res.status).toBe(403);
  });
});

/**
 * The 500 branch cannot be asserted in the same stack run as the tests above:
 * `CRON_SECRET` is either present in the runtime or it is not, and the runtime
 * reads it once at `supabase start`.
 *
 * Rather than leave a test that passes vacuously, the procedure is written down
 * and its result recorded here:
 *
 *   rm supabase/functions/.env
 *   pnpm db:stop && pnpm db:start
 *   curl -s -X POST -H "apikey: <anon>" -H "X-Cron-Secret: anything" \
 *     http://127.0.0.1:54321/functions/v1/notify-scheduler
 *   -> HTTP 500 {"error":"Server misconfigured."}
 *
 * Verified 2026-09-08. That 500, and its transition to 403 once the file is
 * restored, is also the only proof that the Edge runtime reads
 * `supabase/functions/.env` at all — an inference, until observed.
 */
it.skip('returns 500 when CRON_SECRET is absent from the runtime', () => {
  // Intentionally skipped — see the comment above for the manual procedure and
  // its recorded result. It cannot coexist with the specs above in one run.
});
