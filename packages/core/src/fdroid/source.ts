import type { PackageSource, SourceLoadOptions, SourceSnapshot, SourceValidators } from '../source.js';
import { SourceFetchError } from '../source.js';
import { parseSignerIndex } from './signer-index.js';

export const FDROID_SIGNER_INDEX_URL = 'https://f-droid.org/repo/signer-index.json';
export const MAX_SIGNER_INDEX_BYTES = 50 * 1024 * 1024;
export const SIGNER_INDEX_TIMEOUT_MS = 60_000;

interface FdroidSourceOptions {
  url: string;
}

function validatorsFromResponse(
  response: Response,
  fallback?: SourceValidators,
): SourceValidators | undefined {
  const etag = response.headers.get('ETag') ?? fallback?.etag;
  const lastModified =
    response.headers.get('Last-Modified') ?? fallback?.lastModified;

  if (etag === undefined && lastModified === undefined) {
    return undefined;
  }

  return {
    ...(etag === undefined ? {} : { etag }),
    ...(lastModified === undefined ? {} : { lastModified }),
  };
}

async function fetchWithTimeout(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(
          new SourceFetchError(
            'F-Droid signer-index request timed out after 60 seconds.',
          ),
        );
      }, SIGNER_INDEX_TIMEOUT_MS);
    });

    return await Promise.race([
      fetcher(url, { ...init, signal: controller.signal }),
      timeout,
    ]);
  } catch (error) {
    if (error instanceof SourceFetchError) {
      throw error;
    }

    if (timedOut) {
      throw new SourceFetchError(
        'F-Droid signer-index request timed out after 60 seconds.',
      );
    }

    throw new SourceFetchError('F-Droid signer-index request failed.');
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

async function readBody(
  response: Response,
): Promise<string> {
  if (response.body === null) {
    return response.text();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }

      const chunk = result.value;
      total += chunk.byteLength;
      if (total > MAX_SIGNER_INDEX_BYTES) {
        await reader.cancel();
        throw new SourceFetchError('F-Droid signer-index body exceeds 50 MiB.');
      }

      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof SourceFetchError) {
      throw error;
    }
    throw new SourceFetchError('F-Droid signer-index response body could not be read.');
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(bytes);
}

function snapshot(
  parsed: ReturnType<typeof parseSignerIndex>,
  response: Response,
  fetchedAt: string,
): SourceSnapshot {
  const validators = validatorsFromResponse(response);
  return {
    entries: parsed.entries.map((entry) => ({
      package: entry.package,
      fingerprints: [...entry.fingerprints],
    })),
    ...(validators === undefined ? {} : { validators }),
    fetchedAt,
    warnings: [...parsed.warnings],
  };
}

export function createFdroidSource({ url }: FdroidSourceOptions): PackageSource {
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== 'https:') {
    throw new SourceFetchError('F-Droid signer-index URL must use HTTPS.');
  }

  return {
    id: 'fdroid-signer-index',

    async load(opts: SourceLoadOptions): Promise<SourceSnapshot> {
      const fetcher = opts.fetch ?? globalThis.fetch;
      if (fetcher === undefined) {
        throw new SourceFetchError('Fetch is not available in this runtime.');
      }

      const headers = new Headers({ Accept: 'application/json' });
      if (opts.validators?.etag !== undefined) {
        headers.set('If-None-Match', opts.validators.etag);
      }
      if (opts.validators?.lastModified !== undefined) {
        headers.set('If-Modified-Since', opts.validators.lastModified);
      }

      const response = await fetchWithTimeout(fetcher, url, {
        method: 'GET',
        headers,
      });
      const fetchedAt = new Date().toISOString();

      if (response.status === 304) {
        const validators = validatorsFromResponse(response, opts.validators);
        return {
          entries: [],
          ...(validators === undefined ? {} : { validators }),
          notModified: true,
          fetchedAt,
          warnings: [],
        };
      }

      if (response.status !== 200) {
        throw new SourceFetchError(
          `F-Droid signer-index returned HTTP ${response.status}.`,
          response.status,
        );
      }

      const contentLength = response.headers.get('Content-Length');
      if (contentLength !== null) {
        const bytes = Number(contentLength);
        if (Number.isSafeInteger(bytes) && bytes > MAX_SIGNER_INDEX_BYTES) {
          throw new SourceFetchError('F-Droid signer-index body exceeds 50 MiB.', 200);
        }
      }

      const body = await readBody(response);

      let json: unknown;
      try {
        json = JSON.parse(body) as unknown;
      } catch {
        throw new SourceFetchError('F-Droid signer-index returned invalid JSON.', 200);
      }

      const parsed = parseSignerIndex(json);
      return snapshot(parsed, response, fetchedAt);
    },
  };
}
