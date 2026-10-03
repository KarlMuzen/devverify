import { DevVerifyError } from '../errors.js';

export type LimitTask<T> = () => Promise<T>;
export type Limiter = <T>(task: LimitTask<T>) => Promise<T>;

export function createLimiter(concurrency: number): Limiter {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new DevVerifyError(
      'INVALID_CONCURRENCY',
      'Limiter concurrency must be a positive safe integer.',
    );
  }

  let available = concurrency;
  const waiters: Array<() => void> = [];

  async function acquire(): Promise<void> {
    if (available > 0) {
      available -= 1;
      return;
    }

    await new Promise<void>((resolve) => {
      waiters.push(resolve);
    });
  }

  function release(): void {
    const next = waiters.shift();
    if (next !== undefined) {
      next();
    } else {
      available += 1;
    }
  }

  return async <T>(task: LimitTask<T>): Promise<T> => {
    await acquire();
    try {
      return await task();
    } finally {
      release();
    }
  };
}
