/**
 * Base error type for stable, machine-readable devverify failures.
 */
export class DevVerifyError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = 'DevVerifyError';
    this.code = code;
  }
}
