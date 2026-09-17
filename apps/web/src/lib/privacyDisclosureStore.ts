import type { DisclosureStore } from './privacyDisclosure';

/**
 * `localStorage` is synchronous and absent during Next.js server rendering
 * (same `typeof window === 'undefined'` guard `planpalClient.ts` uses) —
 * wrapped here so the rest of the app sees the same async `DisclosureStore`
 * shape on both platforms.
 */
export const disclosureStore: DisclosureStore = {
  getItem(key) {
    if (typeof window === 'undefined') return Promise.resolve(null);
    return Promise.resolve(window.localStorage.getItem(key));
  },
  setItem(key, value) {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
    return Promise.resolve();
  },
};
