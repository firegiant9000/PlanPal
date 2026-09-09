import type {
  Event,
  EventCreate,
  EventOccurrence,
  EventUpdate,
  OccurrenceOverride,
  Paginated,
} from '@planpal/types';
import type { Http } from '../http';

export interface EventsResource {
  list(opts?: { limit?: number; cursor?: string }): Promise<Paginated<Event>>;
  create(input: EventCreate): Promise<Event>;
  get(id: string): Promise<Event>;
  update(id: string, patch: EventUpdate): Promise<Event>;
  remove(id: string): Promise<void>;
  /**
   * `PATCH`, returning `EventOccurrence` — the contract's shape, signed off as
   * decision E1. Not `PUT` and not `Event`: an exception row is sparse by
   * design, so the `Event` serialiser emits six required, non-nullable fields
   * as `null` and a generated client reads them without a type error.
   */
  overrideOccurrence(id: string, date: string, patch: OccurrenceOverride): Promise<EventOccurrence>;
  cancelOccurrence(id: string, date: string): Promise<void>;
}

/**
 * `onWrite` is called after any mutation. B4 uses it to drop every cached
 * month for the user: a recurring master can touch any month, so a targeted
 * invalidation would be wrong.
 */
export function createEventsResource(http: Http, onWrite: () => Promise<void>): EventsResource {
  return {
    list(opts = {}) {
      const query: Record<string, string> = {};
      if (opts.limit !== undefined) query.limit = String(opts.limit);
      if (opts.cursor !== undefined) query.cursor = opts.cursor;
      return http.json<Paginated<Event>>('events', { query });
    },

    async create(input) {
      const event = await http.json<Event>('events', { method: 'POST', body: input });
      await onWrite();
      return event;
    },

    get(id) {
      return http.json<Event>(`events/${encodeURIComponent(id)}`);
    },

    async update(id, patch) {
      const event = await http.json<Event>(`events/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: patch,
      });
      await onWrite();
      return event;
    },

    async remove(id) {
      await http.empty(`events/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await onWrite();
    },

    async overrideOccurrence(id, date, patch) {
      const occurrence = await http.json<EventOccurrence>(
        `events/${encodeURIComponent(id)}/occurrences/${encodeURIComponent(date)}`,
        { method: 'PATCH', body: patch },
      );
      await onWrite();
      return occurrence;
    },

    async cancelOccurrence(id, date) {
      await http.empty(`events/${encodeURIComponent(id)}/occurrences/${encodeURIComponent(date)}`, {
        method: 'DELETE',
      });
      await onWrite();
    },
  };
}
