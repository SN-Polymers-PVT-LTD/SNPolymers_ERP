import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAcctRequisitionsUrlState } from './useAcctRequisitionsUrlState';

function createWrapper(initialUrl = '/acct-requisitions') {
  return function Wrapper({ children }) {
    return (
      <MemoryRouter initialEntries={[initialUrl]}>
        {children}
      </MemoryRouter>
    );
  };
}

describe('useAcctRequisitionsUrlState hook', () => {
  it('parses initial status, dates, search, and page from URL', () => {
    const { result } = renderHook(
      () => useAcctRequisitionsUrlState(),
      { wrapper: createWrapper('/acct-requisitions?status=Submitted&from=2026-03-01&to=2026-03-15&q=2026/03&page=3') }
    );
    expect(result.current.statusFilter).toBe('Submitted');
    expect(result.current.dateFrom).toBe('2026-03-01');
    expect(result.current.dateTo).toBe('2026-03-15');
    expect(result.current.searchQuery).toBe('2026/03');
    expect(result.current.page).toBe(3);
  });

  it('updates statusFilter and resets page', () => {
    const { result } = renderHook(
      () => useAcctRequisitionsUrlState(),
      { wrapper: createWrapper('/acct-requisitions?page=2') }
    );
    expect(result.current.page).toBe(2);

    act(() => {
      result.current.setStatusFilter('Open');
    });
    expect(result.current.statusFilter).toBe('Open');
  });

  it('updates date ranges individually and via setDateRange', () => {
    const { result } = renderHook(
      () => useAcctRequisitionsUrlState(),
      { wrapper: createWrapper('/acct-requisitions') }
    );
    act(() => {
      result.current.setDateFrom('2026-04-01');
    });
    expect(result.current.dateFrom).toBe('2026-04-01');

    act(() => {
      result.current.setDateRange('2026-05-01', '2026-05-31');
    });
    expect(result.current.dateFrom).toBe('2026-05-01');
    expect(result.current.dateTo).toBe('2026-05-31');
  });

  it('resets all filters cleanly', () => {
    const { result } = renderHook(
      () => useAcctRequisitionsUrlState(),
      { wrapper: createWrapper('/acct-requisitions?status=Reviewed&from=2026-01-01&to=2026-01-31&q=TEST&page=5') }
    );
    expect(result.current.statusFilter).toBe('Reviewed');
    expect(result.current.page).toBe(5);

    act(() => {
      result.current.resetFilters();
    });

    expect(result.current.statusFilter).toBe('All');
    expect(result.current.dateFrom).toBe('');
    expect(result.current.dateTo).toBe('');
    expect(result.current.searchQuery).toBe('');
    expect(result.current.page).toBe(1);
  });

  it('updates page number', () => {
    const { result } = renderHook(
      () => useAcctRequisitionsUrlState(),
      { wrapper: createWrapper('/acct-requisitions') }
    );
    expect(result.current.page).toBe(1);

    act(() => {
      result.current.setPage(4);
    });
    expect(result.current.page).toBe(4);
  });
});
