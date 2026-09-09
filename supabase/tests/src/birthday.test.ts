import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from './db';
import {
  callFn,
  createTestUser,
  deleteTestUser,
  expectOk,
  requireLocalStack,
  type TestUser,
} from './harness';

/**
 * The birthday master event, and why it stopped being found by a colour.
 *
 * `sync_birthday_event()` used to locate its own row through
 * `color_label = '__birthday__'` — a user-visible, user-writable colour value.
 * That produces a defect you find by running the code, not by reading it:
 *
 *   PATCH /me {birthday: "1990-10-14"}                  -> 200
 *   PATCH /events/<birthday id> {colorLabel:"#ff0000"}  -> 200
 *   PATCH /me {birthday: "1990-11-02"}                  -> 200
 *   GET /events -> TWO "Birthday" masters
 *
 * Recolouring detaches the master from the sentinel and orphans it, and the
 * inverse is worse: a user who sets `colorLabel: "__birthday__"` on any event
 * has it deleted at the next birthday change. The flag is a system-owned
 * column instead, and the protection trigger is what makes "system-owned"
 * true rather than aspirational.
 */

interface EventModel {
  id: string;
  title: string;
  colorLabel: string | null;
  isMaster: boolean;
  isBirthday: boolean;
}

async function listEvents(token: string): Promise<EventModel[]> {
  const res = await callFn<{ items: EventModel[] }>('events', { token, query: { limit: '100' } });
  return expectOk(res).items;
}

function birthdayMasters(events: EventModel[]): EventModel[] {
  return events.filter((e) => e.title === 'Birthday' && e.isMaster);
}

let user: TestUser;

beforeAll(async () => {
  await requireLocalStack();
  user = await createTestUser('birthday');
});

afterAll(async () => {
  if (user) await deleteTestUser(user.id);
});

describe('the birthday master', () => {
  it('returns exactly one birthday master with isBirthday true and colorLabel null', async () => {
    // G1 asserted `colorLabel === null` and the count; the `isBirthday`
    // assertion was deferred because the field was not on the wire until G2
    // added it to `Event`. Both halves are here now.
    const patched = await callFn('me', {
      token: user.accessToken,
      method: 'PATCH',
      body: { birthday: '1990-10-14' },
    });
    expectOk(patched);

    const masters = birthdayMasters(await listEvents(user.accessToken));

    expect(masters).toHaveLength(1);
    expect(masters[0]?.colorLabel).toBeNull();
    expect(masters[0]?.isBirthday).toBe(true);
  });

  it('exposes isBirthday true on the birthday master and false on an ordinary event', async () => {
    // T19's colour picker branches on this field. Before it existed the only
    // way to recognise the birthday master was to parse its title or match the
    // sentinel colour — the first is locale-fragile, the second is the defect
    // G1 removed.
    const flagUser = await createTestUser('flag');
    try {
      expectOk(
        await callFn('me', {
          token: flagUser.accessToken,
          method: 'PATCH',
          body: { birthday: '1990-10-14' },
        }),
      );
      expectOk(
        await callFn('events', {
          token: flagUser.accessToken,
          method: 'POST',
          body: {
            title: 'Gym',
            localStart: '2026-09-10T09:00:00',
            localEnd: '2026-09-10T10:00:00',
            timezoneId: 'UTC',
            visibility: 'private',
          },
        }),
        201,
      );

      const events = await listEvents(flagUser.accessToken);
      const birthday = events.find((e) => e.title === 'Birthday');
      const ordinary = events.find((e) => e.title === 'Gym');

      expect(birthday?.isBirthday).toBe(true);
      expect(ordinary?.isBirthday).toBe(false);
    } finally {
      await deleteTestUser(flagUser.id);
    }
  });

  it('still yields exactly one birthday master after the master is recoloured', async () => {
    // The watched failure. On the pre-migration tree this reports two masters,
    // one '#ff0000' and one '__birthday__' — observed live, not reasoned about.
    const recolourUser = await createTestUser('recolour');
    try {
      expectOk(
        await callFn('me', {
          token: recolourUser.accessToken,
          method: 'PATCH',
          body: { birthday: '1990-10-14' },
        }),
      );
      const [master] = birthdayMasters(await listEvents(recolourUser.accessToken));
      expect(master).toBeDefined();

      expectOk(
        await callFn(`events/${master!.id}`, {
          token: recolourUser.accessToken,
          method: 'PATCH',
          body: { colorLabel: '#ff0000' },
        }),
      );
      expectOk(
        await callFn('me', {
          token: recolourUser.accessToken,
          method: 'PATCH',
          body: { birthday: '1990-11-02' },
        }),
      );

      const masters = birthdayMasters(await listEvents(recolourUser.accessToken));
      expect(masters).toHaveLength(1);
    } finally {
      await deleteTestUser(recolourUser.id);
    }
  });

  it('never puts the string __birthday__ on the wire', async () => {
    const sentinelUser = await createTestUser('sentinel');
    try {
      expectOk(
        await callFn('me', {
          token: sentinelUser.accessToken,
          method: 'PATCH',
          body: { birthday: '1990-10-14' },
        }),
      );

      const events = await callFn('events', {
        token: sentinelUser.accessToken,
        query: { limit: '100' },
      });
      const occurrences = await callFn('occurrences', {
        token: sentinelUser.accessToken,
        query: { from: '1990-10-01', to: '1990-10-31' },
      });

      // Raw response text, not the parsed model: a sentinel leaking through
      // any field at all is the thing being ruled out.
      expect(events.text).not.toContain('__birthday__');
      expect(occurrences.text).not.toContain('__birthday__');
    } finally {
      await deleteTestUser(sentinelUser.id);
    }
  });

  it('rejects setting is_birthday as authenticated with SQLSTATE 42501', async () => {
    const guardUser = await createTestUser('guard');
    try {
      expectOk(
        await callFn('me', {
          token: guardUser.accessToken,
          method: 'PATCH',
          body: { birthday: '1990-10-14' },
        }),
      );
      // An ordinary event, which is what the attack targets: a user promoting
      // one of their own events into the birthday master. Note that setting
      // the flag to the value it already holds is deliberately allowed —
      // `is distinct from` — so aiming this at the birthday master itself
      // would prove nothing.
      const ordinary = expectOk(
        await callFn<{ id: string }>('events', {
          token: guardUser.accessToken,
          method: 'POST',
          body: {
            title: 'Gym',
            localStart: '2026-09-10T09:00:00',
            localEnd: '2026-09-10T10:00:00',
            timezoneId: 'UTC',
            visibility: 'private',
          },
        }),
        201,
      );

      // One statement, so the role and the JWT claims survive to the update:
      // `query()` opens a connection per call, and a multi-statement string
      // makes `pg` return an array of results rather than rows.
      //
      // Three guards against a vacuous pass, in order:
      //   1. `current_user` really is `authenticated` — as `postgres` the
      //      trigger is a no-op AND RLS is bypassed, so both checks below
      //      would succeed for the wrong reason.
      //   2. a control update on the same row matches, so RLS is not simply
      //      hiding everything.
      //   3. the flag flips in BOTH directions — promoting an ordinary event
      //      and detaching the real master are separate attacks.
      const probe = `
        do $$
        begin
          perform set_config(
            'request.jwt.claims',
            '{"sub":"${guardUser.id}","role":"authenticated"}',
            true);
          set local role authenticated;

          if current_user <> 'authenticated' then
            raise exception 'role not applied: current_user=%', current_user;
          end if;

          update public.events set color_label = '#00ff00'
           where id = '${ordinary.id}';
          if not found then
            raise exception
              'control update matched no rows, so the guard assertions would be vacuous';
          end if;

          begin
            update public.events set is_birthday = true where id = '${ordinary.id}';
            raise exception 'promoting an ordinary event was allowed; expected 42501';
          exception
            when insufficient_privilege then null;
          end;

          begin
            update public.events set is_birthday = false
             where owner_id = '${guardUser.id}' and is_birthday;
            raise exception 'detaching the birthday master was allowed; expected 42501';
          exception
            when insufficient_privilege then null;
          end;
        end $$;`;

      // Throws if the role was not applied, if the control matched nothing, or
      // if either guarded update was allowed through. The message says which.
      await query(probe);
    } finally {
      await deleteTestUser(guardUser.id);
    }
  });

  it('keeps one birthday master when the backfill runs over two sentinel rows', async () => {
    // The migration's own backfill statements, replayed against the real
    // schema and then undone.
    //
    // The plan calls for a scratch database. That cannot work here:
    // core_schema.sql's `public.users.id references auth.users (id)` and its
    // `after insert on auth.users` trigger make the chain depend on a schema
    // GoTrue owns, so a bare `create database` would need a hand-built fake
    // `auth` — a different schema from the one in production, which is the
    // opposite of what this test is for.
    //
    // Instead: a real user (so the FK holds), two sentinel masters inserted as
    // superuser, the backfill run verbatim, the result asserted in SQL, and
    // the whole subtransaction rolled back by raising a private errcode that
    // the handler swallows. Nothing survives the statement.
    const backfillUser = await createTestUser('backfill');
    try {
      const probe = `
        do $$
        declare
          v_remaining int;
          v_flagged   int;
          v_indexed   int;
        begin
          insert into public.events
            (owner_id, title, local_start, local_end, timezone_id, is_master,
             recurrence_rule, visibility, color_label, created_at)
          values
            ('${backfillUser.id}', 'Birthday', '1990-10-14 00:00:00',
             '1990-10-14 23:59:59', 'UTC', true, 'FREQ=YEARLY', 'private',
             '__birthday__', now() - interval '2 days'),
            ('${backfillUser.id}', 'Birthday', '1990-11-02 00:00:00',
             '1990-11-02 23:59:59', 'UTC', true, 'FREQ=YEARLY', 'private',
             '__birthday__', now() - interval '1 day');

          -- Verbatim from 20260909000002_birthday_flag.sql.
          with ranked as (
            select id, row_number() over (partition by owner_id order by created_at desc) as rn
              from public.events where is_master and color_label = '__birthday__')
          delete from public.events where id in (select id from ranked where rn > 1);
          update public.events set is_birthday = true, color_label = null
           where is_master and color_label = '__birthday__';

          select count(*) into v_remaining from public.events
           where owner_id = '${backfillUser.id}' and is_master;
          select count(*) into v_flagged from public.events
           where owner_id = '${backfillUser.id}' and is_birthday;
          select count(*) into v_indexed from pg_indexes
           where schemaname = 'public' and indexname = 'events_one_birthday_per_owner';

          if v_remaining <> 1 or v_flagged <> 1 or v_indexed <> 1 then
            raise exception
              'backfill probe: remaining=% (want 1), flagged=% (want 1), indexed=% (want 1)',
              v_remaining, v_flagged, v_indexed;
          end if;

          -- Undo the probe. Caught below, which rolls the subtransaction back.
          raise exception using errcode = 'PP001', message = 'backfill probe passed';
        exception
          when sqlstate 'PP001' then null;
        end $$;`;

      await query(probe);

      // And it really did leave nothing behind.
      const left = await query<{ n: string }>(
        `select count(*) as n from public.events where owner_id = '${backfillUser.id}'`,
      );
      expect(left[0]?.n).toBe('0');
    } finally {
      await deleteTestUser(backfillUser.id);
    }
  });
});
