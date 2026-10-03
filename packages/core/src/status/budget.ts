import { DevVerifyError } from '../errors.js';

export class BudgetExhaustedError extends DevVerifyError {
  public constructor(message = 'Status API request budget exhausted.') {
    super('BUDGET_EXHAUSTED', message);
    this.name = 'BudgetExhaustedError';
  }
}

export class RequestBudget {
  public readonly limit: number;
  private remainingRequests: number;

  public constructor(limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new DevVerifyError(
        'INVALID_REQUEST_BUDGET',
        'Request budget must be a non-negative safe integer.',
      );
    }

    this.limit = limit;
    this.remainingRequests = limit;
  }

  public take(): void {
    if (this.remainingRequests <= 0) {
      throw new BudgetExhaustedError();
    }

    this.remainingRequests -= 1;
  }

  public get remaining(): number {
    return this.remainingRequests;
  }
}
