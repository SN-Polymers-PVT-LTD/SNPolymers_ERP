import { describe, expect, it } from 'vitest';
import { formatPaymentOffice } from './requisitionUtils';

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
