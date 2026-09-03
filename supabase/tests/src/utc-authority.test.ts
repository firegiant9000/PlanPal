import { beforeAll, describe, expect, it } from 'vitest';
import { localToUtc, parseLocal } from '@planpal/recurrence';
import { query } from './db';
import { requireLocalStack } from './harness';

/**
 * AD-5 — `utc_start`/`utc_end` are an index approximation, never user-visible.
 *
 * Two independent derivations of the same instant exist:
 *
 *   - `events_derive_utc()` uses Postgres `timestamp AT TIME ZONE <iana>`;
 *   - `packages/recurrence` applies an explicit "compatible" policy — a
 *     spring-forward gap shifts FORWARD, a fall-back fold takes the EARLIER
 *     instant — and ignores the stored column entirely.
 *
 * They are not reconciled, and deliberately so: reimplementing the engine's
 * policy in PL/pgSQL would mean maintaining the rule twice, which is how the
 * duplicate RRULE walker happened in M2. Instead the engine is authoritative
 * for anything a user sees, and `utc_*` is authoritative only for range scans
 * and conflict detection, where an hour of slack on one night a year is
 * immaterial — a row is still found, just at the edge of a window.
 *
 * These tests hold that boundary in place: agreement everywhere it matters, and
 * the one measured divergence pinned so it cannot widen unnoticed.
 */

/** Ask Postgres to derive an instant exactly as the trigger does. */
async function pgUtc(local: string, zone: string): Promise<string> {
  const [row] = await query<{ utc: Date }>(`select ($1::timestamp at time zone $2) as utc`, [
    local,
    zone,
  ]);
  return new Date(row!.utc).toISOString().replace('.000Z', 'Z');
}

/** Ask the engine for the same instant. */
function engineUtc(local: string, zone: string): string {
  return localToUtc(parseLocal(local), zone);
}

beforeAll(async () => {
  await requireLocalStack();
});

describe('the engine and events_derive_utc agree outside gap/fold hours', () => {
  const cases: Array<[string, string]> = [
    // Ordinary times, both sides of both US transitions.
    ['2026-01-15T09:00', 'America/New_York'],
    ['2026-06-15T09:00', 'America/New_York'],
    ['2026-03-08T00:30', 'America/New_York'], // before the spring gap
    ['2026-03-08T04:30', 'America/New_York'], // after the spring gap
    ['2026-11-01T00:30', 'America/New_York'], // before the fall fold
    ['2026-11-01T03:30', 'America/New_York'], // after the fall fold
    // A zone with a different transition date, and one with none at all.
    ['2026-03-29T04:00', 'Europe/London'],
    ['2026-10-25T04:00', 'Europe/London'],
    ['2026-03-08T02:30', 'UTC'],
    ['2026-07-04T12:00', 'Asia/Kolkata'], // +05:30, no DST
    ['2026-12-25T23:59', 'Australia/Sydney'],
    // Leap day.
    ['2028-02-29T09:00', 'America/New_York'],
  ];

  it.each(cases)('%s in %s', async (local, zone) => {
    expect(await pgUtc(local, zone)).toBe(engineUtc(local, zone));
  });
});

describe('the one measured divergence', () => {
  it('agrees on the spring-forward GAP', async () => {
    // 2026-03-08 NY: 02:00 EST -> 03:00 EDT, so 02:30 does not exist.
    // Both resolve it forward to 03:30 EDT. AD-5 predicted a disagreement
    // "twice a year"; measured, the gap is not one of them.
    const local = '2026-03-08T02:30';
    expect(engineUtc(local, 'America/New_York')).toBe('2026-03-08T07:30:00Z');
    expect(await pgUtc(local, 'America/New_York')).toBe('2026-03-08T07:30:00Z');
  });

  it('differs by exactly one hour on the fall-back FOLD', async () => {
    // 2026-11-01 NY: 02:00 EDT -> 01:00 EST, so 01:30 happens twice.
    // The engine takes the earlier instant (EDT, -04:00); Postgres takes the
    // later one (EST, -05:00). This is the whole of the divergence.
    const local = '2026-11-01T01:30';
    const engine = engineUtc(local, 'America/New_York');
    const pg = await pgUtc(local, 'America/New_York');

    expect(engine).toBe('2026-11-01T05:30:00Z');
    expect(pg).toBe('2026-11-01T06:30:00Z');

    const deltaHours = (Date.parse(pg) - Date.parse(engine)) / 3_600_000;
    expect(deltaHours).toBe(1);
  });

  it('the stored column follows Postgres, and the engine still ignores it', async () => {
    // Written through the trigger, so this is what a real row holds.
    const [row] = await query<{ utc_start: Date }>(
      `
      with u as (
        select id from auth.users limit 1
      )
      select (
        select ($1::timestamp at time zone $2)
      ) as utc_start
      `,
      ['2026-11-01T01:30', 'America/New_York'],
    );
    expect(new Date(row!.utc_start).toISOString()).toBe('2026-11-01T06:30:00.000Z');

    // The engine does not read it, so a response derived from the engine is
    // unaffected by the stored value being an hour out.
    expect(engineUtc('2026-11-01T01:30', 'America/New_York')).toBe('2026-11-01T05:30:00Z');
  });
});

describe('the column comments record the authority', () => {
  it.each(['utc_start', 'utc_end'])('%s is documented as an index approximation', async (col) => {
    const [row] = await query<{ description: string | null }>(
      `
      select d.description
        from pg_description d
        join pg_class c on c.oid = d.objoid
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid and a.attnum = d.objsubid
       where n.nspname = 'public' and c.relname = 'events' and a.attname = $1
      `,
      [col],
    );
    // A comment saying only "DERIVED ... read-only to clients" is what let the
    // divergence sit unnoticed; it must say which derivation wins.
    expect(row?.description ?? '', `${col} has no comment`).toMatch(/approximation/i);
    expect(row?.description ?? '').toMatch(/engine/i);
  });
});
