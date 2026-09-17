/**
 * Privacy disclosure notice (M5, Arlo's frontend task — MONTH5.md, distinct
 * from Upload UX). Requirement: a persistent notice that screenshots are sent
 * to a third-party AI and are not retained beyond the parse session, visible
 * before the first upload, and dismissible-but-re-viewable afterward.
 *
 * This file owns only "has this device ever acknowledged it, and how to
 * record that it has now" — framework-agnostic and duplicated between
 * apps/mobile and apps/web (same call as `parseJob.ts`: no shared non-UI
 * logic layer exists between the two apps, and this is too small to justify
 * introducing one). The actual notice UI is `components/PrivacyDisclosure.tsx`.
 */

/**
 * The slice of AsyncStorage/localStorage this needs, injected so the module
 * is testable without either — the same "`Like`" pattern `loadOccurrences.ts`
 * uses for `OccurrencesLike`.
 */
export interface DisclosureStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export const DISCLOSURE_STORAGE_KEY = 'planpal.privacyDisclosure.acknowledgedAt.v1';

/**
 * Whether this device has ever acknowledged the notice.
 *
 * Fails toward `false` (show the notice again) on a storage error — private
 * browsing, a full quota, a cold read racing app boot. MONTH5.md requires the
 * notice be seen before the first upload; showing it an extra time because a
 * read failed is safe, hiding it because a read failed is not.
 */
export async function hasAcknowledgedDisclosure(store: DisclosureStore): Promise<boolean> {
  try {
    return (await store.getItem(DISCLOSURE_STORAGE_KEY)) !== null;
  } catch {
    return false;
  }
}

/**
 * Record that this device has now acknowledged the notice. Swallows storage
 * errors deliberately: the worst outcome is the notice reappearing next time,
 * which is the safe direction, not a broken upload flow.
 */
export async function acknowledgeDisclosure(store: DisclosureStore): Promise<void> {
  try {
    await store.setItem(DISCLOSURE_STORAGE_KEY, new Date().toISOString());
  } catch {
    // Non-fatal — see doc comment above.
  }
}
