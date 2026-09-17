import {
  acknowledgeDisclosure,
  DISCLOSURE_STORAGE_KEY,
  hasAcknowledgedDisclosure,
  type DisclosureStore,
} from './privacyDisclosure';

function memoryStore(initial: Record<string, string> = {}): DisclosureStore {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => Promise.resolve(data.get(key) ?? null),
    setItem: (key, value) => {
      data.set(key, value);
      return Promise.resolve();
    },
  };
}

function throwingStore(): DisclosureStore {
  return {
    getItem: () => Promise.reject(new Error('storage unavailable')),
    setItem: () => Promise.reject(new Error('storage unavailable')),
  };
}

describe('privacy disclosure acknowledgment', () => {
  it('is unacknowledged on a store with nothing written', async () => {
    await expect(hasAcknowledgedDisclosure(memoryStore())).resolves.toBe(false);
  });

  it('is acknowledged once acknowledgeDisclosure has written to the store', async () => {
    const store = memoryStore();

    await acknowledgeDisclosure(store);

    await expect(hasAcknowledgedDisclosure(store)).resolves.toBe(true);
  });

  it('recognises a value written in a prior session under the same key', async () => {
    const store = memoryStore({ [DISCLOSURE_STORAGE_KEY]: '2026-01-01T00:00:00.000Z' });

    await expect(hasAcknowledgedDisclosure(store)).resolves.toBe(true);
  });

  it('fails toward showing the notice again when the store read throws', async () => {
    // Private browsing / a cold AsyncStorage read racing app boot must not
    // crash the flow, and must not silently skip a notice MONTH5.md requires
    // be seen before the first upload.
    await expect(hasAcknowledgedDisclosure(throwingStore())).resolves.toBe(false);
  });

  it('does not throw when the store write fails', async () => {
    await expect(acknowledgeDisclosure(throwingStore())).resolves.toBeUndefined();
  });
});
