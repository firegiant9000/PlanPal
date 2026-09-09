import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { planpalClient } from './planpalClient';

/**
 * Register this device for reminders.
 *
 * UNVERIFIED ON HARDWARE. Expo Go cannot obtain an FCM token on SDK 53, so
 * this path only runs for real in a development build — which is T25-Android,
 * still gated on decision D-I. Treat "a `devices` row appears after launch" as
 * a hypothesis until that build exists; nothing here has been observed working
 * end to end.
 *
 * Every failure is swallowed deliberately. Reminders are additive, and a
 * device that cannot register should still show a calendar rather than a
 * startup error.
 */
export type PushRegistration =
  | 'registered'
  | 'denied'
  | 'unsupported'
  | 'conflict'
  | 'failed';

export async function registerPushToken(): Promise<PushRegistration> {
  // A simulator has no push transport, and asking anyway throws.
  if (!Device.isDevice) return 'unsupported';

  try {
    const existing = await Notifications.getPermissionsAsync();
    const granted =
      existing.granted || (await Notifications.requestPermissionsAsync()).granted === true;
    if (!granted) return 'denied';

    const token = await Notifications.getExpoPushTokenAsync();
    await planpalClient.devices.register(token.data, Platform.OS === 'ios' ? 'ios' : 'android');
    return 'registered';
  } catch (error) {
    // A 409 means this push token is already bound to ANOTHER account — a
    // phone that changed hands. `devices.register` raises rather than
    // swallowing it precisely so the caller cannot ignore it: left alone, this
    // device keeps delivering the previous owner's reminders. It is reported
    // separately from `failed` so the caller can say something.
    if (isConflict(error)) return 'conflict';
    return 'failed';
  }
}

function isConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { status?: unknown }).status === 409
  );
}
