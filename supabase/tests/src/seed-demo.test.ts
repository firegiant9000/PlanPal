import { describe, expect, it } from 'vitest';
import { query } from './db';
import { ANON_KEY, SUPABASE_URL } from './harness';

/**
 * The demo seed's whole job is that a visitor lands on a populated calendar.
 * A fixed-date seed satisfies "rows exist" and still shows an empty month, so
 * these assertions are about WHEN the rows are, not merely that they are.
 */
describe('seed.demo.sql', () => {
  const DEMO_ID = '33333333-3333-3333-3333-333333333333';

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
