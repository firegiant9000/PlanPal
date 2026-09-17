import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DisclosureStore } from './privacyDisclosure';

/**
 * The acknowledgment flag is not sensitive (unlike the refresh token in
 * `session/secureStore.ts`), so plain AsyncStorage is the right tier — same
 * reasoning `session/secureStore.ts`'s doc comment gives for keeping calendar
 * data out of the Keychain.
 */
export const disclosureStore: DisclosureStore = AsyncStorage;
