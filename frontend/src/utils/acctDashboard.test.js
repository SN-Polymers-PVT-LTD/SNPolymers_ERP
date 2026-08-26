import { describe, it, expect } from 'vitest';
import { countSheetsByStatus, sumBankBalances } from './acctDashboard';

describe('acctDashboard utils', () => {
  const sheets = [
    { sheet_status: 'Open' },
    { sheet_status: 'Submitted' },
    { sheet_status: 'Submitted' }
  ];

  it('countSheetsByStatus counts matching sheets', () => {
    expect(countSheetsByStatus(sheets, 'Open')).toBe(1);
    expect(countSheetsByStatus(sheets, 'Submitted')).toBe(2);
    expect(countSheetsByStatus(sheets, 'Closed')).toBe(0);
  });

  it('sumBankBalances totals available_balance across banks', () => {
    const balances = [{ available_balance: 100000 }, { available_balance: 25000 }];
    expect(sumBankBalances(balances)).toBe(125000);
  });

  it('sumBankBalances treats missing values as zero', () => {
    expect(sumBankBalances([{ bank_name: 'HDFC' }])).toBe(0);
    expect(sumBankBalances([])).toBe(0);
  });
});
