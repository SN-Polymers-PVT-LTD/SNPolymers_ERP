import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import BankBalanceBanner from './BankBalanceBanner';

const bank = { bank_name: 'CANARA Test CA', available_balance: 100000 };

// stagedDebit is a client-side-only preview (HO review page): the sum of
// currently-staged Approve/Partially-Approve amounts for this bank, before
// "Submit Decisions" is even clicked. It must never affect the real balance
// display, only the projected figure, and only when actually staged.
describe('BankBalanceBanner — stagedDebit is a client-side-only projection', () => {
  it('projected equals available_balance when nothing is staged', () => {
    render(<BankBalanceBanner bankBalance={bank} />);
    expect(screen.getAllByText('₹ 1,00,000.00')).toHaveLength(2);
  });

  it('subtracts stagedDebit from the projected figure, not the real balance', () => {
    render(<BankBalanceBanner bankBalance={bank} stagedDebit={15000} />);
    // Real balance untouched:
    const amounts = screen.getAllByText(/₹/);
    expect(amounts.some(el => el.textContent === '₹ 1,00,000.00')).toBe(true);
    // Projected reflects the staged debit:
    expect(screen.getByText('₹ 85,000.00')).toBeInTheDocument();
  });

  it('shows the "staged this session" hint only when stagedDebit > 0', () => {
    const { rerender } = render(<BankBalanceBanner bankBalance={bank} stagedDebit={0} />);
    expect(screen.queryByText(/staged this session/i)).not.toBeInTheDocument();

    rerender(<BankBalanceBanner bankBalance={bank} stagedDebit={5000} />);
    expect(screen.getByText(/staged this session/i)).toBeInTheDocument();
  });

  it('combines with the existing open-sheet projection (both deducted together)', () => {
    const lineItems = [
      { debit_bank_ac_type: 'CANARA Test CA', requisition_status: null, req_amount: 10000 }
    ];
    render(<BankBalanceBanner bankBalance={bank} lineItems={lineItems} stagedDebit={5000} />);
    expect(screen.getByText('₹ 85,000.00')).toBeInTheDocument();
  });
});
