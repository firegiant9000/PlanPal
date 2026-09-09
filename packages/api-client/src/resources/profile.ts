import type { Profile, ProfileUpdate } from '@planpal/types';
import type { Http } from '../http';

export interface ProfileResource {
  get(): Promise<Profile>;
  update(patch: ProfileUpdate): Promise<Profile>;
  /** GDPR erasure. 202; the account is gone, so the caller must sign out after. */
  remove(): Promise<void>;
}

export function createProfileResource(http: Http): ProfileResource {
  return {
    get() {
      return http.json<Profile>('me');
    },
    update(patch) {
      return http.json<Profile>('me', { method: 'PATCH', body: patch });
    },
    remove() {
      return http.empty('me', { method: 'DELETE' });
    },
  };
}
