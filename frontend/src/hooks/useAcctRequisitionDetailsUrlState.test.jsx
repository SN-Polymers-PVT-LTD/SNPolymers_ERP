import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAcctRequisitionDetailsUrlState } from './useAcctRequisitionDetailsUrlState';

function createWrapper(initialUrl = '/acct-requisitions/details') {
  return function Wrapper({ children }) {
    return (
      <MemoryRouter initialEntries={[initialUrl]}>
        {children}
      </MemoryRouter>
    );
  };
}

describe('useAcctRequisitionDetailsUrlState hook', () => {
  it('parses initial filters and page from URL', () => {
    const { result } = renderHook(
      () => useAcctRequisitionDetailsUrlState(),
      {
        wrapper: createWrapper(
          '/acct-requisitions/details?sub_title=Diesel&wo=WO-101&status=Approved&from=2026-03-01&to=2026-03-10&page=2'
        )
      }
    );
    expect(result.current.accountSubTitle).toBe('Diesel');
    expect(result.current.workOrderNo).toBe('WO-101');
    expect(result.current.requisitionStatus).toBe('Approved');
    expect(result.current.dateFrom).toBe('2026-03-01');
    expect(result.current.dateTo).toBe('2026-03-10');
    expect(result.current.page).toBe(2);
    expect(result.current.hasFilters).toBe(true);

    const params = result.current.buildParams();
    expect(params.account_sub_title).toBe('Diesel');
    expect(params.work_order_no).toBe('WO-101');
    expect(params.requisition_status).toBe('Approved');
  });

  it('updates select filters and resets page', () => {
    const { result } = renderHook(
      () => useAcctRequisitionDetailsUrlState(),
      { wrapper: createWrapper('/acct-requisitions/details?page=3') }
    );
    expect(result.current.page).toBe(3);

    act(() => {
      result.current.setAccountSubTitle('Electrical');
    });
    expect(result.current.accountSubTitle).toBe('Electrical');
    expect(result.current.page).toBe(1);
  });

  it('resets all filters cleanly', () => {
    const { result } = renderHook(
      () => useAcctRequisitionDetailsUrlState(),
      { wrapper: createWrapper('/acct-requisitions/details?sub_title=Cement&status=Rejected&page=4') }
    );
    expect(result.current.hasFilters).toBe(true);

    act(() => {
      result.current.resetFilters();
    });

    expect(result.current.hasFilters).toBe(false);
    expect(result.current.accountSubTitle).toBe('');
    expect(result.current.requisitionStatus).toBe('');
    expect(result.current.page).toBe(1);
  });

  it('updates page number', () => {
    const { result } = renderHook(
      () => useAcctRequisitionDetailsUrlState(),
      { wrapper: createWrapper('/acct-requisitions/details') }
    );
    expect(result.current.page).toBe(1);

    act(() => {
      result.current.setPage(5);
    });
    expect(result.current.page).toBe(5);
  });
});
