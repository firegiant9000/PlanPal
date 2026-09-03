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

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  birthday: string | null;
  default_visibility: string;
  timezone_id: string;
  last_active_opt_in: boolean;
  last_active_at: string | null;
  created_at: string;
  updated_at: string;
}

/** The `Profile` shape defined by openapi.yaml. */
export interface ProfileModel {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  birthday: string | null;
  defaultVisibility: string;
  timezoneId: string;
  lastActiveOptIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toProfileModel(row: UserRow): ProfileModel {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    birthday: row.birthday,
    defaultVisibility: row.default_visibility,
    timezoneId: row.timezone_id,
    lastActiveOptIn: row.last_active_opt_in,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // `last_active_at` is deliberately not exposed. It is not in the Profile
    // schema, and it is the field `lastActiveOptIn` exists to gate.
  };
}

// ---------------------------------------------------------------------------
// Notification preferences
// ---------------------------------------------------------------------------

export interface NotificationPreferenceRow {
  user_id: string;
  lead_times_minutes: number[];
  push_enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  updated_at: string;
}

export interface NotificationPreferenceModel {
  userId: string;
  leadTimesMinutes: number[];
  pushEnabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  updatedAt: string;
}

/**
 * Postgres `time` renders as `HH:MM:SS`, but the contract's quiet-hours pattern
 * is `^\d{2}:\d{2}$`. Returning the column verbatim would emit `22:00:00` and
 * fail its own schema, so trim to minutes.
 */
function toHhMm(value: string | null): string | null {
  if (value === null) return null;
  const match = /^(\d{2}):(\d{2})/.exec(value);
  return match ? `${match[1]}:${match[2]}` : value;
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

export interface DeviceRow {
  expo_push_token: string;
  user_id: string;
  platform: string;
  last_seen_at: string;
  created_at: string;
}

/**
 * The `Device` shape defined by openapi.yaml — exactly three properties.
 *
 * `user_id` and `created_at` are deliberately NOT exposed. They exist on the
 * row but not in the schema, and emitting them would be the same undeclared
 * drift as returning raw columns: invisible to the generated client type, and
 * free to change without any gate noticing. `userId` is also redundant on a
 * `/me/*` route, where the owner is the caller by construction.
 */
export interface DeviceModel {
  expoPushToken: string;
  platform: string;
  lastSeenAt: string;
}

export function toDeviceModel(row: DeviceRow): DeviceModel {
  return {
    expoPushToken: row.expo_push_token,
    platform: row.platform,
    lastSeenAt: row.last_seen_at,
  };
}

export function toNotificationPreferenceModel(
  row: NotificationPreferenceRow,
): NotificationPreferenceModel {
  return {
    userId: row.user_id,
    leadTimesMinutes: row.lead_times_minutes ?? [],
    pushEnabled: row.push_enabled,
    quietHoursStart: toHhMm(row.quiet_hours_start),
    quietHoursEnd: toHhMm(row.quiet_hours_end),
    updatedAt: row.updated_at,
  };
}
