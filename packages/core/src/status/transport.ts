import { DevVerifyError } from '../errors.js';

export class RequestTimeoutError extends Error {
  public constructor() {
    super('Status API request timed out.');
    this.name = 'RequestTimeoutError';
  }
}

export function buildStatusUrl(
  baseUrl: string,
  packageName: string,
  fingerprint: string | undefined,
  encoding: 'dots' | 'hyphens',
): string {
  const encodedPackage =
    encoding === 'hyphens' ? packageName.replaceAll('.', '-') : packageName;
  let url: URL;

  try {
    const base = baseUrl.replace(/\/+$/, '');
    url = new URL(
      'v1/packages/' +
        encodeURIComponent(encodedPackage) +
        '/packageRegistrationStatus:check',
      base + '/',
    );
  } catch {
    throw new DevVerifyError(
      'INVALID_BASE_URL',
      'Status API base URL is invalid.',
    );
  }

  if (fingerprint !== undefined) {
    url.searchParams.set('certificateFingerprint', fingerprint);
  }

  return url.toString();
}

export async function fetchWithTimeout(
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
