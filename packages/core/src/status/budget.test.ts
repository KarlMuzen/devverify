import { describe, expect, it } from 'vitest';
import { BudgetExhaustedError, RequestBudget } from './budget.js';

describe('RequestBudget', () => {
  it('consumes the configured number of requests', () => {
    const budget = new RequestBudget(2);

    budget.take();
    expect(budget.remaining).toBe(1);
    budget.take();
    expect(budget.remaining).toBe(0);
    expect(() => budget.take()).toThrowError(BudgetExhaustedError);
  });

  it('rejects invalid limits', () => {
    expect(() => new RequestBudget(-1)).toThrow();
    expect(() => new RequestBudget(Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });
});
