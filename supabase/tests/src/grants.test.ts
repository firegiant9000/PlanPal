import { beforeAll, describe, expect, it } from 'vitest';
import { query } from './db';
import { requireLocalStack } from './harness';

/**
 * Database-level security audits (§13).
 *
 * Month 2 shipped a `SECURITY DEFINER` function readable by any authenticated
 * user. The M2 review then wrote the rule down — "every SECURITY DEFINER
 * function ships with `revoke execute from public, anon, authenticated` in the
 * same migration" (§15) — fixed one function, and missed three others, one of
 * which let any signed-in user delete another user's birthday event and its
 * occurrence overrides. Writing a rule down does not enforce it.
 *
 * The `20260902000001` migration asserts this invariant too, but only at its
 * own point in the chain: a migration dated *after* it could reintroduce a bad
 * grant and that assertion would never run again. This checks the final state
 * after every migration has applied, which is the state that ships.
 */

const END_USER_ROLES = ['public', 'anon', 'authenticated'] as const;

/**
 * The only SECURITY DEFINER functions an end-user role may execute, each with
 * the reason it is safe. Anything not listed here is a finding.
 *
 * Adding an entry is a deliberate, reviewable act. Forgetting a `revoke` is
 * not — that asymmetry is the whole point of the audit, and it is why this is
 * an allowlist rather than a looser rule.
 */
const ALLOWED_END_USER_SECDEF: Record<string, string> = {
  'public.delete_me() -> authenticated':
    'GDPR erasure must be callable by the account holder, and a user-scoped ' +
    'client has no rights in the auth schema. The function takes no arguments ' +
    'and reads auth.uid() internally, so every caller can only delete ' +
    'themselves — there is no target to point elsewhere.',
};

/** User-facing tables: RLS enabled *and* at least one policy. */
const RLS_TABLES = [
  'users',
  'events',
  'devices',
  'friend_codes',
  'friend_connections',
  'notification_preferences',
] as const;

/**
 * `notification_sends` is deliberately excluded from the rule above. It is
 * scheduler bookkeeping, not user data, and `20260901000002` states the intent
 * outright: "RLS is already enabled with no policies (service-role only)".
 * RLS with zero policies denies every non-BYPASSRLS role, which is the whole
 * design. It gets its own assertions below.
 */
const DENY_ALL_TABLES = ['notification_sends'] as const;

beforeAll(async () => {
  await requireLocalStack();
});

describe('SECURITY DEFINER grant audit', () => {
  it('has no SECURITY DEFINER function executable by public, anon or authenticated', async () => {
    const rows = await query<{ fn: string; role: string }>(
      `
      select format('%I.%I(%s)', n.nspname, p.proname,
                    pg_get_function_identity_arguments(p.oid)) as fn,
             r.role
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        cross join unnest($1::text[]) as r(role)
       where p.prosecdef
         and n.nspname = 'public'
         and has_function_privilege(r.role, p.oid, 'EXECUTE')
       order by 1, 2
      `,
      [END_USER_ROLES],
    );

    // Name the offenders in the failure, not just a count — the M2 fix missed
    // three functions precisely because nothing listed them.
    const found = rows.map((r) => `${r.fn} -> ${r.role}`);
    const unexplained = found.filter((entry) => !(entry in ALLOWED_END_USER_SECDEF));
    expect(unexplained).toEqual([]);
  });

  it('the allowlist has no stale entries', async () => {
    // An allowlist that outlives the grant it excuses is worse than none: it
    // quietly pre-approves whatever takes that name next.
    const rows = await query<{ fn: string; role: string }>(
      `
      select format('%I.%I(%s)', n.nspname, p.proname,
                    pg_get_function_identity_arguments(p.oid)) as fn,
             r.role
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        cross join unnest($1::text[]) as r(role)
       where p.prosecdef
         and n.nspname = 'public'
         and has_function_privilege(r.role, p.oid, 'EXECUTE')
      `,
      [END_USER_ROLES],
    );
    const found = new Set(rows.map((r) => `${r.fn} -> ${r.role}`));
    for (const entry of Object.keys(ALLOWED_END_USER_SECDEF)) {
      expect(found.has(entry), `allowlist entry no longer applies: ${entry}`).toBe(true);
    }
  });

  it('delete_me is the only allowed exception, and it takes no target', async () => {
    // The allowlist's justification rests on the signature: a function with no
    // parameter cannot be aimed at another account. If someone adds one, the
    // reasoning collapses and this fails.
    const [row] = await query<{ args: string }>(
      `
      select pg_get_function_identity_arguments(p.oid) as args
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'delete_me'
      `,
    );
    expect(row?.args).toBe('');
    expect(Object.keys(ALLOWED_END_USER_SECDEF)).toHaveLength(1);
  });

  it('still exposes those functions to the roles that legitimately need them', async () => {
    // The audit above passes trivially if the functions were dropped, or if
    // every grant were revoked and the triggers broke. Assert the positive.
    const rows = await query<{ proname: string }>(
      `
      select p.proname
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where p.prosecdef and n.nspname = 'public'
       order by 1
      `,
    );
    const names = rows.map((r) => r.proname);
    expect(names).toContain('handle_new_user');
    expect(names).toContain('sync_birthday_event');

    const ownerCanExecute = await query<{ ok: boolean }>(
      `select has_function_privilege('postgres', 'public.sync_birthday_event(uuid)', 'EXECUTE') as ok`,
    );
    expect(ownerCanExecute[0]?.ok).toBe(true);
  });

  it('keeps the signup trigger working, which is what the grants must not break', async () => {
    // A revoke that broke `handle_new_user` would show up as a missing profile
    // row rather than an error, so check the trigger is still attached.
    const rows = await query<{ tgname: string }>(
      `
      select t.tgname
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'auth' and c.relname = 'users' and not t.tgisinternal
      `,
    );
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('RLS is enabled with policies', () => {
  it.each(RLS_TABLES)('%s has row security enabled', async (table) => {
    const rows = await query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `
      select c.relrowsecurity, c.relforcerowsecurity
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = $1
      `,
      [table],
    );
    expect(rows[0]?.relrowsecurity, `${table} does not have RLS enabled`).toBe(true);
  });

  it.each(RLS_TABLES)('%s has at least one policy', async (table) => {
    const rows = await query<{ policyname: string }>(
      `select policyname from pg_policies where schemaname='public' and tablename=$1`,
      [table],
    );
    // On a user-facing table, RLS enabled with zero policies denies everything
    // and makes the table unreachable — safe, but almost certainly a mistake.
    expect(rows.length, `${table} has RLS enabled but no policies`).toBeGreaterThan(0);
  });
});

describe('service-role-only tables', () => {
  it.each(DENY_ALL_TABLES)('%s has RLS enabled and deliberately no policies', async (table) => {
    const [rls] = await query<{ relrowsecurity: boolean }>(
      `
      select c.relrowsecurity
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = $1
      `,
      [table],
    );
    expect(rls?.relrowsecurity, `${table} must have RLS enabled`).toBe(true);

    const policies = await query(
      `select policyname from pg_policies where schemaname='public' and tablename=$1`,
      [table],
    );
    // Asserted as an equality, not a minimum: adding a policy here would open
    // scheduler bookkeeping to end users, and should fail loudly.
    expect(policies.length, `${table} is service-role only and must have no policies`).toBe(0);
  });

  it.each(DENY_ALL_TABLES)('%s grants nothing to anon or authenticated', async (table) => {
    // A stock Supabase project grants these by default; 20260901000002 revoked
    // them. RLS alone would not be enough if a policy were ever added.
    const rows = await query<{ grantee: string; privilege_type: string }>(
      `
      select grantee, privilege_type
        from information_schema.role_table_grants
       where table_schema = 'public'
         and table_name = $1
         and grantee in ('anon', 'authenticated')
      `,
      [table],
    );
    expect(rows.map((r) => `${r.grantee}:${r.privilege_type}`)).toEqual([]);
  });

  it('service_role can still bypass RLS, so the scheduler keeps working', async () => {
    // The deny-all design only works because the scheduler connects as a role
    // with BYPASSRLS. If that changed, notifications would silently stop.
    const [row] = await query<{ rolbypassrls: boolean }>(
      `select rolbypassrls from pg_roles where rolname = 'service_role'`,
    );
    expect(row?.rolbypassrls).toBe(true);
  });
});
