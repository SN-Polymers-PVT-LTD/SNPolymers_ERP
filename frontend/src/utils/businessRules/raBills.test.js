import { describe, it, expect } from 'vitest';
import {
  resolveBillingCap,
  wouldExceedBillingCap,
  computeBillingRemaining
} from './raBills';

describe('raBills business rules', () => {
  it('resolveBillingCap prefers Final Approved estimate over work order value', () => {
    expect(resolveBillingCap(300000, 500000)).toBe(300000);
    expect(resolveBillingCap(null, 500000)).toBe(500000);
  });

  it('wouldExceedBillingCap matches RPC tolerance', () => {
    expect(wouldExceedBillingCap(200000, 100000, 300000)).toBe(false);
    expect(wouldExceedBillingCap(200000, 100001, 300000)).toBe(true);
  });

  it('computeBillingRemaining never goes negative', () => {
    expect(computeBillingRemaining(300000, 250000)).toBe(50000);
    expect(computeBillingRemaining(300000, 350000)).toBe(0);
  });
});
