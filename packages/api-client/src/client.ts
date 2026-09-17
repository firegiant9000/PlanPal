import { createAuthClient, type AuthClient, type SessionStore } from './auth';
import { createHttp, type Http } from './http';
import { createDevicesResource, type DevicesResource } from './resources/devices';
import { createEventsResource, type EventsResource } from './resources/events';
import { createExportResource, type ExportResource } from './resources/export';
import { createFeedbackResource, type FeedbackResource } from './resources/feedback';
import { createFriendCodeResource, type FriendCodeResource } from './resources/friendCode';
import { createHealthResource, type Health } from './resources/health';
import {
  createNotificationPreferencesResource,
  type NotificationPreferencesResource,
} from './resources/notificationPreferences';
import { createOccurrencesResource, type OccurrencesResource } from './resources/occurrences';
import { createParseResource, type ParseResource } from './resources/parse';
import { userMonthPrefix, type CacheAdapter } from './cache';
import { createProfileResource, type ProfileResource } from './resources/profile';

export interface PlanPalClient {
  auth: AuthClient;
  events: EventsResource;
  occurrences: OccurrencesResource;
  profile: ProfileResource;
  notificationPreferences: NotificationPreferencesResource;
  devices: DevicesResource;
  friendCode: FriendCodeResource;
  export: ExportResource;
  parse: ParseResource;
  feedback: FeedbackResource;
  health(): Promise<Health>;
  /** The transport, for the integration suite. Application code uses the resources. */
  http: Http;
}

export interface PlanPalClientOptions {
  /** e.g. http://127.0.0.1:54321 — the project URL, without /functions/v1. */
  supabaseUrl: string;
  anonKey: string;
  /**
   * Where the Edge Functions live. Defaults to `<supabaseUrl>/functions/v1`,
   * which is where both the local stack and a cloud project serve them.
   */
  baseUrl?: string;
  /** AD-9. Omit on web to use supabase-js's localStorage default. */
  store?: SessionStore;
  /** The month cache (AD-10). Omit for an always-network client. */
  cache?: CacheAdapter;
  redirectTo?: string;
  /** Injectable clock, so a test can assert the cache's `fetchedAt` exactly. */
  now?: () => Date;
  /**
   * Escape hatch for the integration suite, which mints its own tokens to test
   * the refresh path (B6). Application code leaves these alone and lets the
   * auth client own the session.
   */
  getAccessToken?: () => Promise<string | null>;
  refresh?: () => Promise<string | null>;
}

/**
 * The one object either app talks to.
 *
 * Wiring order matters: the auth client owns the session, and the transport
 * borrows `getAccessToken`/`refresh` from it. That is the whole reason those
 * two live on `AuthClient` — otherwise a screen would have to reach into
 * supabase-js, which §15 forbids and B5's lint rule makes impossible.
 */
export function createPlanPalClient(opts: PlanPalClientOptions): PlanPalClient {
  const auth = createAuthClient({
    supabaseUrl: opts.supabaseUrl,
    anonKey: opts.anonKey,
    store: opts.store,
    cache: opts.cache,
    redirectTo: opts.redirectTo,
  });

  const http = createHttp({
    baseUrl: opts.baseUrl ?? `${opts.supabaseUrl.replace(/\/$/, '')}/functions/v1`,
    anonKey: opts.anonKey,
    getAccessToken: opts.getAccessToken ?? (() => auth.getAccessToken()),
    refresh: opts.refresh ?? (() => auth.refresh()),
  });

  const getUserId = async (): Promise<string | null> => {
    const session = await auth.getSession();
    return session?.user?.id ?? null;
  };

  /**
   * Drop every cached month for the signed-in user after any write.
   *
   * Coarse on purpose: a recurring master can generate occurrences in any
   * month, so working out which months a write touched means expanding the
   * rule — the engine's job, and not worth pulling into the client (AD-1).
   * Scoped to the user, not the whole prefix, so one account's write does not
   * cold-start another account's calendar on a shared device.
   */
  const invalidateMonths = async (): Promise<void> => {
    if (!opts.cache) return;
    const userId = await getUserId();
    await opts.cache.clear(userId === null ? undefined : userMonthPrefix(userId));
  };

  const now = opts.now ?? (() => new Date());

  return {
    auth,
    http,
    events: createEventsResource(http, invalidateMonths),
    occurrences: createOccurrencesResource(http, { cache: opts.cache, getUserId, now }),
    profile: createProfileResource(http),
    notificationPreferences: createNotificationPreferencesResource(http),
    devices: createDevicesResource(http),
    friendCode: createFriendCodeResource(http),
    export: createExportResource(http),
    parse: createParseResource(http),
    feedback: createFeedbackResource(http),
    health: createHealthResource(http),
  };
}
