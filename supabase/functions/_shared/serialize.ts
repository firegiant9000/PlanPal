/**
 * Row -> wire serialisation for the API.
 *
 * `public.events` is snake_case; the `Event` schema in
 * `packages/api-contract/openapi.yaml` is camelCase, and `packages/types`
 * generates its models from that spec. Returning a PostgREST row straight from
 * a handler therefore produces a response in which *none* of the contract's
 * thirteen required properties exist — and a client reading it through the
 * generated `Event` type sees `undefined` everywhere with no type error,
 * because the type says the field is there.
 *
 * The handlers already map camelCase -> snake_case on the way in. This is the
 * missing inverse.
 *
 * Why not reuse `_shared/recurrence/row.ts#mapEventRow`: that is the *engine's*
 * domain model, and a generated mirror of `packages/recurrence` that must not
 * be hand-edited (AD-1). It also deliberately omits `utc_start`/`utc_end`,
 * because the engine re-derives UTC per occurrence and ignores the stored
 * value (AD-5), and it carries no `created_at`/`updated_at`/`shared_with`.
 * The API contract requires all five. Same direction of travel, different
 * destination — merging them would drag API concerns into the engine mirror.
 */

/** A full `public.events` row, as returned by `.select()`. */
export interface EventRowFull {
  id: string;
  owner_id: string;
  title: string | null;
  description: string | null;
  location: string | null;
  local_start: string | null;
  local_end: string | null;
  timezone_id: string | null;
  utc_start: string | null;
  utc_end: string | null;
  is_master: boolean;
  master_event_id: string | null;
  recurrence_rule: string | null;
  recurrence_exception_date: string | null;
  is_cancelled: boolean;
  is_variable_schedule: boolean;
  visibility: string | null;
  shared_with: string[] | null;
  color_label: string | null;
  created_at: string;
  updated_at: string;
}

/** The `Event` shape defined by openapi.yaml. */
export interface EventModel {
  id: string;
  ownerId: string;
  title: string | null;
  description: string | null;
  location: string | null;
  localStart: string | null;
  localEnd: string | null;
  timezoneId: string | null;
  utcStart: string | null;
  utcEnd: string | null;
  isMaster: boolean;
  masterEventId: string | null;
  recurrenceRule: string | null;
  recurrenceExceptionDate: string | null;
  isCancelled: boolean;
  isVariableSchedule: boolean;
  visibility: string | null;
  sharedWith: string[];
  colorLabel: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Map one `public.events` row to the contract's `Event`. */
export function toEventModel(row: EventRowFull): EventModel {
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    description: row.description,
    location: row.location,
    localStart: row.local_start,
    localEnd: row.local_end,
    timezoneId: row.timezone_id,
    utcStart: row.utc_start,
    utcEnd: row.utc_end,
    isMaster: row.is_master,
    masterEventId: row.master_event_id,
    recurrenceRule: row.recurrence_rule,
    recurrenceExceptionDate: row.recurrence_exception_date,
    isCancelled: row.is_cancelled,
    isVariableSchedule: row.is_variable_schedule,
    visibility: row.visibility,
    // The column is NOT NULL DEFAULT '{}', but coalesce anyway: the contract
    // says this array is always present, and a null here would be a silent
    // shape violation rather than a loud one.
    sharedWith: row.shared_with ?? [],
    colorLabel: row.color_label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Map a page of rows. */
export function toEventModels(rows: EventRowFull[]): EventModel[] {
  return rows.map(toEventModel);
}
