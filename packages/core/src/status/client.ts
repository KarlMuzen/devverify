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
  type Random,
  type Sleep,
  waitBeforeRetry,
} from './retry.js';
import { parseErrorMessage, parseSuccess } from './protocol.js';
import { buildStatusUrl, fetchWithTimeout, RequestTimeoutError } from './transport.js';

/** Android Developer ID Status API base URL. */\nexport const STATUS_API_BASE_URL = 'https://androiddeveloperidstatus.googleapis.com';

/** Normalized result returned by a status check. */\nexport interface StatusCheckResult {
  package: string;
  fingerprint?: string;
  state: ReturnType<typeof parseSuccess>['state'];
  rawState: string;
}

/** Safe request telemetry emitted before each HTTP attempt. */\nexport interface StatusRequestInfo {
  package: string;
  fingerprint?: string;
  url: string;
  attempt: number;
}

/** Configuration for the injected, isomorphic Status API client. */\nexport interface StatusClientOptions {
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

/** Minimal Status API client contract used by callers and fakes. */\nexport interface StatusClient {
  check(packageName: string, fingerprint?: string): Promise<StatusCheckResult>;
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
    throw new DevVerifyError(
      'INVALID_PACKAGE_ENCODING',
      'Unsupported package-name encoding.',
    );
  }
}

async function readBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    throw new ProtocolError(
      'Status API response body could not be read.',
      response.status,
    );
  }
}

function isRetryableStatus(status: number): boolean {
  return status >= 500 && status <= 599;
}

/** Creates a Status API client with bounded retries and an optional request budget. */\nexport function createStatusClient(options: StatusClientOptions): StatusClient {
  validateOptions(options);

  const fetcher = options.fetch ?? globalThis.fetch;
  if (fetcher === undefined) {
    throw new DevVerifyError(
      'FETCH_UNAVAILABLE',
      'Fetch is not available in this runtime.',
    );
  }

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
      const url = buildStatusUrl(
        options.baseUrl ?? STATUS_API_BASE_URL,
        pkg,
        normalizedFingerprint,
        encoding,
      );
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
          const body = await readBody(response);

          if (response.status === 200) {
            const parsed = parseSuccess(body, response.status);
            return {
              package: pkg,
              ...(normalizedFingerprint === undefined
                ? {}
                : { fingerprint: normalizedFingerprint }),
              state: parsed.state,
              rawState: parsed.rawState,
            };
          }

          const message = (fallback: string): string =>
            parseErrorMessage(body, options.apiKey, fallback);

          if (response.status === 400) {
            throw new BadRequestError(
              message('Status API rejected the request.'),
            );
          }
          if (response.status === 401 || response.status === 403) {
            throw new AuthError(
              response.status,
              message('Status API authentication failed.'),
            );
          }
          if (response.status === 429) {
            const retryAfter = parseRetryAfterSeconds(
              response.headers.get('Retry-After'),
            );

            if (
              retryAfter !== undefined &&
              retryAfter <= 30 &&
              quotaRetries < MAX_QUOTA_RETRIES &&
              attempt < maxAttempts
            ) {
              quotaRetries += 1;
              await sleep(retryAfter * 1_000);
              continue;
            }

            throw new QuotaExhaustedError(
              message(
                'Status API quota is exhausted or retrying is not permitted.',
              ),
              retryAfter,
            );
          }

          if (isRetryableStatus(response.status)) {
            if (attempt < maxAttempts) {
              await waitBeforeRetry(transientRetries, sleep, random);
              transientRetries += 1;
              continue;
            }

            throw new TransientError(
              message('Status API failed after retries.'),
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
            throw new TransientError(
              'Status API request timed out after retries.',
            );
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
