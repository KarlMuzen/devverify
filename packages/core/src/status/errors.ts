import { DevVerifyError } from '../errors.js';

export class AuthError extends DevVerifyError {
  public readonly status: 401 | 403;

  public constructor(status: 401 | 403, message: string) {
    super('AUTH_ERROR', message);
    this.name = 'AuthError';
    this.status = status;
  }
}

export class BadRequestError extends DevVerifyError {
  public readonly status = 400;

  public constructor(message: string) {
    super('BAD_REQUEST', message);
    this.name = 'BadRequestError';
  }
}

export class QuotaExhaustedError extends DevVerifyError {
  public readonly status = 429;

  public constructor(message: string, public readonly retryAfterSeconds?: number) {
    super('QUOTA_EXHAUSTED', message);
    this.name = 'QuotaExhaustedError';
  }
}

export class TransientError extends DevVerifyError {
  public readonly status?: number;

  public constructor(message: string, status?: number) {
    super('TRANSIENT_ERROR', message);
    this.name = 'TransientError';
    this.status = status;
  }
}

export class ProtocolError extends DevVerifyError {
  public readonly status?: number;

  public constructor(message: string, status?: number) {
    super('PROTOCOL_ERROR', message);
    this.name = 'ProtocolError';
    this.status = status;
  }
}
