/**
 * /me — the authenticated user's profile and notification preferences (M3, T10).
 *
 * Routes:
 *   GET   /me                            the caller's profile
 *   PATCH /me                            partial profile update
 *   GET   /me/notification-preferences   reminder defaults
 *   PUT   /me/notification-preferences   replace reminder defaults
 *
 * DELETE /me is defined by the contract but is NOT routed here yet — it needs a
 * SECURITY DEFINER RPC to remove the `auth.users` row, which lands with T14.
 * It therefore answers 405 rather than a 202 that deletes nothing, because a
 * GDPR endpoint that reports success without deleting is the worse failure.
 */
import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getUserClient } from '../_shared/auth.ts';
import { readJsonObject } from '../_shared/body.ts';
import {
  badRequest,
  conflict,
  dbError,
  handleOptions,
  methodNotAllowed,
  notFound,
  ok,
  unauthenticated,
} from '../_shared/response.ts';
import {
  type DeviceRow,
  type NotificationPreferenceRow,
  type UserRow,
  toDeviceModel,
  toNotificationPreferenceModel,
  toProfileModel,
} from '../_shared/serialize.ts';

const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^\d{2}:\d{2}$/;
const VISIBILITIES = ['private', 'shared_all', 'shared_select', 'sensitive_public'];
const MAX_LEAD_MINUTES = 40320; // matches the notification_preferences check constraint

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleOptions();

  const auth = await getUserClient(req);
  if (!auth) return unauthenticated();
  const { client, userId } = auth;

  const url = new URL(req.url);
  const segments = url.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
  // segments[0] = "me", [1] = "notification-preferences"?
  const sub = segments[1] ?? null;

  if (sub === 'notification-preferences') {
    if (req.method === 'GET') return getPreferences(client, userId);
    if (req.method === 'PUT') return putPreferences(client, userId, req);
    return methodNotAllowed();
  }

  if (sub === 'devices') {
    // The contract paths are /me/devices and /me/devices/{expoPushToken}, so
    // they are served here rather than from a separate `devices` function as
    // §6's table suggests. A function named `devices` would answer at
    // /functions/v1/devices and the URL would no longer match the spec.
    // A token can contain characters that must survive path encoding, so read
    // the raw segment and decode it once. decodeURIComponent throws URIError on
    // a malformed escape; Kong rejects most of those before we see them, but an
    // unguarded call here would escape the handler as a bare 500 rather than
    // the error envelope.
    let token: string | null = null;
    if (segments[2]) {
      try {
        token = decodeURIComponent(segments.slice(2).join('/'));
      } catch {
        return badRequest('The push token in the path is not correctly URL-encoded.');
      }
    }
    if (token === null) {
      if (req.method === 'POST') return registerDevice(client, userId, req);
      return methodNotAllowed();
    }
    if (req.method === 'DELETE') return deregisterDevice(client, userId, token);
    return methodNotAllowed();
  }

  if (sub !== null) return notFound('Route');

  if (req.method === 'GET') return getProfile(client, userId);
  if (req.method === 'PATCH') return patchProfile(client, userId, req);
  if (req.method === 'DELETE') return deleteAccount(client);
  return methodNotAllowed();
});

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

async function getProfile(client: SupabaseClient, userId: string) {
  const { data, error } = await client.from('users').select('*').eq('id', userId).maybeSingle();
  if (error) return dbError(error, 'me:get');
  // handle_new_user creates this row at signup. Its absence means the trigger
  // did not run, which is a real fault worth surfacing rather than a 200 with
  // an empty body.
  if (!data) return notFound('Profile');
  return ok(toProfileModel(data as unknown as UserRow));
}

async function patchProfile(client: SupabaseClient, userId: string, req: Request) {
  const body = await readJsonObject(req);
  if (body instanceof Response) return body;

  const allowed: Record<string, string> = {
    username: 'username',
    displayName: 'display_name',
    avatarUrl: 'avatar_url',
    birthday: 'birthday',
    defaultVisibility: 'default_visibility',
    timezoneId: 'timezone_id',
    lastActiveOptIn: 'last_active_opt_in',
  };

  const patch: Record<string, unknown> = {};
  for (const [clientKey, dbKey] of Object.entries(allowed)) {
    if (clientKey in body) patch[dbKey] = body[clientKey];
  }
  if (Object.keys(patch).length === 0) return badRequest('No updatable fields provided.');

  const validation = validateProfilePatch(body);
  if (validation) return badRequest(validation);

  // Username uniqueness is a UNIQUE constraint, so a race between check and
  // write is possible. Rather than pre-check, let the constraint decide and
  // map 23505 to 409 — the check-then-write version is wrong under concurrency
  // and slower besides. dbError already maps it, but the generic wording
  // ("That record already exists") is useless to a user typing a name.
  const { data, error } = await client
    .from('users')
    .update(patch)
    .eq('id', userId)
    .select()
    .maybeSingle();

  if (error) {
    if (error.code === '23505') return conflict('That username is already taken.');
    return dbError(error, 'me:patch');
  }
  if (!data) return notFound('Profile');

  return ok(toProfileModel(data as unknown as UserRow));
}

function validateProfilePatch(body: Record<string, unknown>): string | null {
  if ('username' in body) {
    const v = body.username;
    if (typeof v !== 'string' || !USERNAME_RE.test(v)) {
      return '"username" must be 3-30 characters, letters, digits or underscore.';
    }
  }
  if ('displayName' in body) {
    const v = body.displayName;
    if (typeof v !== 'string' || v.length < 1 || v.length > 80) {
      return '"displayName" must be 1-80 characters.';
    }
  }
  if ('avatarUrl' in body && body.avatarUrl !== null) {
    if (typeof body.avatarUrl !== 'string') return '"avatarUrl" must be a string or null.';
  }
  if ('birthday' in body && body.birthday !== null) {
    if (typeof body.birthday !== 'string' || !DATE_RE.test(body.birthday)) {
      return '"birthday" must be an ISO date (YYYY-MM-DD) or null.';
    }
  }
  if ('defaultVisibility' in body) {
    if (
      typeof body.defaultVisibility !== 'string' ||
      !VISIBILITIES.includes(body.defaultVisibility)
    ) {
      return `"defaultVisibility" must be one of: ${VISIBILITIES.join(', ')}.`;
    }
  }
  if ('timezoneId' in body) {
    const v = body.timezoneId;
    if (typeof v !== 'string' || v.trim() === '') return '"timezoneId" must be an IANA zone id.';
    // Validate here rather than letting an invalid zone reach the events
    // trigger, where AT TIME ZONE raises and surfaces as an opaque 500 on a
    // completely unrelated request later on.
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: v });
    } catch {
      return `"timezoneId" is not a recognised IANA timezone: ${v}`;
    }
  }
  if ('lastActiveOptIn' in body && typeof body.lastActiveOptIn !== 'boolean') {
    return '"lastActiveOptIn" must be a boolean.';
  }
  return null;
}

/**
 * DELETE /me — GDPR erasure.
 *
 * Delegates to `public.delete_me()`, which is SECURITY DEFINER because a
 * user-scoped client has no rights in the `auth` schema, and the row that
 * matters is `auth.users` — everything else cascades from it. Deleting only
 * `public.users` would leave a working login with no profile.
 *
 * The RPC takes no arguments and reads auth.uid() itself, so this cannot be
 * aimed at another account. See 20260903000004.
 */
async function deleteAccount(client: SupabaseClient) {
  const { error } = await client.rpc('delete_me');
  if (error) return dbError(error, 'me:delete');

  // 202 per the contract. The work is in fact synchronous — the cascade
  // completes before this returns — but the contract promises Accepted, and
  // committing to 200 would rule out ever moving the purge to a background job.
  return ok(null, 202);
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

const PLATFORMS = ['ios', 'android', 'web'];

async function registerDevice(client: SupabaseClient, userId: string, req: Request) {
  const body = await readJsonObject(req);
  if (body instanceof Response) return body;

  const token = body.expoPushToken;
  if (typeof token !== 'string' || token.trim() === '') {
    return badRequest('"expoPushToken" is required.');
  }
  if (typeof body.platform !== 'string' || !PLATFORMS.includes(body.platform)) {
    return badRequest(`"platform" must be one of: ${PLATFORMS.join(', ')}.`);
  }

  // expo_push_token is the PRIMARY KEY, so re-registering the same token is an
  // upsert, not a duplicate row. Bumping last_seen_at on every registration is
  // what lets the scheduler prune tokens that stopped checking in.
  const { data, error } = await client
    .from('devices')
    .upsert(
      {
        expo_push_token: token,
        user_id: userId,
        platform: body.platform,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'expo_push_token' },
    )
    .select()
    .maybeSingle();

  if (error) {
    // A token already owned by a DIFFERENT user fails the RLS check on the
    // existing row, which surfaces as 42501. dbError maps that to 403
    // "you do not have access to that record", which is misleading here: the
    // caller is perfectly entitled to register devices, and a developer seeing
    // 403 on app launch will go looking for an auth bug. It is a conflict on a
    // uniquely-owned resource — the same shape as a taken username.
    //
    // Answering 200 would be far worse than either: the phone would believe it
    // is registered while `devices` still points at the previous owner, and the
    // scheduler would push that person's reminders — event titles and times —
    // to whoever is holding the handset now.
    if (error.code === '42501') {
      return conflict(
        'That push token is registered to another account. Sign out on that account first.',
      );
    }
    return dbError(error, 'me:devices:register');
  }

  if (!data) return conflict('That push token is registered to another account.');

  return ok(toDeviceModel(data as unknown as DeviceRow));
}

async function deregisterDevice(client: SupabaseClient, userId: string, token: string) {
  const { error } = await client
    .from('devices')
    .delete()
    .eq('expo_push_token', token)
    .eq('user_id', userId);

  if (error) return dbError(error, 'me:devices:deregister');

  // 202 whether or not a row matched. The contract says idempotent, and a
  // sign-out that 404s because the token was already gone would make clients
  // retry or surface an error for a no-op.
  return ok(null, 202);
}

// ---------------------------------------------------------------------------
// Notification preferences
// ---------------------------------------------------------------------------

async function getPreferences(client: SupabaseClient, userId: string) {
  const { data, error } = await client
    .from('notification_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return dbError(error, 'me:prefs:get');
  if (!data) return notFound('Notification preferences');
  return ok(toNotificationPreferenceModel(data as unknown as NotificationPreferenceRow));
}

async function putPreferences(client: SupabaseClient, userId: string, req: Request) {
  const body = await readJsonObject(req);
  if (body instanceof Response) return body;

  const validation = validatePreferences(body);
  if (validation) return badRequest(validation);

  const row = {
    user_id: userId,
    lead_times_minutes: body.leadTimesMinutes as number[],
    push_enabled: body.pushEnabled as boolean,
    quiet_hours_start: (body.quietHoursStart as string | null) ?? null,
    quiet_hours_end: (body.quietHoursEnd as string | null) ?? null,
  };

  // PUT is a replace, and handle_new_user already created the row, so this is
  // an upsert on the primary key rather than an insert.
  const { data, error } = await client
    .from('notification_preferences')
    .upsert(row, { onConflict: 'user_id' })
    .select()
    .single();

  if (error) return dbError(error, 'me:prefs:put');
  return ok(toNotificationPreferenceModel(data as unknown as NotificationPreferenceRow));
}

function validatePreferences(body: Record<string, unknown>): string | null {
  const lead = body.leadTimesMinutes;
  if (!Array.isArray(lead)) return '"leadTimesMinutes" is required and must be an array.';
  // Validate against the column's check constraint BEFORE inserting. Letting
  // Postgres reject it yields a 23514 that dbError maps to a generic 400 with
  // no indication of which value was wrong.
  for (const value of lead) {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      return '"leadTimesMinutes" must contain whole numbers of minutes.';
    }
    if (value < 0 || value > MAX_LEAD_MINUTES) {
      return `"leadTimesMinutes" values must be between 0 and ${MAX_LEAD_MINUTES} minutes.`;
    }
  }
  if (new Set(lead).size !== lead.length) {
    // Duplicates would fan out into duplicate sends per occurrence.
    return '"leadTimesMinutes" must not contain duplicates.';
  }

  if (typeof body.pushEnabled !== 'boolean') {
    return '"pushEnabled" is required and must be a boolean.';
  }

  for (const key of ['quietHoursStart', 'quietHoursEnd'] as const) {
    const v = body[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string' || !HHMM_RE.test(v)) {
      return `"${key}" must be "HH:mm" or null.`;
    }
    const [h, m] = v.split(':').map(Number);
    if (h! > 23 || m! > 59) return `"${key}" is not a valid time of day.`;
  }

  // Both or neither: one half of a window is not a window, and the scheduler
  // reads them as a pair.
  const startSet = body.quietHoursStart !== undefined && body.quietHoursStart !== null;
  const endSet = body.quietHoursEnd !== undefined && body.quietHoursEnd !== null;
  if (startSet !== endSet) {
    return 'Quiet hours need both "quietHoursStart" and "quietHoursEnd", or neither.';
  }

  return null;
}
