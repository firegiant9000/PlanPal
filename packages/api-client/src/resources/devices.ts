import type { Device } from '@planpal/types';
import type { Http } from '../http';

export interface DevicesResource {
  /**
   * Returns the registered `Device`, not `void` (a correction to §5).
   *
   * The row carries `lastSeenAt` as the server assigned it, and a caller that
   * gets nothing back cannot tell a fresh registration from a no-op. A `409`
   * — the token is bound to another account — reaches the caller as
   * `PlanPalApiError` with code `CONFLICT` rather than being swallowed:
   * silently ignoring it leaves reminders going to the previous owner of the
   * handset.
   */
  register(expoPushToken: string, platform: 'ios' | 'android'): Promise<Device>;
  unregister(expoPushToken: string): Promise<void>;
}

export function createDevicesResource(http: Http): DevicesResource {
  return {
    register(expoPushToken, platform) {
      return http.json<Device>('me/devices', {
        method: 'POST',
        body: { expoPushToken, platform },
      });
    },
    unregister(expoPushToken) {
      // Encoded: an Expo token is `ExponentPushToken[...]`, and the brackets
      // are not path-safe.
      return http.empty(`me/devices/${encodeURIComponent(expoPushToken)}`, { method: 'DELETE' });
    },
  };
}
