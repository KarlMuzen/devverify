export type Sleep = (ms: number) => Promise<void>;
export type Random = () => number;

const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 8_000;
const MAX_429_RETRIES = 2;

export const MAX_QUOTA_RETRIES = MAX_429_RETRIES;

export function retryDelayMs(retryIndex: number, random: Random): number {
  const cap = Math.min(
    BACKOFF_CAP_MS,
    BACKOFF_BASE_MS * 2 ** Math.max(0, Math.floor(retryIndex)),
  );
  const sample = Math.min(1, Math.max(0, random()));
  return cap * sample;
}

export function parseRetryAfterSeconds(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!/^(?:0|[1-9]\d*)$/.test(trimmed)) {
    return undefined;
  }

  const seconds = Number(trimmed);
  return Number.isSafeInteger(seconds) ? seconds : undefined;
}

export async function waitBeforeRetry(
  retryIndex: number,
  sleep: Sleep,
  random: Random,
): Promise<void> {
  await sleep(retryDelayMs(retryIndex, random));
}

export async function defaultSleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}
