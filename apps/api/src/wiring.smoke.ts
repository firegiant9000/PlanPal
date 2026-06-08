/**
 * Phase 0 wiring smoke check (not a runtime entry point).
 *
 * Proves the API workspace shares the same contract types as the clients.
 * Replaced by real endpoints once the Phase 1 OpenAPI spec is signed off.
 */
import type { ApiResult, UserId, Visibility } from '@planpal/types';

export interface ProfileStub {
  id: UserId;
  defaultVisibility: Visibility;
}

export type GetProfileResult = ApiResult<ProfileStub>;
