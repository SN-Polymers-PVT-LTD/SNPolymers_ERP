import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useEstimatedBillLedgerUrlState } from './useEstimatedBillLedgerUrlState';

function createWrapper(initialUrl = '/estimated-bills/ledger/WO-101') {
  return function Wrapper({ children }) {
    return (
      <MemoryRouter initialEntries={[initialUrl]}>
        {children}
      </MemoryRouter>
    );
  };
}

describe('useEstimatedBillLedgerUrlState hook', () => {
  it('parses initial dates, sorting, and modal state from URL', () => {
    const { result } = renderHook(
      () => useEstimatedBillLedgerUrlState(),
      {
        wrapper: createWrapper(
          '/estimated-bills/ledger/WO-101?from=2026-04-01&to=2026-04-30&sort=estimated_bill_amount&dir=desc&modal=new'
        )
      }
    );

    expect(result.current.paymentDateFrom).toBe('2026-04-01');
    expect(result.current.paymentDateTo).toBe('2026-04-30');
    expect(result.current.sortConfig.key).toBe('estimated_bill_amount');
    expect(result.current.sortConfig.direction).toBe('desc');
    expect(result.current.isModalOpen).toBe(true);
  });

  it('handles column sorting toggle', () => {
    const { result } = renderHook(
      () => useEstimatedBillLedgerUrlState(),
      { wrapper: createWrapper('/estimated-bills/ledger/WO-101') }
    );

    act(() => {
      result.current.handleSort('estimated_payment_date');
    });
    expect(result.current.sortConfig.key).toBe('estimated_payment_date');
    expect(result.current.sortConfig.direction).toBe('asc');

    act(() => {
      result.current.handleSort('estimated_payment_date');
    });
    expect(result.current.sortConfig.direction).toBe('desc');
  });

  it('opens and closes entry modal', () => {
    const { result } = renderHook(
      () => useEstimatedBillLedgerUrlState(),
      { wrapper: createWrapper('/estimated-bills/ledger/WO-101') }
    );
    expect(result.current.isModalOpen).toBe(false);

    act(() => {
      result.current.openModal();
    });
    expect(result.current.isModalOpen).toBe(true);

    act(() => {
      result.current.closeModal();
    });
    expect(result.current.isModalOpen).toBe(false);
  });
});
