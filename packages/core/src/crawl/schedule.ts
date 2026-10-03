import type { AppStatus } from '../status/types.js';
import type { AppRecord } from '../data/schemas.js';

export const DEFAULT_RECHECK_AFTER_HOURS: Readonly<Record<AppStatus, number>> = {
  not_registered: 24,
  registered_other_key: 24,
  unknown: 12,
  registered: 168,
};

export const DEFAULT_PRIORITY_WEIGHTS: Readonly<Record<AppStatus, number>> = {
  not_registered: 2,
  registered_other_key: 1,
  unknown: 1,
  registered: 3,
};

export const DEFAULT_AVERAGE_CALLS_PER_PACKAGE = 1.3;

export interface ScheduleConfig {
  recheckAfterHours?: Partial<Record<AppStatus, number>>;
  priorityWeights?: Partial<Record<AppStatus, number>>;
  maxPackages?: number;
}

export interface SelectBatchOptions {
  records: readonly AppRecord[];
  now: string;
  budget: number;
  config?: ScheduleConfig;
}

interface Candidate {
  record: AppRecord;
  priority: number;
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(name + ' must be a positive finite number.');
  }
}

function mergedConfig(config: ScheduleConfig | undefined): {
  recheckAfterHours: Record<AppStatus, number>;
  priorityWeights: Record<AppStatus, number>;
} {
  const recheckAfterHours = {
    ...DEFAULT_RECHECK_AFTER_HOURS,
    ...(config?.recheckAfterHours ?? {}),
  };
  const priorityWeights = {
    ...DEFAULT_PRIORITY_WEIGHTS,
    ...(config?.priorityWeights ?? {}),
  };

  for (const status of Object.keys(DEFAULT_RECHECK_AFTER_HOURS) as AppStatus[]) {
    assertPositiveFinite(
      recheckAfterHours[status],
      'recheckAfterHours.' + status,
    );
    assertPositiveFinite(
      priorityWeights[status],
      'priorityWeights.' + status,
    );
  }

  return { recheckAfterHours, priorityWeights };
}

function resolveMaxPackages(
  budget: number,
  config: ScheduleConfig | undefined,
): number {
  if (config?.maxPackages !== undefined) {
    if (!Number.isSafeInteger(config.maxPackages) || config.maxPackages < 0) {
      throw new RangeError('maxPackages must be a non-negative safe integer.');
    }
    return Math.min(config.maxPackages, budget);
  }

  return Math.min(
    Math.floor(budget / DEFAULT_AVERAGE_CALLS_PER_PACKAGE),
    budget,
  );
}

function timestamp(value: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) {
    throw new RangeError('Schedule timestamps must be valid ISO timestamps.');
  }
  return result;
}

function compareCandidates(left: Candidate, right: Candidate): number {
  if (right.priority !== left.priority) {
    return right.priority - left.priority;
  }
  return left.record.package.localeCompare(right.record.package);
}

/**
 * Selects a deterministic package batch within the request budget.
 */
export function selectBatch(options: SelectBatchOptions): string[] {
  if (!Number.isSafeInteger(options.budget) || options.budget < 0) {
    throw new RangeError('budget must be a non-negative safe integer.');
  }

  const nowMs = timestamp(options.now);
  const config = mergedConfig(options.config);
  const maxPackages = resolveMaxPackages(options.budget, options.config);
  if (maxPackages === 0) {
    return [];
  }

  const neverChecked = options.records
    .filter(
      (record) =>
        record.removedAt === undefined &&
        record.checkedAt === undefined &&
        record.errorCount === 0,
    )
    .sort((a, b) => {
      const firstSeen = timestamp(a.firstSeenAt) - timestamp(b.firstSeenAt);
      return firstSeen !== 0 ? firstSeen : a.package.localeCompare(b.package);
    });

  const selected = neverChecked.slice(0, maxPackages);
  if (selected.length >= maxPackages) {
    return selected.map((record) => record.package);
  }

  const candidates: Candidate[] = [];
  for (const record of options.records) {
    if (record.removedAt !== undefined) {
      continue;
    }
    if (record.checkedAt === undefined && record.errorCount === 0) {
      continue;
    }

    const checkedAtMs =
      record.checkedAt === undefined ? undefined : timestamp(record.checkedAt);
    const errorAtMs =
      record.lastError === undefined ? undefined : timestamp(record.lastError.at);
    const lastAttemptMs =
      checkedAtMs === undefined
        ? errorAtMs
        : errorAtMs === undefined
          ? checkedAtMs
          : Math.max(checkedAtMs, errorAtMs);

    if (lastAttemptMs === undefined) {
      continue;
    }

    const ageHours = Math.max(0, nowMs - lastAttemptMs) / 3_600_000;
    if (record.errorCount > 0) {
      const backoffHours = Math.min(24, 2 ** Math.min(record.errorCount, 5));
      if (nowMs - lastAttemptMs < backoffHours * 3_600_000) {
        continue;
      }
    }

    const interval = config.recheckAfterHours[record.status];
    const priority =
      (ageHours / interval) * config.priorityWeights[record.status];
    candidates.push({ record, priority });
  }

  candidates.sort(compareCandidates);
  for (const candidate of candidates.slice(0, maxPackages - selected.length)) {
    selected.push(candidate.record);
  }

  return selected.map((record) => record.package);
}
