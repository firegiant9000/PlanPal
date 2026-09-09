import type { EventOccurrence } from '@planpal/types';
import {
  CacheMissError,
  occurrenceCacheKey,
  readMonth,
  writeMonth,
  type CacheAdapter,
} from '../cache';
import type { Http } from '../http';

/**
 * How a month may be served (AD-10).
 *
 * - `network-first` (default) — fetch, then store. What a foreground refresh wants.
 * - `cache-first` — a stored month is served without touching the network.
 *   T29's offline read.
 * - `cache-only` — never fetch; throw `CacheMissError` on a miss. For a screen
 *   that has already decided it is offline, where a hanging socket is worse
 *   than an immediate failure.
 */
export type ReadPolicy = 'network-first' | 'cache-first' | 'cache-only';

/** `items` plus how stale they are — T29 renders "last updated ..." from this. */
export interface DetailedRange {
  items: EventOccurrence[];
  /**
   * The **oldest** `fetchedAt` among the months served, or null when there is
   * no cache to date them by. Oldest rather than newest because it is the
   * honest claim: some part of this window is stale at least this long.
   */
  fetchedAt: string | null;
}

export interface OccurrencesResource {
  /**
   * Expand the calendar over `[from, to]`, inclusive, both `yyyy-mm-dd`.
   *
   * The endpoint takes an arbitrary window and caps it at 180 days, so a wide
   * month-swipe would 400. Reads are therefore normalised to whole calendar
   * months, fetched a month at a time, stitched, and clipped back to the
   * requested window. Whole months are also what makes a cache hit twice —
   * caching an arbitrary `(from,to)` gives a cache that never does.
   */
  range(from: string, to: string, opts?: { policy?: ReadPolicy }): Promise<EventOccurrence[]>;
  /** As `range`, with the freshness metadata T29 needs. */
  rangeDetailed(from: string, to: string, opts?: { policy?: ReadPolicy }): Promise<DetailedRange>;
}

export interface OccurrencesDeps {
  cache?: CacheAdapter;
  /** Resolves the signed-in user's id — the cache is keyed per user. */
  getUserId(): Promise<string | null>;
  now(): Date;
}

export function createOccurrencesResource(http: Http, deps: OccurrencesDeps): OccurrencesResource {
  async function serveMonth(
    month: MonthWindow,
    policy: ReadPolicy,
    userId: string | null,
  ): Promise<{ items: EventOccurrence[]; fetchedAt: string | null }> {
    const cacheable = deps.cache !== undefined && userId !== null;

    if (cacheable && policy !== 'network-first') {
      const stored = await readMonth(deps.cache!, userId!, month.key);
      if (stored) return { items: stored.items, fetchedAt: stored.fetchedAt };
      if (policy === 'cache-only') {
        throw new CacheMissError(occurrenceCacheKey(userId!, month.key));
      }
    } else if (policy === 'cache-only') {
      // No cache, or no session to key one by. `cache-only` still must not
      // reach the network — that is the whole contract of the policy.
      throw new CacheMissError(occurrenceCacheKey(userId ?? 'anonymous', month.key));
    }

    const items = await http.json<EventOccurrence[]>('occurrences', {
      query: { from: month.from, to: month.to },
    });
    if (!cacheable) return { items, fetchedAt: null };

    // The write's own stamp is this month's freshness — a month fetched just
    // now is "updated just now", not "unknown". Returning null here would
    // leave T29's banner blank immediately after a successful refresh, which
    // is the one moment it has something good to say.
    const written = await writeMonth(deps.cache!, userId!, month.key, items, deps.now);
    return { items, fetchedAt: written.fetchedAt };
  }

  async function rangeDetailed(
    from: string,
    to: string,
    opts: { policy?: ReadPolicy } = {},
  ): Promise<DetailedRange> {
    const policy = opts.policy ?? 'network-first';
    const userId = deps.cache ? await deps.getUserId() : null;

    const items: EventOccurrence[] = [];
    let oldest: string | null = null;

    for (const month of monthsBetween(from, to)) {
      const served = await serveMonth(month, policy, userId);
      items.push(...served.items);
      if (served.fetchedAt !== null && (oldest === null || served.fetchedAt < oldest)) {
        oldest = served.fetchedAt;
      }
    }

    return {
      // Clip: the caller asked for a window, not for whole months.
      items: items.filter((item) => item.occurrenceDate >= from && item.occurrenceDate <= to),
      fetchedAt: oldest,
    };
  }

  return {
    async range(from, to, opts = {}) {
      return (await rangeDetailed(from, to, opts)).items;
    },
    rangeDetailed,
  };
}

/** `yyyy-mm` plus its inclusive first and last day. */
export interface MonthWindow {
  key: string;
  from: string;
  to: string;
}

/**
 * Every calendar month the window touches, in order.
 *
 * A month is at most 31 days, so no request can approach the endpoint's
 * 180-day cap however wide the caller's range is.
 */
export function monthsBetween(from: string, to: string): MonthWindow[] {
  const [startYear, startMonth] = splitYearMonth(from);
  const [endYear, endMonth] = splitYearMonth(to);

  const months: MonthWindow[] = [];
  let year = startYear;
  let month = startMonth;

  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(monthWindow(year, month));
    // Roll the year over rather than letting month reach 13 — this is where
    // a December-to-January range goes wrong if it goes wrong at all.
    if (month === 12) {
      year += 1;
      month = 1;
    } else {
      month += 1;
    }
  }
  return months;
}

function monthWindow(year: number, month: number): MonthWindow {
  // Day 0 of the next month is the last day of this one, which gets February
  // right in a leap year without a table.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const key = `${year}-${pad(month)}`;
  return { key, from: `${key}-01`, to: `${key}-${pad(lastDay)}` };
}

function splitYearMonth(date: string): [number, number] {
  const year = Number.parseInt(date.slice(0, 4), 10);
  const month = Number.parseInt(date.slice(5, 7), 10);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`Expected a yyyy-mm-dd date, got "${date}".`);
  }
  return [year, month];
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
