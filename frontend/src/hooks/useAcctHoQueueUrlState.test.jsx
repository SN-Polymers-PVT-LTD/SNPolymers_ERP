import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAcctHoQueueUrlState } from './useAcctHoQueueUrlState';

function createWrapper(initialUrl = '/acct-requisitions/ho-queue') {
  return function Wrapper({ children }) {
    return (
      <MemoryRouter initialEntries={[initialUrl]}>
        {children}
      </MemoryRouter>
    );
  };
}

describe('useAcctHoQueueUrlState hook', () => {
  it('parses initial status, dates, search, and page from URL', () => {
    const { result } = renderHook(
      () => useAcctHoQueueUrlState(),
      { wrapper: createWrapper('/acct-requisitions/ho-queue?status=Reviewed&from=2026-02-01&to=2026-02-28&q=HO/REQ&page=2') }
    );
    expect(result.current.statusFilter).toBe('Reviewed');
    expect(result.current.dateFrom).toBe('2026-02-01');
    expect(result.current.dateTo).toBe('2026-02-28');
    expect(result.current.searchQuery).toBe('HO/REQ');
    expect(result.current.page).toBe(2);
  });

  it('switches statusFilter tab between Submitted and Reviewed', () => {
    const { result } = renderHook(
      () => useAcctHoQueueUrlState(),
      { wrapper: createWrapper('/acct-requisitions/ho-queue') }
    );
    expect(result.current.statusFilter).toBe('Submitted');

    act(() => {
      result.current.setStatusFilter('Reviewed');
    });
    expect(result.current.statusFilter).toBe('Reviewed');

    act(() => {
      result.current.setStatusFilter('Submitted');
    });
    expect(result.current.statusFilter).toBe('Submitted');
  });

  it('resets filters while preserving active status tab', () => {
    const { result } = renderHook(
      () => useAcctHoQueueUrlState(),
      { wrapper: createWrapper('/acct-requisitions/ho-queue?status=Reviewed&q=123&from=2026-01-01&to=2026-01-10&page=4') }
    );
    expect(result.current.statusFilter).toBe('Reviewed');
    expect(result.current.page).toBe(4);

    act(() => {
      result.current.resetFilters();
    });
    expect(result.current.statusFilter).toBe('Reviewed');
    expect(result.current.searchQuery).toBe('');
    expect(result.current.dateFrom).toBe('');
    expect(result.current.dateTo).toBe('');
    expect(result.current.page).toBe(1);
  });

  it('updates page number', () => {
    const { result } = renderHook(
      () => useAcctHoQueueUrlState(),
      { wrapper: createWrapper('/acct-requisitions/ho-queue') }
    );
    expect(result.current.page).toBe(1);

    act(() => {
      result.current.setPage(3);
    });
    expect(result.current.page).toBe(3);
  });
});
