import { describe, expect, it } from 'vitest';
import {
  defaultSleep,
  parseRetryAfterSeconds,
  retryDelayMs,
  waitBeforeRetry,
} from './retry.js';

describe('retry helpers', () => {
  it('uses exponential caps with full jitter', () => {
    expect(retryDelayMs(0, () => 0)).toBe(0);
    expect(retryDelayMs(1, () => 0.5)).toBe(500);
    expect(retryDelayMs(10, () => 1)).toBe(8_000);
    expect(retryDelayMs(0, () => -1)).toBe(0);
  });

  it('parses safe Retry-After seconds and rejects other forms', () => {
    expect(parseRetryAfterSeconds('5')).toBe(5);
    expect(parseRetryAfterSeconds('0')).toBe(0);
    expect(parseRetryAfterSeconds(' 30 ')).toBe(30);
    expect(parseRetryAfterSeconds('01')).toBeUndefined();
    expect(parseRetryAfterSeconds('-1')).toBeUndefined();
    expect(parseRetryAfterSeconds('abc')).toBeUndefined();
    expect(parseRetryAfterSeconds(null)).toBeUndefined();
  });

  it('delegates transient backoff to the injected sleep', async () => {
    const calls: number[] = [];
    const sleep = async (ms: number): Promise<void> => {
      calls.push(ms);
    };

    await waitBeforeRetry(2, sleep, () => 0.5);
    expect(calls).toEqual([1_000]);
  });

  it('provides a default sleep implementation', async () => {
    await expect(defaultSleep(0)).resolves.toBeUndefined();
  });
});
