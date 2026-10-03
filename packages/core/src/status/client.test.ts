import { describe, expect, it, vi } from 'vitest';
import { createStatusClient, STATUS_API_BASE_URL } from './client.js';
import { ProtocolError } from './errors.js';
import { DevVerifyError } from '../errors.js';

const FINGERPRINT = 'AB'.repeat(32);
const API_KEY = 'AIza' + 'x'.repeat(35);

function response(status: number, body: unknown, headers?: Record<string, string>): Response {
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

describe('createStatusClient request/response behavior', () => {
  it.each([
    ['dots', 'com.example.app', 'com.example.app'],
    ['hyphens', 'com.example.app', 'com-example-app'],
  ] as const)('supports %s package path encoding', (encoding, pkg, pathPkg) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(200, { name: pkg, state: 'REGISTERED' }),
    );
    const client = createStatusClient({ ...options(fetcher), packageNameEncoding: encoding });

    return client.check(pkg).then(() => {
      const [url, init] = fetcher.mock.calls[0] ?? [];
      expect(url).toBe(
        STATUS_API_BASE_URL +
          '/v1/packages/' +
          pathPkg +
          '/packageRegistrationStatus:check',
      );
      expect(init?.headers).toEqual({
        Accept: 'application/json',
        'X-Goog-Api-Key': API_KEY,
      });
    });
  });

  it('defaults to dot encoding', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(200, { name: 'com.example.app', state: 'REGISTERED' }),
    );
    const client = createStatusClient(options(fetcher));

    await client.check('com.example.app');
    const [url] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe(
      STATUS_API_BASE_URL +
        '/v1/packages/com.example.app/packageRegistrationStatus:check',
    );
  });

  it('normalizes the fingerprint query to lowercase hex', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(200, { name: 'com.example.app', state: 'REGISTERED' }),
    );
    const client = createStatusClient(options(fetcher));

    const result = await client.check('com.example.app', FINGERPRINT);
    const [url] = fetcher.mock.calls[0] ?? [];

    expect(result.fingerprint).toBe(FINGERPRINT.toLowerCase());
    expect(url).toContain(
      '?certificateFingerprint=' + FINGERPRINT.toLowerCase(),
    );
  });

  it('validates package and fingerprint before any request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createStatusClient(options(fetcher));

    await expect(client.check('1com.example.app')).rejects.toMatchObject({
      code: 'INVALID_PACKAGE_NAME',
    });
    await expect(client.check('com.example.app', 'bad')).rejects.toMatchObject({
      code: 'INVALID_FINGERPRINT',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('maps unknown state to UNKNOWN and preserves rawState', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(200, {
        name: 'com.example.app',
        state: 'FUTURE_STATE',
        extra: true,
      }),
    );
    const client = createStatusClient(options(fetcher));

    await expect(client.check('com.example.app')).resolves.toEqual({
      package: 'com.example.app',
      state: 'UNKNOWN',
      rawState: 'FUTURE_STATE',
    });
  });

  it.each([
    'not-json',
    JSON.stringify({ name: 'com.example.app' }),
  ])('turns malformed success payloads into ProtocolError', async (body) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(body, { status: 200 }),
    );
    const client = createStatusClient(options(fetcher));

    await expect(client.check('com.example.app')).rejects.toBeInstanceOf(
      ProtocolError,
    );
  });

  it('does not retry documented client errors', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('not-json', { status: 400 }),
    );
    const client = createStatusClient({
      ...options(fetcher),
      maxAttempts: 4,
    });

    await expect(client.check('com.example.app')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid base URL before sending a request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createStatusClient({
      ...options(fetcher),
      baseUrl: '://bad',
    });

    await expect(client.check('com.example.app')).rejects.toBeInstanceOf(
      DevVerifyError,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects invalid configuration at construction', () => {
    const fetcher = vi.fn<typeof fetch>();

    expect(() =>
      createStatusClient({ ...options(fetcher), apiKey: '' }),
    ).toThrowError(DevVerifyError);
    expect(() =>
      createStatusClient({ ...options(fetcher), timeoutMs: 0 }),
    ).toThrowError(DevVerifyError);
    expect(() =>
      createStatusClient({ ...options(fetcher), maxAttempts: 0 }),
    ).toThrowError(DevVerifyError);
  });
});
