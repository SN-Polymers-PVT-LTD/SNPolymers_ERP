import { describe, expect, it } from 'vitest';
import { formatPaymentOffice, getRequisitionFinancialState } from './requisitionUtils';

describe('formatPaymentOffice', () => {
  it('maps ZO balance payments to the ZO Office', () => {
    expect(formatPaymentOffice('ZO_BALANCE')).toBe('ZO Office');
  });

  it('maps Accounts payments to the HO Office', () => {
    expect(formatPaymentOffice('ACCOUNTS')).toBe('HO Office');
  });

  it('uses the supplied fallback for missing or unknown destinations', () => {
    expect(formatPaymentOffice(null)).toBe('—');
    expect(formatPaymentOffice('legacy-value', '')).toBe('');
  });
});

describe('getRequisitionFinancialState', () => {
  const base = { requisition_status: 'Approved', approved_amount: 1000 };
  it.each([
    [{ ...base, payment_status: 'AWAITING_PAYMENT_ROUTE' }, 'Awaiting Payment Route', 1000, 1000, 0],
    [{ ...base, payment_status: 'PENDING_ACCOUNTS_IMPORT' }, 'Pending Accounts Import', 1000, 1000, 0],
    [{ ...base, payment_status: 'REJECTED' }, 'Released', 0, 0, 0],
    [{ ...base, payment_status: 'PARTIALLY_PAID', paid_amount: 400 }, 'Partially Paid', 400, 0, 400],
    [{ ...base, payment_status: 'PAID', paid_amount: 1000 }, 'Paid', 1000, 0, 1000],
    [{ ...base, payment_destination: 'ZO_BALANCE', payment_status: 'PAID' }, 'Paid', 1000, 0, 1000]
  ])('projects %s correctly', (requisition, status, liability, reserved, paid) => {
    expect(getRequisitionFinancialState(requisition)).toMatchObject({
      status, effectiveLiability: liability, reservedAmount: reserved, paidAmount: paid
    });
  });
  it('cancelled rows have no exposure', () => {
    expect(getRequisitionFinancialState({ ...base, requisition_status: 'Cancelled' }).financiallyActive).toBe(false);
  });
});
