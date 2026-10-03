import { DevVerifyError } from './errors.js';

export interface SourceValidators {
  etag?: string;
  lastModified?: string;
}

export interface SourceLoadOptions {
  fetch?: typeof fetch;
  validators?: SourceValidators;
}

export interface SourceSnapshot {
  entries: Array<{
    package: string;
    fingerprints: string[];
  }>;
  validators?: SourceValidators;
  notModified?: boolean;
  fetchedAt: string;
  warnings: string[];
}

export interface PackageSource {
  id: string;
  load(opts: SourceLoadOptions): Promise<SourceSnapshot>;
}

/** Raised when an external package-source payload is structurally unusable. */
export class SourceFormatError extends DevVerifyError {
  public constructor(message: string) {
    super('SOURCE_FORMAT_ERROR', message);
    this.name = 'SourceFormatError';
  }
}

/** Raised when fetching a package source fails before a usable snapshot exists. */
export class SourceFetchError extends DevVerifyError {
  public readonly status?: number;

  public constructor(message: string, status?: number) {
    super('SOURCE_FETCH_ERROR', message);
    this.name = 'SourceFetchError';
    this.status = status;
  }
}
