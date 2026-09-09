import type { NotificationPreference, NotificationPreferenceUpdate } from '@planpal/types';
import type { Http } from '../http';

export interface NotificationPreferencesResource {
  get(): Promise<NotificationPreference>;
  /** `PUT`, not `PATCH` — the contract declares a whole-resource replace here. */
  update(prefs: NotificationPreferenceUpdate): Promise<NotificationPreference>;
}

export function createNotificationPreferencesResource(http: Http): NotificationPreferencesResource {
  return {
    get() {
      return http.json<NotificationPreference>('me/notification-preferences');
    },
    update(prefs) {
      return http.json<NotificationPreference>('me/notification-preferences', {
        method: 'PUT',
        body: prefs,
      });
    },
  };
}
