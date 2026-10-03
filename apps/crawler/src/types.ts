import type {
  AppRecord,
  EventRecord,
  Meta,
  PackageSource,
  SourceSnapshot,
  StatusClient,
  TimeseriesRow,
} from '@devverify/core';

export interface CrawlOptions {
  dataDir: string;
  budget: number;
  concurrency: number;
  dryRun: boolean;
  fake: boolean;
  fixtureIndex?: string;
  maxFingerprints: number;
  apiKey?: string;
  now?: string;
  source?: PackageSource;
  statusClient?: StatusClient;
  writeSummary?: boolean;
  summaryPath?: string;
}

export interface CrawlCounts {
  registered: number;
  registered_other_key: number;
  not_registered: number;
  unknown: number;
  added: number;
  removed: number;
  fingerprintChanged: number;
  errors: number;
}

export type CrawlExitReason =
  | 'completed'
  | 'dry_run'
  | 'budget_exhausted'
  | 'quota_exhausted'
  | 'auth_error'
  | 'source_fetch_failed'
  | 'schema_error'
  | 'configuration_error'
  | 'save_failed';

export interface CrawlResult {
  exitCode: number;
  exitReason: CrawlExitReason;
  requestsUsed: number;
  budget: number;
  counts: CrawlCounts;
  warnings: string[];
}

export interface PackageOutcome {
  package: string;
  record?: AppRecord;
  event?: EventRecord;
  error?: unknown;
}

export interface LoadedSource {
  source: PackageSource;
  snapshot: SourceSnapshot;
}



export interface MutableCrawlData {
  apps: AppRecord[];
  events: EventRecord[];
  timeseries: TimeseriesRow[];
  meta: Meta;
}
