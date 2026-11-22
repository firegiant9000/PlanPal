import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPlanPalClient } from '@planpal/api-client';
import { beforeAll, describe, expect, it } from 'vitest';
import { exec, query } from './db';
import { ANON_KEY, SUPABASE_URL } from './harness';

/**
 * Applied here rather than assumed to be present.
 *
 * `supabase db reset` runs seed.sql, not seed.demo.sql — the demo seed is
 * applied explicitly, and nothing in ci.yml applies it. An earlier version of
 * this file passed locally only because the seed happened to have been run by
 * hand, and failed in CI. Applying it is also the honest arrangement: the
 * subject under test is this file, so a syntax error in it now fails here.
 */
const SEED_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../seed.demo.sql');

/**
 * The demo seed's whole job is that a visitor lands on a populated calendar.
 * A fixed-date seed satisfies "rows exist" and still shows an empty month, so
 * these assertions are about WHEN the rows are, not merely that they are.
 */
describe('seed.demo.sql', () => {
  const DEMO_ID = '33333333-3333-3333-3333-333333333333';

  beforeAll(async () => {
    await exec(readFileSync(SEED_PATH, 'utf8'));
  });

  it('gives the demo user events inside the current week', async () => {
    const rows = await query<{ n: number }>(
      `select count(*)::int as n from public.events
        where owner_id = $1
          and local_start >= date_trunc('week', now())::timestamp
          and local_start < (date_trunc('week', now()) + interval '7 days')::timestamp`,
      [DEMO_ID],
    );
    expect(rows[0]?.n).toBeGreaterThan(0);
  });

  it('confirms the demo account so it needs no confirmation email', async () => {
    const rows = await query<{ email_confirmed_at: Date | null }>(
      `select email_confirmed_at from auth.users where id = $1`,
      [DEMO_ID],
    );
    // The length assertion is load-bearing: with no demo user the query returns
    // no rows, and `rows[0]?.email_confirmed_at` would be undefined — which
    // `.not.toBeNull()` happily accepts. Without this, a missing account passes.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email_confirmed_at).not.toBeNull();
  });

  it('lets the published demo credentials actually sign in', async () => {
    // The row assertions above all pass against an account GoTrue cannot
    // authenticate. Inserting into auth.users directly leaves
    // confirmation_token, recovery_token, email_change_token_new and
    // email_change NULL — they are the four string columns with no default —
    // and GoTrue scans them into non-nullable Go strings, so every sign-in
    // fails with 500 "Database error querying schema". The demo button calls
    // this exact endpoint, so this is the assertion that matches the feature.
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'demo@planpal.app', password: 'planpal-demo' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { access_token?: string };
    expect(body.access_token).toBeTruthy();
  });

  it('serves the demo calendar through api-client, the way the web app loads it', async () => {
    // The assertions above all read the database directly, so they pass even
    // when no client can render the calendar. This drives the exact path
    // apps/web/src/app/calendar/page.tsx takes — occurrences.range() over a
    // month grid window, which spans three calendar months and therefore
    // exercises the multi-month loop rather than a single request.
    const client = createPlanPalClient({ supabaseUrl: SUPABASE_URL, anonKey: ANON_KEY });
    await client.auth.signInWithPassword('demo@planpal.app', 'planpal-demo');

    // Every demo event is anchored to date_trunc('week', now()) at seed time.
    // Read that anchor back from the seeded Standup master (local_start is
    // Monday 09:30) rather than recomputing it in JS: the DB's timezone and a
    // week boundary crossed between seeding and this test cannot make the
    // window disagree with the rows.
    const anchorRows = await query<{ monday: string }>(
      `select to_char(local_start::date, 'YYYY-MM-DD') as monday
         from public.events
        where owner_id = $1 and is_master and title = 'Standup'`,
      [DEMO_ID],
    );
    expect(anchorRows).toHaveLength(1);
    const monday = anchorRows[0]!.monday;
    const plusDays = (days: number): string => {
      const d = new Date(`${monday}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    };

    // Monday-7d .. Monday+35d spans the seeded week and five more recurrences.
    const occurrences = await client.occurrences.range(plusDays(-7), plusDays(35));

    const titles = occurrences.map((o) => o.title);
    expect(titles).toContain('Coffee with Sam');
    expect(titles).toContain('Standup (moved)');
    // The cancelled Friday (Monday+4) must not come back as an occurrence...
    const dates = occurrences.map((o) => o.occurrenceDate);
    expect(dates).not.toContain(plusDays(4));
    // ...while its non-cancelled neighbours do, so the absence above is real
    // and not an artefact of the window missing the series.
    expect(dates).toContain(plusDays(0));
    expect(dates).toContain(plusDays(2));
    expect(dates).toContain(plusDays(7 + 4));
  });

  it('keeps a recurring master with both an override and a cancellation', async () => {
    const rows = await query(
      `select
         count(*) filter (where is_master and recurrence_rule is not null)::int as masters,
         count(*) filter (where not is_master and not is_cancelled
                            and recurrence_exception_date is not null)::int as overrides,
         count(*) filter (where is_cancelled)::int as cancellations
       from public.events where owner_id = $1`,
      [DEMO_ID],
    );
    expect(rows[0]).toMatchObject({ masters: 1, overrides: 1, cancellations: 1 });
  });
});
