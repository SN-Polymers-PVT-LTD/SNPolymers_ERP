import { describe, it, expect } from 'vitest';
import { canManageEstimatedBills } from './estimatedBillPermissions';

describe('canManageEstimatedBills permissions helper tests', () => {
  it('returns true for zo, ho, and admin when work order is Running and no Final Bill exists', () => {
    expect(canManageEstimatedBills({ role: 'zo', status: 'Running', finalBillExists: false })).toBe(true);
    expect(canManageEstimatedBills({ role: 'ho', status: 'Running', finalBillExists: false })).toBe(true);
    expect(canManageEstimatedBills({ role: 'admin', status: 'Running', finalBillExists: false })).toBe(true);
  });

  it('returns false for other roles', () => {
    expect(canManageEstimatedBills({ role: 'je', status: 'Running', finalBillExists: false })).toBe(false);
    expect(canManageEstimatedBills({ role: 'staff', status: 'Running', finalBillExists: false })).toBe(false);
  });

  it('returns false if status is not Running', () => {
    expect(canManageEstimatedBills({ role: 'zo', status: 'Closed', finalBillExists: false })).toBe(false);
    expect(canManageEstimatedBills({ role: 'zo', status: 'Complete Under Maintenance', finalBillExists: false })).toBe(false);
  });

  it('returns false if final bill exists', () => {
    expect(canManageEstimatedBills({ role: 'zo', status: 'Running', finalBillExists: true })).toBe(false);
  });

  it('fails closed (returns false) if arguments are missing or undefined', () => {
    expect(canManageEstimatedBills()).toBe(false);
    expect(canManageEstimatedBills({ role: 'zo' })).toBe(false);
    expect(canManageEstimatedBills({ role: 'zo', status: 'Running' })).toBe(false);
    expect(canManageEstimatedBills({ status: 'Running', finalBillExists: false })).toBe(false);
  });
});
