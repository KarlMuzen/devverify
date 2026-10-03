import { z } from 'zod';
import { assertPackageName } from '../package-name.js';
import { normalizeFingerprint } from '../fingerprint.js';
import { DevVerifyError } from '../errors.js';
import {
  AuthError,
  BadRequestError,
  ProtocolError,
  QuotaExhaustedError,
  TransientError,
} from './errors.js';
import { RequestBudget } from './budget.js';
import {
  MAX_QUOTA_RETRIES,
  defaultSleep,
  parseRetryAfterSeconds,
  retryDelayMs,
  type Random,
  type Sleep,
  waitBeforeRetry,
} from './retry.js';
import { mapApiState } from './types.js';
import { redactSecrets } from './redact.js';

export const STATUS_API_BASE_URL = 'https://androiddeveloperidstatus.googleapis.com';

const statusResponseSchema = z
  .object({
    name: z.string(),
    state: z.string(),
  })
  .passthrough();

const errorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.number().optional(),
        message: z.string().optional(),
        status: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

interface StatusErrorPayload {
  message?: string;
  status?: string;
}

export interface StatusCheckResult {
  package: string;
  fingerprint?: string;
  state: ReturnType<typeof mapApiState>;
  rawState: string;
}

export interface StatusRequestInfo {
  package: string;
  fingerprint?: string;
  url: string;
  attempt: number;
}

export interface StatusClientOptions {
  apiKey: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  packageNameEncoding?: 'dots' | 'hyphens';
  timeoutMs?: number;
  maxAttempts?: number;
  sleep?: Sleep;
  random?: Random;
  budget?: RequestBudget;
  onRequest?: (info: StatusRequestInfo) => void;
}

export interface StatusClient {
  check(packageName: string, fingerprint?: string): Promise<StatusCheckResult>;
}

class RequestTimeoutError extends Error {
  public constructor() {
    super('Status API request timed out.');
    this.name = 'RequestTimeoutError';
  }
}

function validateOptions(options: StatusClientOptions): void {
  if (options.apiKey.length === 0) {
    throw new DevVerifyError('INVALID_API_KEY', 'An API key is required.');
  }

  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new DevVerifyError(
      'INVALID_TIMEOUT',
      'Status API timeout must be a positive safe integer.',
    );
  }

  const maxAttempts = options.maxAttempts ?? 4;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new DevVerifyError(
      'INVALID_MAX_ATTEMPTS',
      'Status API maxAttempts must be a positive safe integer.',
    );
  }

  const encoding = options.packageNameEncoding ?? 'dots';
  if (encoding !== 'dots' && encoding !== 'hyphens') {
    throw new DevVerifyError('INVALID_PACKAGE_ENCODING', 'Unsupported package-name encoding.');
  }
}

function requestUrl(
  baseUrl: string,
  packageName: string,
  fingerprint: string | undefined,
  encoding: 'dots' | 'hyphens',
): string {
  const encodedPackage =
    encoding === 'hyphens' ? packageName.replaceAll('.', '-') : packageName;
  const base = baseUrl.replace(/\/+$/, '');
  const url = new URL(
    'v1/packages/' +
      encodeURIComponent(encodedPackage) +
      '/packageRegistrationStatus:check',
    base + '/',
  );

  if (fingerprint !== undefined) {
    url.searchParams.set('certificateFingerprint', fingerprint);
  }

  return url.toString();
}

function errorPayload(text: string): StatusErrorPayload {
  try {
    const parsed: unknown = JSON.parse(text);
    const result = errorResponseSchema.safeParse(parsed);
    if (!result.success) {
      return {};
    }

    return {
      message: result.data.error.message,
      status: result.data.error.status,
    };
  } catch {
    return {};
  }
}

function safeMessage(
  message: string | undefined,
  fallback: string,
  apiKey: string,
): string {
  return redactSecrets(message?.trim() || fallback, [apiKey]);
}

async function fetchWithTimeout(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new RequestTimeoutError());
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      fetcher(url, { ...init, signal: controller.signal }),
      timeout,
    ]);
  } catch (error) {
    if (timedOut || error instanceof RequestTimeoutError) {
      throw new RequestTimeoutError();
    }
    throw error;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

async function responseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    throw new ProtocolError(
      'Status API response body could not be read.',
      response.status,
    );
  }
}

export function createStatusClient(options: StatusClientOptions): StatusClient {
  validateOptions(options);

  const fetcher = options.fetch ?? globalThis.fetch;
  if (fetcher === undefined) {
    throw new DevVerifyError(
      'FETCH_UNAVAILABLE',
      'Fetch is not available in this runtime.',
    );
  }

  const baseUrl = options.baseUrl ?? STATUS_API_BASE_URL;
  const encoding = options.packageNameEncoding ?? 'dots';
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxAttempts = options.maxAttempts ?? 4;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  return {
    async check(packageName, fingerprint) {
      const pkg = assertPackageName(packageName);
      const normalizedFingerprint =
        fingerprint === undefined ? undefined : normalizeFingerprint(fingerprint);
      const url = requestUrl(baseUrl, pkg, normalizedFingerprint, encoding);

      let transientRetries = 0;
      let quotaRetries = 0;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        options.budget?.take();
        options.onRequest?.({
          package: pkg,
          ...(normalizedFingerprint === undefined
            ? {}
            : { fingerprint: normalizedFingerprint }),
          url,
          attempt,
        });

        try {
          const response = await fetchWithTimeout(
            fetcher,
            url,
            {
              method: 'GET',
              headers: {
                Accept: 'application/json',
                'X-Goog-Api-Key': options.apiKey,
              },
            },
            timeoutMs,
          );

          const body = await responseText(response);

          if (response.status === 200) {
            let parsed: unknown;
            try {
              parsed = JSON.parse(body);
            } catch {
              throw new ProtocolError(
                'Status API returned invalid JSON.',
                response.status,
              );
            }

            const result = statusResponseSchema.safeParse(parsed);
            if (!result.success) {
              throw new ProtocolError(
                'Status API returned an invalid response body.',
                response.status,
              );
            }

            return {
              package: pkg,
              ...(normalizedFingerprint === undefined
                ? {}
                : { fingerprint: normalizedFingerprint }),
              state: mapApiState(result.data.state),
              rawState: result.data.state,
            };
          }

          const payload = errorPayload(body);
          const messageFor = (fallback: string): string =>
            safeMessage(payload.message, fallback, options.apiKey);

          if (response.status === 400) {
            throw new BadRequestError(messageFor('Status API rejected the request.'));
          }

          if (response.status === 401 || response.status === 403) {
            throw new AuthError(
              response.status,
              messageFor('Status API authentication failed.'),
            );
          }

          if (response.status === 429) {
            const retryAfterSeconds = parseRetryAfterSeconds(
              response.headers.get('Retry-After'),
            );

            if (
              retryAfterSeconds !== undefined &&
              retryAfterSeconds <= 30 &&
              quotaRetries < MAX_QUOTA_RETRIES &&
              attempt < maxAttempts
            ) {
              quotaRetries += 1;
              await sleep(retryAfterSeconds * 1_000);
              continue;
            }

            throw new QuotaExhaustedError(
              messageFor('Status API quota is exhausted or retrying is not permitted.'),
              retryAfterSeconds,
            );
          }

          if (response.status >= 500 && response.status <= 599) {
            if (attempt < maxAttempts) {
              await waitBeforeRetry(transientRetries, sleep, random);
              transientRetries += 1;
              continue;
            }

            throw new TransientError(
              messageFor('Status API failed after retries.'),
              response.status,
            );
          }

          throw new ProtocolError(
            'Status API returned unexpected HTTP ' + response.status + '.',
            response.status,
          );
        } catch (error) {
          if (
            error instanceof BadRequestError ||
            error instanceof AuthError ||
            error instanceof QuotaExhaustedError ||
            error instanceof ProtocolError ||
            error instanceof TransientError
          ) {
            throw error;
          }

          if (attempt < maxAttempts) {
            await waitBeforeRetry(transientRetries, sleep, random);
            transientRetries += 1;
            continue;
          }

          if (error instanceof RequestTimeoutError) {
            throw new TransientError('Status API request timed out after retries.');
          }

          throw new TransientError(
            'Status API request failed due to a network error after retries.',
          );
        }
      }

      throw new TransientError('Status API request failed after retries.');
    },
  };
}

export function getRetryDelayForTesting(
  retryIndex: number,
  random: Random = Math.random,
): number {
  return retryDelayMs(retryIndex, random);
}
