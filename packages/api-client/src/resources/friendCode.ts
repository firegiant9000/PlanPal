import type { FriendCode } from '@planpal/types';
import type { Http } from '../http';

export interface FriendCodeResource {
  get(): Promise<FriendCode>;
  /** Issues a new active code and grace-expires the old one. */
  rotate(): Promise<FriendCode>;
}

export function createFriendCodeResource(http: Http): FriendCodeResource {
  return {
    get() {
      return http.json<FriendCode>('friend-code');
    },
    rotate() {
      return http.json<FriendCode>('friend-code/rotate', { method: 'POST' });
    },
  };
}
