import { describe, expect, it, vi } from 'vitest';
import { SourceFetchError, SourceFormatError } from '../source.js';
import {
  createFdroidSource,
  FDROID_SIGNER_INDEX_URL,
  MAX_SIGNER_INDEX_BYTES,
  SIGNER_INDEX_TIMEOUT_MS,
} from './source.js';

const FINGERPRINT = '11'.repeat(32);
const BODY = JSON.stringify({
  'com.example.app': [FINGERPRINT],
});

function jsonResponse(body: string, status = 200, headers?: Record<string, string>): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

describe('createFdroidSource', () => {
  it('loads entries and sends conditional validators', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    try {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(BODY, 200, {
          ETag: '"abc"',
          'Last-Modified': 'Wed, 01 Jan 2026 00:00:00 GMT',
        }),
      );
      const source = createFdroidSource({ url: FDROID_SIGNER_INDEX_URL });

      const result = await source.load({
        fetch: fetcher,
        validators: {
          etag: '"old"',
          lastModified: 'Tue, 31 Dec 2025 00:00:00 GMT',
        },
      });

      expect(result).toMatchObject({
        entries: [
          {
            package: 'com.example.app',
            fingerprints: [FINGERPRINT],
          },
        ],
        validators: {
          etag: '"abc"',
          lastModified: 'Wed, 01 Jan 2026 00:00:00 GMT',
        },
        fetchedAt: '2026-01-01T00:00:00.000Z',
        warnings: [],
      });

      const [url, init] = fetcher.mock.calls[0] ?? [];
      const headers = new Headers(init?.headers);
      expect(url).toBe(FDROID_SIGNER_INDEX_URL);
      expect(headers.get('If-None-Match')).toBe('"old"');
      expect(headers.get('If-Modified-Since')).toBe(
        'Tue, 31 Dec 2025 00:00:00 GMT',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('handles 304 and preserves validators', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T00:00:00.000Z'));

    try {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(null, {
          status: 304,
          headers: {
            ETag: '"same"',
          },
        }),
      );
      const source = createFdroidSource({ url: FDROID_SIGNER_INDEX_URL });

      await expect(
        source.load({
          fetch: fetcher,
          validators: {
            etag: '"same"',
            lastModified: 'Thu, 01 Jan 2026 00:00:00 GMT',
          },
        }),
      ).resolves.toEqual({
        entries: [],
        validators: {
          etag: '"same"',
          lastModified: 'Thu, 01 Jan 2026 00:00:00 GMT',
        },
        notModified: true,
        fetchedAt: '2026-01-02T00:00:00.000Z',
        warnings: [],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a response whose declared body is over 50 MiB', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse('', 200, {
        'Content-Length': String(MAX_SIGNER_INDEX_BYTES + 1),
      }),
    );
    const source = createFdroidSource({ url: FDROID_SIGNER_INDEX_URL });

    await expect(source.load({ fetch: fetcher })).rejects.toMatchObject({
      code: 'SOURCE_FETCH_ERROR',
    });
  });

  it('rejects invalid JSON as SourceFetchError', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse('not-json'),
    );
    const source = createFdroidSource({ url: FDROID_SIGNER_INDEX_URL });

    await expect(source.load({ fetch: fetcher })).rejects.toBeInstanceOf(
      SourceFetchError,
    );
  });

  it('surfaces malformed JSON as a format error from the parser', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(JSON.stringify({ foo: { bar: 'baz' } })),
    );
    const source = createFdroidSource({ url: FDROID_SIGNER_INDEX_URL });

    await expect(source.load({ fetch: fetcher })).rejects.toBeInstanceOf(
      SourceFormatError,
    );
  });

  it('rejects non-success HTTP responses', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 500 }),
    );
    const source = createFdroidSource({ url: FDROID_SIGNER_INDEX_URL });

    await expect(source.load({ fetch: fetcher })).rejects.toMatchObject({
      code: 'SOURCE_FETCH_ERROR',
      status: 500,
    });
  });

  it('enforces the 60 second timeout', async () => {
    vi.useFakeTimers();

    try {
      const fetcher = vi.fn<typeof fetch>().mockImplementation(
        () => new Promise<Response>(() => undefined),
      );
      const source = createFdroidSource({ url: FDROID_SIGNER_INDEX_URL });

      const pending = source.load({ fetch: fetcher });
      const assertion = expect(pending).rejects.toMatchObject({
        code: 'SOURCE_FETCH_ERROR',
      });
      await vi.advanceTimersByTimeAsync(SIGNER_INDEX_TIMEOUT_MS);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('requires an HTTPS URL', () => {
    expect(() => createFdroidSource({ url: 'http://example.test/signer-index.json' }))
      .toThrowError(SourceFetchError);
  });
});
