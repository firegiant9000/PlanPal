import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlanPalApiError } from '../errors';
import { createParseResource } from './parse';

/**
 * `upload()` is the one `ParseResource` method that bypasses `Http` — a raw
 * PUT to a signed Supabase Storage URL, not our gateway. These tests stub
 * `fetch` directly rather than going through `Http`'s envelope machinery,
 * since that machinery is exactly what this method does not use.
 */

function fetchMock() {
  return vi.mocked(globalThis.fetch as unknown as ReturnType<typeof vi.fn>);
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ParseResource.upload', () => {
  it('PUTs the file body with the given content type and no envelope', async () => {
    const resource = createParseResource({} as never);
    fetchMock().mockResolvedValue(new Response(null, { status: 200 }));
    const file = new Blob(['fake-image-bytes'], { type: 'image/jpeg' });

    await resource.upload('https://storage.test/signed?token=abc', file, 'image/jpeg');

    expect(fetchMock()).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock().mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://storage.test/signed?token=abc');
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('image/jpeg');
    expect(init.body).toBe(file);
  });

  it('resolves on any 2xx without attempting to parse a body', async () => {
    const resource = createParseResource({} as never);
    fetchMock().mockResolvedValue(new Response(null, { status: 204 }));

    await expect(
      resource.upload('https://storage.test/signed', new Blob([]), 'image/png'),
    ).resolves.toBeUndefined();
  });

  it('throws PlanPalApiError with a status-derived code on a non-2xx response', async () => {
    const resource = createParseResource({} as never);
    fetchMock().mockResolvedValue(
      new Response('signature has expired', { status: 403, statusText: 'Forbidden' }),
    );

    const error = await resource
      .upload('https://storage.test/signed', new Blob([]), 'image/jpeg')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PlanPalApiError);
    expect((error as PlanPalApiError).code).toBe('FORBIDDEN');
    expect((error as PlanPalApiError).status).toBe(403);
    expect((error as PlanPalApiError).message).toContain('signature has expired');
  });

  it('maps a 429 (expired/overused signed URL) to RATE_LIMITED', async () => {
    const resource = createParseResource({} as never);
    fetchMock().mockResolvedValue(new Response('', { status: 429 }));

    const error = await resource
      .upload('https://storage.test/signed', new Blob([]), 'image/jpeg')
      .catch((e: unknown) => e);

    expect((error as PlanPalApiError).code).toBe('RATE_LIMITED');
  });
});
