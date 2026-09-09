/**
 * @planpal/api-client — the single path from either app to the backend.
 *
 * No component imports `supabase-js` or calls `fetch` (§15). This package is
 * the only legal place for either, and B5's ESLint rule enforces that rather
 * than leaving it to convention.
 */
export { PlanPalApiError, mapNonEnvelopeError } from './errors';
export { createHttp } from './http';
export type { Http, HttpOptions, RequestInitLike } from './http';
export { createAuthClient, chunkedStorage } from './auth';
export type { AuthClient, AuthClientOptions, ClearableCache, Session, SessionStore } from './auth';

export { createPlanPalClient } from './client';
export type { PlanPalClient, PlanPalClientOptions } from './client';

export type { EventsResource } from './resources/events';
export type {
  DetailedRange,
  OccurrencesDeps,
  OccurrencesResource,
  ReadPolicy,
} from './resources/occurrences';
export { CacheMissError, createMemoryCache, occurrenceCacheKey, userMonthPrefix } from './cache';
export { createAsyncStorageCache } from './adapters/asyncStorage';
export type { AsyncStorageLike } from './adapters/asyncStorage';
export { OCCURRENCE_CACHE_PREFIX } from './cache';
export type { CacheAdapter, CachedMonth } from './cache';
export type { ProfileResource } from './resources/profile';
export type { NotificationPreferencesResource } from './resources/notificationPreferences';
export type { DevicesResource } from './resources/devices';
export type { FriendCodeResource } from './resources/friendCode';
export type { ExportResource } from './resources/export';
export type { Health } from './resources/health';
export { monthsBetween } from './resources/occurrences';
export type { MonthWindow } from './resources/occurrences';
