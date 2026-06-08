import { describe, expect, it } from 'vitest';
import type { ApiResult, Paginated } from './api';

describe('ApiResult envelope', () => {
  it('discriminates ok results by the `ok` flag', () => {
    const success: ApiResult<{ id: string }> = { ok: true, data: { id: 'u_1' } };
    const failure: ApiResult<{ id: string }> = {
      ok: false,
      error: { code: 'not_found', message: 'missing' },
    };

    expect(success.ok && success.data.id).toBe('u_1');
    expect(!failure.ok && failure.error.code).toBe('not_found');
  });
});

describe('Paginated wrapper', () => {
  it('signals end-of-list with a null cursor', () => {
    const page: Paginated<number> = { items: [1, 2], nextCursor: null };
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });
});
