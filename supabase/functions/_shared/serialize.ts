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

import type { Database } from './database.types.ts';
import type { components } from './contract-types.ts';

type Tables = Database['public']['Tables'];

/**
 * The wire shapes, generated from `packages/api-contract/openapi.yaml`.
 *
 * C2 generated the ROW half of this file from the live schema; this is the
 * WIRE half. Between them there were three copies of `Event` in the Edge
 * Functions and a fourth in the spec, all hand-maintained. Now a required
 * property added to the contract fails `deno check` here, before any test
 * runs — `toEventModel` simply stops satisfying its return type.
 *
 * Aliased locally rather than written out at each use: `components['schemas']
 * ['Event']` is unreadable in a signature, and Deno resolves the lookup fine.
 */
type Schemas = components['schemas'];

/**
 * CONTRACT/SCHEMA MISMATCH — surfaced by generating both halves, recorded here.
 *
 * `openapi.yaml` declares seven `Event` properties **required and
 * non-nullable** — `title`, `localStart`, `localEnd`, `timezoneId`,
 * `utcStart`, `utcEnd`, `visibility` — while the matching `public.events`
 * columns all permit NULL. `Profile.birthday` and `Device.platform` disagree
 * the same way (optional-not-nullable, and an enum against unconstrained
 * `text`).
 *
 * Neither hand-written copy of the shape could show this: they restated the
 * contract's nullability by hand and so agreed with it by construction. That
 * is the drift F2b exists to end.
 *
 * Why it has not bitten: every row that reaches `toEventModel` is a master or
 * standalone event, and the write path validates all seven. The database does
 * not enforce that, and `GET /events/{id}` does not filter `is_master` — so an
 * exception row's id would serialise nulls through non-nullable fields, which
 * is exactly the defect class §11 describes for the override route.
 *
 * Resolving it properly is a `NOT NULL` migration or a contract change, and a
 * contract change is a two-dev decision (§15). Until then this fails **loudly**
 * rather than emitting a null the generated client type says cannot exist.
 */
function required<T>(value: T | null, field: string, id: string): T {
  if (value === null) {
    throw new Error(
      `events.${field} is NULL on row ${id}, but Event.${field} is required by ` +
        `the contract. A row that cannot be described by the contract reached ` +
        `the serializer — see the mismatch note in _shared/serialize.ts.`,
    );
  }
  return value;
}

/**
 * A full `public.events` row, as returned by `.select()`.
 *
 * Generated from the live schema (`supabase gen types typescript --local`,
 * T32/AD-11), not hand-written. The hand-written version was a copy of the
 * schema that nothing checked: a column renamed in a migration left it stale
 * and every call site kept compiling, because the 22 `as unknown as` casts
 * that fed it asserted the shape rather than deriving it.
 *
 * Note that AD-11's promise — "a column renamed in a migration becomes a
 * compile error" — only holds because the column lists are single literals
 * (C1). With a concatenated select string supabase-js infers
 * `GenericStringError` and the generated types buy nothing.
 */
export type EventRowFull = Tables['events']['Row'];

/** The `Event` shape defined by openapi.yaml — generated, not restated. */
export type EventModel = Schemas['Event'];

/** Map one `public.events` row to the contract's `Event`. */
export function toEventModel(row: EventRowFull): EventModel {
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: required(row.title, 'title', row.id),
    description: row.description,
    location: row.location,
    localStart: required(row.local_start, 'local_start', row.id),
    localEnd: required(row.local_end, 'local_end', row.id),
    timezoneId: required(row.timezone_id, 'timezone_id', row.id),
    utcStart: required(row.utc_start, 'utc_start', row.id),
    utcEnd: required(row.utc_end, 'utc_end', row.id),
    isMaster: row.is_master,
    recurrenceRule: row.recurrence_rule,
    // `masterEventId`, `recurrenceExceptionDate` and `isCancelled` are NOT
    // emitted. They were, and none of the three is declared in `Event` — the
    // generated wire type is what surfaced that. All three are exception-row
    // fields, so on the masters and standalone events this serialiser sees
    // they are always null/false; emitting them was undeclared drift of the
    // same kind `DeviceModel` refuses for `user_id`. If a client turns out to
    // need them, the fix is to add them to `openapi.yaml` (a two-dev contract
    // change, §15), not to re-add them here.
    isVariableSchedule: row.is_variable_schedule,
    // Arrives typed with no edit to the row interface at all: `EventRowFull`
    // is an alias of the generated `events` Row, so the column G1 added showed
    // up here as soon as the types were regenerated. That is the whole point
    // of landing G2 after C2.
    isBirthday: row.is_birthday,
    visibility: required(row.visibility, 'visibility', row.id),
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

export type UserRow = Tables['users']['Row'];

/** The `Profile` shape defined by openapi.yaml — generated, not restated. */
export type ProfileModel = Schemas['Profile'];

export function toProfileModel(row: UserRow): ProfileModel {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    // The contract marks `birthday` optional but NOT nullable, while the
    // column is nullable. Absent and null mean the same thing to a client,
    // so map null to omitted rather than inventing a value.
    ...(row.birthday === null ? {} : { birthday: row.birthday }),
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
// Friend codes
// ---------------------------------------------------------------------------

export type FriendCodeRow = Tables['friend_codes']['Row'];

/**
 * The `FriendCode` shape defined by openapi.yaml — three properties.
 *
 * `id` and `user_id` are not in the schema and are not exposed. The row id is
 * of no use to a client that can only ever address its own code, and the owner
 * is the caller by construction on this route.
 */
export type FriendCodeModel = Schemas['FriendCode'];

export function toFriendCodeModel(row: FriendCodeRow): FriendCodeModel {
  return {
    code: row.code,
    // Null while active; set to the 30-day expiry once rotated out.
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Notification preferences
// ---------------------------------------------------------------------------

export type NotificationPreferenceRow = Tables['notification_preferences']['Row'];

/** The `NotificationPreference` shape defined by openapi.yaml. */
export type NotificationPreferenceModel = Schemas['NotificationPreference'];

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

export type DeviceRow = Tables['devices']['Row'];

/**
 * The `Device` shape defined by openapi.yaml — exactly three properties.
 *
 * `user_id` and `created_at` are deliberately NOT exposed. They exist on the
 * row but not in the schema, and emitting them would be the same undeclared
 * drift as returning raw columns: invisible to the generated client type, and
 * free to change without any gate noticing. `userId` is also redundant on a
 * `/me/*` route, where the owner is the caller by construction.
 */
export type DeviceModel = Schemas['Device'];

export function toDeviceModel(row: DeviceRow): DeviceModel {
  return {
    expoPushToken: row.expo_push_token,
    // `devices.platform` is unconstrained `text` in the schema while the
    // contract declares an enum. The write path validates it; the database
    // does not. Same mismatch class as the Event fields above.
    platform: row.platform as DeviceModel['platform'],
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
