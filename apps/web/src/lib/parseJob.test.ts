import { afterEach, describe, expect, it, vi } from 'vitest';
import { pollJob, type UploadStage } from './parseJob';

function stubJob(
  status: 'queued' | 'processing' | 'done' | 'failed',
  extra: { eventCount?: number | null; errorCode?: string | null } = {},
) {
  return { status, eventCount: extra.eventCount ?? null, errorCode: extra.errorCode ?? null };
}

describe('pollJob', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('yields a polling stage per in-progress status, then resolves to done', async () => {
    vi.useFakeTimers();
    const getJob = vi
      .fn()
      .mockResolvedValueOnce(stubJob('processing'))
      .mockResolvedValueOnce(stubJob('queued'))
      .mockResolvedValueOnce(stubJob('done', { eventCount: 3 }));

    const gen = pollJob(getJob, 'job-1', { intervalMs: 1000, timeoutMs: 10_000 });

    await expect(gen.next()).resolves.toEqual({
      value: { kind: 'polling', jobId: 'job-1', status: 'processing' },
      done: false,
    });

    let next = gen.next();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(next).resolves.toEqual({
      value: { kind: 'polling', jobId: 'job-1', status: 'queued' },
      done: false,
    });

    next = gen.next();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(next).resolves.toEqual({
      value: { kind: 'done', jobId: 'job-1', eventCount: 3 },
      done: true,
    });

    expect(getJob).toHaveBeenCalledTimes(3);
    expect(getJob).toHaveBeenNthCalledWith(1, 'job-1');
  });

  it('treats eventCount: 0 as a real result, not a missing one', async () => {
    const getJob = vi.fn().mockResolvedValue(stubJob('done', { eventCount: 0 }));

    const result = await pollJob(getJob, 'job-empty').next();

    expect(result).toEqual({ value: { kind: 'done', jobId: 'job-empty', eventCount: 0 }, done: true });
  });

  it('resolves to a failed/server stage carrying the job error code', async () => {
    const getJob = vi.fn().mockResolvedValue(stubJob('failed', { errorCode: 'LLM_EXTRACTION_FAILED' }));

    const result = await pollJob(getJob, 'job-2').next();

    expect(result).toEqual({
      value: { kind: 'failed', reason: 'server', message: 'LLM_EXTRACTION_FAILED' },
      done: true,
    });
  });

  it('falls back to a generic message when a failed job has no error code', async () => {
    const getJob = vi.fn().mockResolvedValue(stubJob('failed'));

    const result = await pollJob(getJob, 'job-3').next();

    expect((result.value as UploadStage & { kind: 'failed' }).message).toBe('PARSE_FAILED');
  });

  it('gives up with a timeout stage once the deadline passes, without throwing', async () => {
    // timeoutMs: 0 makes the deadline check deterministic without advancing
    // fake timers — Date.now() has not moved by the time the first getJob()
    // resolves, so `now >= deadline` is true on the very first check.
    const getJob = vi.fn().mockResolvedValue(stubJob('processing'));

    const result = await pollJob(getJob, 'job-4', { timeoutMs: 0 }).next();

    expect(result).toEqual({
      value: { kind: 'failed', reason: 'timeout', message: 'POLL_TIMEOUT' },
      done: true,
    });
    expect(getJob).toHaveBeenCalledTimes(1);
  });

  it('stops calling getJob once a consumer breaks out of a for-await loop', async () => {
    vi.useFakeTimers();
    const getJob = vi.fn().mockResolvedValue(stubJob('processing'));

    const seen: UploadStage[] = [];
    for await (const stage of pollJob(getJob, 'job-5', { intervalMs: 1000, timeoutMs: 10_000 })) {
      seen.push(stage);
      break;
    }

    expect(seen).toEqual([{ kind: 'polling', jobId: 'job-5', status: 'processing' }]);
    expect(getJob).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(getJob).toHaveBeenCalledTimes(1);
  });
});
