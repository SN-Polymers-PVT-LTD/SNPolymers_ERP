import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useRaFinalBillUrlState } from './useRaFinalBillUrlState';

function createWrapper(initialUrl = '/ra-final-bills') {
  return function Wrapper({ children }) {
    return (
      <MemoryRouter initialEntries={[initialUrl]}>
        {children}
      </MemoryRouter>
    );
  };
}

describe('useRaFinalBillUrlState hook', () => {
  it('parses default state from clean URL', () => {
    const { result } = renderHook(
      () => useRaFinalBillUrlState(),
      { wrapper: createWrapper('/ra-final-bills') }
    );

    expect(result.current.currentTab).toBe('dashboard');
    expect(result.current.activeWONo).toBe('');
    expect(result.current.filterWO).toBe('');
    expect(result.current.filterType).toBe('');
    expect(result.current.filterDateFrom).toBe('');
    expect(result.current.filterDateTo).toBe('');
    expect(result.current.page).toBe(1);
    expect(result.current.dirSearchWO).toBe('');
    expect(result.current.dirSearchDept).toBe('');
    expect(result.current.dirSearchZone).toBe('');
    expect(result.current.showCreatePanel).toBe(false);
    expect(result.current.createWONo).toBe('');
    expect(result.current.billId).toBe('');
  });

  it('parses deep-linked state from URL parameters', () => {
    const { result } = renderHook(
      () => useRaFinalBillUrlState(),
      {
        wrapper: createWrapper(
          '/ra-final-bills?tab=directory&wo=WO-101&search=WO-999&type=RA%20Bill&from=2024-01-01&to=2024-01-31&page=3&dir_wo=APD&dir_dept=Civil&dir_zone=Zone-A&modal=create&create_wo=WO-101'
        )
      }
    );

    expect(result.current.currentTab).toBe('directory');
    expect(result.current.activeWONo).toBe('WO-101');
    expect(result.current.filterWO).toBe('WO-999');
    expect(result.current.filterType).toBe('RA Bill');
    expect(result.current.filterDateFrom).toBe('2024-01-01');
    expect(result.current.filterDateTo).toBe('2024-01-31');
    expect(result.current.page).toBe(3);
    expect(result.current.dirSearchWO).toBe('APD');
    expect(result.current.dirSearchDept).toBe('Civil');
    expect(result.current.dirSearchZone).toBe('Zone-A');
    expect(result.current.showCreatePanel).toBe(true);
    expect(result.current.createWONo).toBe('WO-101');
  });

  it('switches tabs between dashboard and directory', () => {
    const { result } = renderHook(
      () => useRaFinalBillUrlState(),
      { wrapper: createWrapper('/ra-final-bills') }
    );
    expect(result.current.currentTab).toBe('dashboard');

    act(() => {
      result.current.setCurrentTab('directory');
    });
    expect(result.current.currentTab).toBe('directory');

    act(() => {
      result.current.setCurrentTab('dashboard');
    });
    expect(result.current.currentTab).toBe('dashboard');
  });

  it('selects and clears active work order', () => {
    const { result } = renderHook(
      () => useRaFinalBillUrlState(),
      { wrapper: createWrapper('/ra-final-bills') }
    );
    expect(result.current.activeWONo).toBe('');

    act(() => {
      result.current.selectWO('WO-808');
    });
    expect(result.current.activeWONo).toBe('WO-808');

    act(() => {
      result.current.clearWO();
    });
    expect(result.current.activeWONo).toBe('');
  });

  it('updates type, page, and resets dashboard filters', () => {
    const { result } = renderHook(
      () => useRaFinalBillUrlState(),
      { wrapper: createWrapper('/ra-final-bills') }
    );

    act(() => {
      result.current.setFilterType('Final Bill');
    });
    expect(result.current.filterType).toBe('Final Bill');

    act(() => {
      result.current.setPage(2);
    });
    expect(result.current.page).toBe(2);

    act(() => {
      result.current.resetDashboardFilters();
    });

    expect(result.current.filterType).toBe('');
    expect(result.current.filterDateFrom).toBe('');
    expect(result.current.filterDateTo).toBe('');
    expect(result.current.page).toBe(1);
  });

  it('controls create modal and bill detail modal with work order / ID propagation', () => {
    const { result } = renderHook(
      () => useRaFinalBillUrlState(),
      { wrapper: createWrapper('/ra-final-bills') }
    );

    expect(result.current.showCreatePanel).toBe(false);
    expect(result.current.billId).toBe('');

    // Open create modal with work order prefill
    act(() => {
      result.current.openCreatePanel('WO-PREFILL-1');
    });
    expect(result.current.showCreatePanel).toBe(true);
    expect(result.current.createWONo).toBe('WO-PREFILL-1');

    act(() => {
      result.current.closeCreatePanel();
    });
    expect(result.current.showCreatePanel).toBe(false);

    // Open bill detail modal
    act(() => {
      result.current.openBillDetail(777);
    });
    expect(result.current.billId).toBe('777');

    act(() => {
      result.current.closeBillDetail();
    });
    expect(result.current.billId).toBe('');
  });
});
