import * as SecureStore from 'expo-secure-store';
import type { SessionStore } from '@planpal/api-client';

/**
 * The platform half of AD-9.
 *
 * This file owns the `expo-secure-store` calls and nothing else. The chunking
 * that keeps each written value under the iOS Keychain's 2048-byte limit lives
 * in `@planpal/api-client` (B2), so both platforms share one implementation and
 * an Android-only dogfood window cannot hide an iOS-only bug.
 *
 * Refresh tokens go here rather than in `AsyncStorage`, which is unencrypted.
 * Calendar data may live in AsyncStorage (AD-10, T29) — different key space,
 * different risk.
 */
export function createSecureStore(): SessionStore {
  return {
    get(key) {
      return SecureStore.getItemAsync(key);
    },
    async set(key, value) {
      await SecureStore.setItemAsync(key, value);
    },
    async remove(key) {
      await SecureStore.deleteItemAsync(key);
    },
  };
}
