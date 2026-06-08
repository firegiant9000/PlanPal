/**
 * Adapter from a raw `public.events` row (snake_case, as returned by Supabase /
 * PostgREST) to the engine's camelCase {@link EventRecord}. Keeping the mapping
 * here lets the engine stay pure and lets the future `GET /occurrences` endpoint
 * map fetched rows in one line. The engine ignores the DB's derived `utc_start` /
 * `utc_end` — it re-derives UTC per occurrence from `local_*` + `timezone_id`.
 */
import type { Visibility } from '@planpal/types';
import type { EventRecord } from './types.js';

/** The subset of `public.events` columns the engine reads. */
export interface EventRow {
  id: string;
  owner_id: string;
  title: string | null;
  description: string | null;
  location: string | null;
  local_start: string | null;
  local_end: string | null;
  timezone_id: string | null;
  is_master: boolean;
  master_event_id: string | null;
  recurrence_exception_date: string | null;
  recurrence_rule: string | null;
  is_cancelled: boolean;
  is_variable_schedule: boolean;
  visibility: Visibility | null;
  color_label: string | null;
}

/** Normalize a `public.events` row to the engine's {@link EventRecord}. */
export function mapEventRow(row: EventRow): EventRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    description: row.description,
    location: row.location,
    localStart: row.local_start,
    localEnd: row.local_end,
    timezoneId: row.timezone_id,
    isMaster: row.is_master,
    masterEventId: row.master_event_id,
    recurrenceExceptionDate: row.recurrence_exception_date,
    recurrenceRule: row.recurrence_rule,
    isCancelled: row.is_cancelled,
    isVariableSchedule: row.is_variable_schedule,
    visibility: row.visibility,
    colorLabel: row.color_label,
  };
}
