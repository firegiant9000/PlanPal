import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHttp } from '../http';
import { createFeedbackResource } from './feedback';

const BASE_URL = 'http://127.0.0.1:54321/functions/v1';
const ANON_KEY = 'anon-key-for-tests';

function fetchMock() {
  return vi.mocked(globalThis.fetch as unknown as ReturnType<typeof vi.fn>);
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('FeedbackResource.create', () => {
  it('POSTs to feedback and returns the recorded Feedback', async () => {
    const http = createHttp({
      baseUrl: BASE_URL,
      anonKey: ANON_KEY,
      getAccessToken: () => Promise.resolve('access-1'),
      refresh: () => Promise.resolve(null),
    });
    const resource = createFeedbackResource(http);
    const recorded = { id: 'f1', message: 'The calendar is great', createdAt: '2026-09-15T00:00:00Z' };
    fetchMock().mockResolvedValue(jsonResponse(201, { ok: true, data: recorded }));

    const result = await resource.create({ message: 'The calendar is great' });

    expect(result).toEqual(recorded);
    const [url, init] = fetchMock().mock.calls[0] as [URL | string, RequestInit];
    expect(String(url)).toBe(`${BASE_URL}/feedback`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ message: 'The calendar is great' });
  });
});
