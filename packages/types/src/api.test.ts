import { describe, expect, it } from 'vitest';
import type { ApiError, ApiResult, Paginated } from './api';

describe('ApiResult envelope', () => {
  it('discriminates ok results by the `ok` flag', () => {
    const success: ApiResult<{ id: string }> = { ok: true, data: { id: 'u_1' } };
    const failure: ApiResult<{ id: string }> = {
      ok: false,
      error: { code: 'NOT_FOUND', message: 'missing' },
    };

    expect(success.ok && success.data.id).toBe('u_1');
    expect(!failure.ok && failure.error.code).toBe('NOT_FOUND');
  });

  it('rejects a code outside the generated enum (AD-8)', () => {
    // The codes are UPPER_SNAKE_CASE, matching what the Edge Functions emit.
    // This file previously asserted `not_found`, which no server ever sends —
    // exactly the drift the generated enum exists to make impossible.
    // @ts-expect-error 'not_found' is not an ApiErrorCode
    const wrongCase: ApiError = { code: 'not_found', message: 'missing' };

    // @ts-expect-error 'already_friends' was dropped; the friend graph is M6
    const notACode: ApiError = { code: 'already_friends', message: 'nope' };

    expect(wrongCase.message).toBe('missing');
    expect(notACode.message).toBe('nope');
  });
});

describe('Paginated wrapper', () => {
  it('signals end-of-list with a null cursor', () => {
    const page: Paginated<number> = { items: [1, 2], nextCursor: null };
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });
});
