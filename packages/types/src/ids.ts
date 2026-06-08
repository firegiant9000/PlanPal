/**
 * Branded UUID types. Branding prevents accidentally passing a UserId where an
 * EventId is expected — a compile-time error, zero runtime cost.
 */
type Branded<T extends string> = string & { readonly __idBrand: T };

export type UserId = Branded<'UserId'>;
export type EventId = Branded<'EventId'>;
export type FriendConnectionId = Branded<'FriendConnectionId'>;
export type FriendCodeId = Branded<'FriendCodeId'>;
export type NotificationPreferenceId = Branded<'NotificationPreferenceId'>;
