import { describe, expect, it } from 'vitest';
import {
  AuthError,
  BadRequestError,
  ProtocolError,
  QuotaExhaustedError,
  TransientError,
} from './errors.js';

describe('status API errors', () => {
  it('exposes stable codes and HTTP status', () => {
    expect(new AuthError(401, 'auth')).toMatchObject({
      code: 'AUTH_ERROR',
      status: 401,
    });
    expect(new AuthError(403, 'auth')).toMatchObject({
      code: 'AUTH_ERROR',
      status: 403,
    });
    expect(new BadRequestError('bad')).toMatchObject({
      code: 'BAD_REQUEST',
      status: 400,
    });
    expect(new QuotaExhaustedError('quota', 5)).toMatchObject({
      code: 'QUOTA_EXHAUSTED',
      status: 429,
      retryAfterSeconds: 5,
    });
    expect(new TransientError('transient', 503)).toMatchObject({
      code: 'TRANSIENT_ERROR',
      status: 503,
    });
    expect(new TransientError('transient')).toMatchObject({
      code: 'TRANSIENT_ERROR',
    });
    expect(new ProtocolError('protocol', 500)).toMatchObject({
      code: 'PROTOCOL_ERROR',
      status: 500,
    });
    expect(new ProtocolError('protocol')).toMatchObject({
      code: 'PROTOCOL_ERROR',
    });
  });
});
