import { DevVerifyError } from '../errors.js';

/** Authentication/permission failure returned by the Status API. */
export class AuthError extends DevVerifyError {
  public readonly status: 401 | 403;

  public constructor(status: 401 | 403, message: string) {
    super('AUTH_ERROR', message);
    this.name = 'AuthError';
    this.status = status;
  }
}

/** Invalid request rejected by the Status API. */
export class BadRequestError extends DevVerifyError {
  public readonly status = 400;

  public constructor(message: string) {
    super('BAD_REQUEST', message);
    this.name = 'BadRequestError';
  }
}

/** Quota/rate-limit response that cannot be retried safely. */
export class QuotaExhaustedError extends DevVerifyError {
  public readonly status = 429;

  public constructor(message: string, public readonly retryAfterSeconds?: number) {
    super('QUOTA_EXHAUSTED', message);
    this.name = 'QuotaExhaustedError';
  }
}

/** Retryable failure that remained after bounded retries. */
export class TransientError extends DevVerifyError {
  public readonly status?: number;

  public constructor(message: string, status?: number) {
    super('TRANSIENT_ERROR', message);
    this.name = 'TransientError';
    this.status = status;
  }
}

/** Malformed or otherwise incompatible Status API response. */
export class ProtocolError extends DevVerifyError {
  public readonly status?: number;

  public constructor(message: string, status?: number) {
    super('PROTOCOL_ERROR', message);
    this.name = 'ProtocolError';
    this.status = status;
  }
}
