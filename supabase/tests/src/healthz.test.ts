import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ANON_KEY, callFn, expectOk, requireLocalStack } from './harness';

/**
 * /healthz — the endpoint with the least behind it and the most riding on it.
 *
 * Two failures this pins:
 *
 * 1. The handler returned `{status}` alone while §6 described a version string,
 *    so a deploy could not be told apart from the one before it. "Something
 *    answered" is not "the thing I just deployed answered", and the staging
 *    smoke check could not tell the difference.
 * 2. `openapi.yaml` declared only `200` while the handler has always been able
 *    to answer `503` (see `unhealthy()`). Every generated client therefore saw
 *    a status the contract said was impossible. The second test below is what
 *    stops that drifting back.
 */

// Resolved from this file, not from process.cwd() — Vitest's cwd depends on how
// it was invoked, and a wrong path here would make the assertion below throw
// rather than fail, which reads as a broken test instead of a contract drift.
const SPEC_PATH = fileURLToPath(
  new URL('../../../packages/api-contract/openapi.yaml', import.meta.url),
);

interface OpenApiDocument {
  paths?: Record<string, { get?: { responses?: Record<string, unknown> } } | undefined>;
}

function healthzResponses(): Record<string, unknown> {
  const doc = parse(readFileSync(SPEC_PATH, 'utf8')) as OpenApiDocument;
  const responses = doc.paths?.['/healthz']?.get?.responses;
  if (!responses) throw new Error(`openapi.yaml declares no GET /healthz responses (${SPEC_PATH})`);
  return responses;
}

describe('GET /healthz', () => {
  beforeAll(requireLocalStack);

  it('returns ok with a version string', async () => {
    const res = await callFn<{ status: string; version: string }>('healthz', { token: ANON_KEY });
    const data = expectOk(res, 200);

    expect(data.status).toBe('ok');
    expect(typeof data.version).toBe('string');
    expect(data.version.length).toBeGreaterThan(0);
  });

  it('declares every status it can return', () => {
    const responses = healthzResponses();

    // 503 is not hypothetical: `unhealthy()` returns it when the rpc('healthz')
    // round-trip fails, and when the function is misconfigured.
    expect(responses).toHaveProperty('200');
    expect(responses).toHaveProperty('503');
  });
});
