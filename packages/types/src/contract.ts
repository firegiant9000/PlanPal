/**
 * Domain models, derived from the OpenAPI contract.
 *
 * `./generated/openapi.ts` is emitted by `openapi-typescript` from
 * `packages/api-contract/openapi.yaml` (run `pnpm --filter @planpal/api-contract
 * generate`; CI fails if it drifts). Do NOT edit the generated file by hand.
 *
 * This module re-exports ergonomic aliases so consumers write `Event` instead of
 * `components['schemas']['Event']`, and so the rest of the codebase imports from a
 * stable surface even if the generator's output shape changes.
 */
import type { components } from './generated/openapi';

type Schemas = components['schemas'];

/**
 * The closed set of `ApiError.code` values (AD-8). Generated, so adding a code
 * to `openapi.yaml` is what widens it — a client `switch` over these is
 * exhaustively checked rather than a `string` comparison that silently rots.
 */
export type ApiErrorCode = Schemas['ErrorCode'];

export type Profile = Schemas['Profile'];
export type ProfileUpdate = Schemas['ProfileUpdate'];

export type NotificationPreference = Schemas['NotificationPreference'];
export type NotificationPreferenceUpdate = Schemas['NotificationPreferenceUpdate'];
export type Device = Schemas['Device'];
export type DeviceRegistration = Schemas['DeviceRegistration'];

export type Event = Schemas['Event'];
export type EventCreate = Schemas['EventCreate'];
export type EventUpdate = Schemas['EventUpdate'];
export type OccurrenceOverride = Schemas['OccurrenceOverride'];
export type EventOccurrence = Schemas['EventOccurrence'];

export type FriendOccurrence = Schemas['FriendOccurrence'];
export type FriendCode = Schemas['FriendCode'];
export type FriendSummary = Schemas['FriendSummary'];
export type FriendConnection = Schemas['FriendConnection'];
export type FriendConnectionStatus = Schemas['FriendConnectionStatus'];
export type FriendRequest = Schemas['FriendRequest'];
export type FriendRequestCreate = Schemas['FriendRequestCreate'];
export type ReportCreate = Schemas['ReportCreate'];

/** The full generated `paths` + `components` trees, for advanced/typed-client use. */
export type { paths, components } from './generated/openapi';
