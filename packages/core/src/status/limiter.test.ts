import { describe, expect, it } from 'vitest';
import { createLimiter } from './limiter.js';

describe('createLimiter', () => {
  it('never exceeds the configured concurrency', async () => {
    const limit = createLimiter(2);
    let active = 0;
    let maximum = 0;
    const release: Array<() => void> = [];

    const tasks = Array.from({ length: 5 }, (_, index) =>
      limit(
        () =>
          new Promise<number>((resolve) => {
            active += 1;
            maximum = Math.max(maximum, active);
            release.push(() => {
              active -= 1;
              resolve(index);
            });
          }),
      ),
    );

    expect(active).toBe(2);
    release.shift()?.();
    release.shift()?.();
    await Promise.resolve();
    expect(active).toBe(2);
    release.shift()?.();
    release.shift()?.();
    release.shift()?.();
    await expect(Promise.all(tasks)).resolves.toHaveLength(5);
    expect(maximum).toBe(2);
  });

  it('releases a permit when a task rejects', async () => {
    const limit = createLimiter(1);
    const error = new Error('expected');

    await expect(limit(() => Promise.reject(error))).rejects.toBe(error);
    await expect(limit(() => Promise.resolve('ok'))).resolves.toBe('ok');
  });

  it('rejects invalid concurrency', () => {
    expect(() => createLimiter(0)).toThrow();
  });
});
