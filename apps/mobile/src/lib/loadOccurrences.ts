import type { CalendarStateKind } from './emptyStates';
import type { OccurrenceItem } from './occurrenceWindow';
import type { OccurrenceWindow } from './occurrenceWindow';

/**
 * Loading the visible calendar: cache first for an instant start, then always
 * a network refresh (T29, AD-10).
 *
 * WHY BOTH, rather than the client's `cache-first` policy on its own. That
 * policy returns a stored month and does not revalidate, which broke two
 * things at once:
 *
 *   1. A cached month was never refreshed. The only cache invalidation is on
 *      writes made from this device, so an event created on web would never
 *      appear on the phone.
 *   2. A cache hit RESOLVED, so the screen concluded it was online, hid the
 *      offline banner, and let an edit through — which then failed with a raw
 *      network error. That is precisely the case T29 exists to handle.
 *
 * So the cache read is `cache-only` (it must never touch the network) and the
 * refresh is `network-first` (it must never be served from cache). Splitting
 * them is what makes "did the network work?" answerable at all.
 *
 * Extracted from the screen deliberately: the bug above lived in the screen's
 * wiring, where no test could reach it.
 */

/** The slice of `client.occurrences` this needs — injected so it is testable. */
export interface OccurrencesLike {
  rangeDetailed(
    from: string,
    to: string,
    opts?: { policy?: 'cache-only' | 'cache-first' | 'network-first' },
  ): Promise<{ items: RawOccurrence[]; fetchedAt: string | null }>;
}

/** The contract's `EventOccurrence`, minus the fields the calendar ignores. */
interface RawOccurrence {
  eventId: string;
  occurrenceDate: string;
  title: string;
  localStart: string;
  localEnd: string;
  timezoneId: string;
  visibility: string;
  colorLabel?: string | null;
  isException: boolean;
  isVariableSchedule: boolean;
}

export interface OccurrenceLoad {
  items: OccurrenceItem[];
  /** Oldest `fetchedAt` among the months shown, for the offline banner. */
  fetchedAt: string | null;
  /** The refresh could not reach the server. Cached data may still be present. */
  offline: boolean;
  /** Set only when there is nothing at all to render. */
  failure: CalendarStateKind | null;
}

function toItem(o: RawOccurrence): OccurrenceItem {
  return {
    eventId: o.eventId,
    occurrenceDate: o.occurrenceDate,
    title: o.title,
    localStart: o.localStart,
    localEnd: o.localEnd,
    timezoneId: o.timezoneId,
    visibility: o.visibility,
    colorLabel: o.colorLabel ?? null,
    isException: o.isException,
    isVariableSchedule: o.isVariableSchedule,
  };
}

/**
 * An error carrying an HTTP status came from the server, so the device is
 * demonstrably online. One without came from `fetch` throwing, which is the
 * offline case — there is no response to read a status off.
 *
 * Structural rather than `instanceof PlanPalApiError` so this module stays
 * free of the client package, and therefore testable without it.
 */
function statusOf(error: unknown): number | null {
  if (typeof error === 'object' && error !== null) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number') return status;
  }
  return null;
}

function classify(error: unknown): { kind: CalendarStateKind; offline: boolean } {
  const status = statusOf(error);
  if (status === null) return { kind: 'offline', offline: true };
  if (status === 401 || status === 403) return { kind: 'forbidden', offline: false };
  return { kind: 'failed', offline: false };
}

export async function loadOccurrences(
  occurrences: OccurrencesLike,
  window: OccurrenceWindow,
  onCached?: (partial: { items: OccurrenceItem[]; fetchedAt: string | null }) => void,
): Promise<OccurrenceLoad> {
  let cached: { items: OccurrenceItem[]; fetchedAt: string | null } | null = null;

  // 1. Whatever is stored, with no network at all. A miss throws; that is the
  //    normal cold-start case and not an error worth surfacing.
  try {
    const stored = await occurrences.rangeDetailed(window.from, window.to, {
      policy: 'cache-only',
    });
    cached = { items: stored.items.map(toItem), fetchedAt: stored.fetchedAt };
    onCached?.(cached);
  } catch {
    cached = null;
  }

  // 2. Always refresh, cache hit or not.
  try {
    const fresh = await occurrences.rangeDetailed(window.from, window.to, {
      policy: 'network-first',
    });
    return {
      items: fresh.items.map(toItem),
      fetchedAt: fresh.fetchedAt,
      offline: false,
      failure: null,
    };
  } catch (error) {
    const { kind, offline } = classify(error);
    // Holding on to a stale calendar beats blanking it. Only report a failure
    // when there is genuinely nothing to show.
    return {
      items: cached?.items ?? [],
      fetchedAt: cached?.fetchedAt ?? null,
      offline,
      failure: cached === null ? kind : null,
    };
  }
}
