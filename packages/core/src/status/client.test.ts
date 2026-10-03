import { describe, expect, it, vi } from 'vitest';
import {
  createStatusClient,
  STATUS_API_BASE_URL,
} from './client.js';
import {
  AuthError,
  BadRequestError,
  ProtocolError,
  QuotaExhaustedError,
  TransientError,
} from './errors.js';
import { BudgetExhaustedError, RequestBudget } from './budget.js';
import { DevVerifyError } from '../errors.js';

const FINGERPRINT = 'AB'.repeat(32);
const NORMALIZED_FINGERPRINT = FINGERPRINT.toLowerCase();

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

function clientOptions(fetcher: typeof fetch) {
  return {
    apiKey: 'AIza' + 'x'.repeat(35),
    fetch: fetcher,
    sleep: vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined),
    random: vi.fn(() => 0.5),
  };
}

describe('createStatusClient', () => {
  it.each([
    ['dots', 'com.example.app', 'com.example.app'],
    ['hyphens', 'com.example.app', 'com-example-app'],
  ] as const)('supports %s package path encoding', (encoding, packageName, pathName) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(200, { name: packageName, state: 'REGISTERED' }),
    );

    const client = createStatusClient({
      ...clientOptions(fetcher),
      packageNameEncoding: encoding,
    });

    return client.check(packageName).then(() => {
      const [url, init] = fetcher.mock.calls[0] ?? [];
      expect(url).toBe(
        STATUS_API_BASE_URL +
          '/v1/packages/' +
          pathName +
          '/packageRegistrationStatus:check',
      );
      expect(init?.headers).toEqual({
        Accept: 'application/json',
        'X-Goog-Api-Key': 'AIza' + 'x'.repeat(35),
      });
    });
  });

  it('defaults package encoding to dots', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(200, { name: 'com.example.app', state: 'REGISTERED' }),
    );
    const client = createStatusClient(clientOptions(fetcher));

    await client.check('com.example.app');

    const [url] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe(
      STATUS_API_BASE_URL +
        '/v1/packages/com.example.app/packageRegistrationStatus:check',
    );
  });

  it('puts a lowercase fingerprint only in the query string', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(200, {
        name: 'com.example.app',
        state: 'REGISTERED',
      }),
    );
    const client = createStatusClient(clientOptions(fetcher));

    const result = await client.check('com.example.app', FINGERPRINT);

    expect(result.fingerprint).toBe(NORMALIZED_FINGERPRINT);
    const [url] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe(
      STATUS_API_BASE_URL +
        '/v1/packages/com.example.app/packageRegistrationStatus:check?certificateFingerprint=' +
        NORMALIZED_FINGERPRINT,
    );
  });

  it('validates package and fingerprint before making a request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createStatusClient(clientOptions(fetcher));

    await expect(client.check('1com.example.app')).rejects.toMatchObject({
      code: 'INVALID_PACKAGE_NAME',
    });
    await expect(client.check('com.example.app', 'bad')).rejects.toMatchObject({
      code: 'INVALID_FINGERPRINT',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('maps unknown API states while preserving rawState', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(200, {
        name: 'com.example.app',
        state: 'NEW_STATE',
        extra: true,
      }),
    );
    const client = createStatusClient(clientOptions(fetcher));

    await expect(client.check('com.example.app')).resolves.toEqual({
      package: 'com.example.app',
      state: 'UNKNOWN',
      rawState: 'NEW_STATE',
    });
  });

  it('rejects malformed success JSON with ProtocolError', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('not-json', { status: 200 }),
    );
    const client = createStatusClient(clientOptions(fetcher));

    await expect(client.check('com.example.app')).rejects.toBeInstanceOf(ProtocolError);
  });

  it('rejects a success body missing required fields', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(200, { name: 'com.example.app' }),
    );
    const client = createStatusClient(clientOptions(fetcher));

    await expect(client.check('com.example.app')).rejects.toBeInstanceOf(ProtocolError);
  });

  it.each([
    [400, BadRequestError],
    [401, AuthError],
    [403, AuthError],
  ] as const)('maps HTTP %s to the documented error class', async (status, errorType) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(status, {
        error: {
          code: status,
          message: 'rejected',
          status: status === 400 ? 'INVALID_ARGUMENT' : 'AUTH',
        },
      }),
    );
    const client = createStatusClient(clientOptions(fetcher));

    await expect(client.check('com.example.app')).rejects.toBeInstanceOf(errorType);
  });

  it('handles malformed JSON bodies for documented HTTP errors without failing open', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('not-json', { status: 400 }),
    );
    const client = createStatusClient(clientOptions(fetcher));

    await expect(client.check('com.example.app')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Status API rejected the request.',
    });
  });

  it('retries 5xx using exponential full jitter', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(500, { error: { message: 'server' } }))
      .mockResolvedValueOnce(response(503, { error: { message: 'server' } }))
      .mockResolvedValueOnce(
        response(200, {
          name: 'com.example.app',
          state: 'NOT_REGISTERED',
        }),
      );
    const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
    const client = createStatusClient({
      ...clientOptions(fetcher),
      sleep,
      random: () => 0.5,
    });

    await expect(client.check('com.example.app')).resolves.toMatchObject({
      state: 'NOT_REGISTERED',
    });
    expect(sleep).toHaveBeenNthCalledWith(1, 250);
    expect(sleep).toHaveBeenNthCalledWith(2, 500);
  });

  it('throws TransientError after the final 5xx attempt', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(500, { error: { message: 'server' } }),
    );
    const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
    const client = createStatusClient({
      ...clientOptions(fetcher),
      sleep,
      maxAttempts: 4,
      random: () => 0.5,
    });

    await expect(client.check('com.example.app')).rejects.toBeInstanceOf(TransientError);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([250, 500, 1_000]);
  });

  it('retries a 429 with Retry-After <= 30 seconds', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(
          429,
          { error: { message: 'busy' } },
          { 'Retry-After': '5' },
        ),
      )
      .mockResolvedValueOnce(
        response(200, {
          name: 'com.example.app',
          state: 'REGISTERED',
        }),
      );
    const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
    const client = createStatusClient({ ...clientOptions(fetcher), sleep });

    await expect(client.check('com.example.app')).resolves.toMatchObject({
      state: 'REGISTERED',
    });
    expect(sleep).toHaveBeenCalledWith(5_000);
  });

  it.each(['120', undefined])(
    'aborts a 429 when Retry-After is %s',
    async (retryAfter) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        response(
          429,
          { error: { message: 'busy' } },
          retryAfter === undefined ? undefined : { 'Retry-After': retryAfter },
        ),
      );
      const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
      const client = createStatusClient({ ...clientOptions(fetcher), sleep });

      await expect(client.check('com.example.app')).rejects.toBeInstanceOf(
        QuotaExhaustedError,
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    },
  );

  it('stops 429 retries after two retries', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        response(429, { error: { message: 'busy' } }, { 'Retry-After': '5' }),
      );
    const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
    const client = createStatusClient({ ...clientOptions(fetcher), sleep });

    await expect(client.check('com.example.app')).rejects.toBeInstanceOf(
      QuotaExhaustedError,
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('charges the request budget for retries before every HTTP attempt', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(500, { error: { message: 'server' } }),
    );
    const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
    const budget = new RequestBudget(2);
    const client = createStatusClient({
      ...clientOptions(fetcher),
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
    const apiKey = 'AIza' + 'y'.repeat(35);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(500, { error: { message: 'server: ' + apiKey } }),
    );
    const client = createStatusClient({
      ...clientOptions(fetcher),
      apiKey,
      maxAttempts: 1,
    });

    const error = await client.check('com.example.app').catch((value: unknown) => value);
    expect(error).toBeInstanceOf(TransientError);
    expect(JSON.stringify(error)).not.toContain(apiKey);
    expect(String(error)).not.toContain(apiKey);
  });

  it('retries network failures', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(
        response(200, {
          name: 'com.example.app',
          state: 'REGISTERED',
        }),
      );
    const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
    const client = createStatusClient({
      ...clientOptions(fetcher),
      sleep,
      random: () => 0,
    });

    await expect(client.check('com.example.app')).resolves.toMatchObject({
      state: 'REGISTERED',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(0);
  });

  it('turns a timeout into a TransientError', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<typeof fetch>().mockImplementation(
        () => new Promise<Response>(() => undefined),
      );
      const client = createStatusClient({
        ...clientOptions(fetcher),
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

  it('exposes request telemetry without the API key', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(200, {
        name: 'com.example.app',
        state: 'REGISTERED',
      }),
    );
    const onRequest = vi.fn();
    const apiKey = 'AIza' + 'z'.repeat(35);
    const client = createStatusClient({
      ...clientOptions(fetcher),
      apiKey,
      onRequest,
    });

    await client.check('com.example.app');

    expect(onRequest).toHaveBeenCalledWith({
      package: 'com.example.app',
      url: expect.any(String),
      attempt: 1,
    });
    expect(JSON.stringify(onRequest.mock.calls)).not.toContain(apiKey);
  });

  it('rejects invalid configuration', () => {
    const fetcher = vi.fn<typeof fetch>();

    expect(() =>
      createStatusClient({
        ...clientOptions(fetcher),
        apiKey: '',
      }),
    ).toThrowError(DevVerifyError);

    expect(() =>
      createStatusClient({
        ...clientOptions(fetcher),
        timeoutMs: 0,
      }),
    ).toThrowError(DevVerifyError);

    expect(() =>
      createStatusClient({
        ...clientOptions(fetcher),
        maxAttempts: 0,
      }),
    ).toThrowError(DevVerifyError);
  });
});
