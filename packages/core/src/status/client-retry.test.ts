import { describe, expect, it, vi } from 'vitest';
import { createStatusClient } from './client.js';
import {
  AuthError,
  BadRequestError,
  ProtocolError,
  QuotaExhaustedError,
  TransientError,
} from './errors.js';
import { BudgetExhaustedError, RequestBudget } from './budget.js';

const API_KEY = 'AIza' + 'y'.repeat(35);

function response(
  status: number,
  body: unknown,
  headers?: Record<string, string>,
): Response {
  return new Response(body === undefined ? undefined : JSON.stringify(body), {
    status,
    headers,
  });
}

function options(fetcher: typeof fetch) {
  return {
    apiKey: API_KEY,
    fetch: fetcher,
    sleep: vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined),
    random: vi.fn(() => 0.5),
  };
}

describe('status client errors, retries, and budget', () => {
  it.each([
    [400, BadRequestError],
    [401, AuthError],
    [403, AuthError],
  ] as const)('maps HTTP %s correctly', async (status, errorType) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(status, {
        error: { code: status, message: 'rejected' },
      }),
    );
    const client = createStatusClient(options(fetcher));

    await expect(client.check('com.example.app')).rejects.toBeInstanceOf(
      errorType,
    );
  });

  it.each([500, 503])('retries documented %s errors', async (status) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(status, { error: { message: 'server' } }))
      .mockResolvedValueOnce(
        response(200, {
          name: 'com.example.app',
          state: 'NOT_REGISTERED',
        }),
      );
    const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);

    const client = createStatusClient({
      ...options(fetcher),
      sleep,
      random: () => 0.5,
    });

    await expect(client.check('com.example.app')).resolves.toMatchObject({
      state: 'NOT_REGISTERED',
    });
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it('uses exponential backoff and full jitter across multiple 5xx retries', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(500, { error: { message: 'server' } }))
      .mockResolvedValueOnce(response(503, { error: { message: 'server' } }))
      .mockResolvedValueOnce(response(500, { error: { message: 'server' } }))
      .mockResolvedValueOnce(
        response(200, { name: 'com.example.app', state: 'REGISTERED' }),
      );
    const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);

    const client = createStatusClient({
      ...options(fetcher),
      sleep,
      random: () => 0.5,
    });

    await client.check('com.example.app');
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([250, 500, 1_000]);
  });

  it('throws TransientError after maxAttempts', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(500, { error: { message: 'server' } }),
    );
    const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
    const client = createStatusClient({
      ...options(fetcher),
      sleep,
      maxAttempts: 4,
      random: () => 0.5,
    });

    await expect(client.check('com.example.app')).rejects.toBeInstanceOf(
      TransientError,
    );
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('retries a 429 for a short Retry-After', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(429, { error: { message: 'busy' } }, { 'Retry-After': '5' }),
      )
      .mockResolvedValueOnce(
        response(200, { name: 'com.example.app', state: 'REGISTERED' }),
      );
    const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
    const client = createStatusClient({ ...options(fetcher), sleep });

    await expect(client.check('com.example.app')).resolves.toMatchObject({
      state: 'REGISTERED',
    });
    expect(sleep).toHaveBeenCalledWith(5_000);
  });

  it.each([undefined, '120'])(
    'aborts 429 when Retry-After is missing or too long',
    async (retryAfter) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        response(
          429,
          { error: { message: 'busy' } },
          retryAfter === undefined ? undefined : { 'Retry-After': retryAfter },
        ),
      );
      const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
      const client = createStatusClient({ ...options(fetcher), sleep });

      await expect(client.check('com.example.app')).rejects.toBeInstanceOf(
        QuotaExhaustedError,
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    },
  );

  it('caps 429 retries at two retries', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(429, { error: { message: 'busy' } }, { 'Retry-After': '5' }),
    );
    const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
    const client = createStatusClient({ ...options(fetcher), sleep });

    await expect(client.check('com.example.app')).rejects.toBeInstanceOf(
      QuotaExhaustedError,
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('charges request budget on every HTTP attempt', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(500, { error: { message: 'server' } }),
    );
    const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
    const budget = new RequestBudget(2);
    const client = createStatusClient({
      ...options(fetcher),
      budget,
      sleep,
      random: () => 0,
    });

    await expect(client.check('com.example.app')).rejects.toBeInstanceOf(
      BudgetExhaustedError,
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(budget.remaining).toBe(0);
  });

  it('redacts the API key from errors', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(500, { error: { message: 'server: ' + API_KEY } }),
    );
    const client = createStatusClient({
      ...options(fetcher),
      maxAttempts: 1,
    });

    const error = await client.check('com.example.app').catch((value: unknown) => value);
    expect(error).toBeInstanceOf(TransientError);
    expect(JSON.stringify(error)).not.toContain(API_KEY);
    expect(String(error)).not.toContain(API_KEY);
  });

  it('retries network errors', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(
        response(200, { name: 'com.example.app', state: 'REGISTERED' }),
      );
    const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
    const client = createStatusClient({
      ...options(fetcher),
      sleep,
      random: () => 0,
    });

    await expect(client.check('com.example.app')).resolves.toMatchObject({
      state: 'REGISTERED',
    });
    expect(sleep).toHaveBeenCalledWith(0);
  });

  it('converts timeout to TransientError without leaking details', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<typeof fetch>().mockImplementation(
        () => new Promise<Response>(() => undefined),
      );
      const client = createStatusClient({
        ...options(fetcher),
        maxAttempts: 1,
        timeoutMs: 1_000,
      });
      const pending = client.check('com.example.app');
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(pending).rejects.toBeInstanceOf(TransientError);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses only the API key header for authentication', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(200, { name: 'com.example.app', state: 'REGISTERED' }),
    );
    const client = createStatusClient(options(fetcher));

    await client.check('com.example.app');

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).not.toContain(API_KEY);
    expect(init?.headers).toEqual({
      Accept: 'application/json',
      'X-Goog-Api-Key': API_KEY,
    });
  });

  it('maps unexpected HTTP status to ProtocolError', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('unexpected', { status: 418 }),
    );
    const client = createStatusClient(options(fetcher));

    await expect(client.check('com.example.app')).rejects.toBeInstanceOf(
      ProtocolError,
    );
  });
});
