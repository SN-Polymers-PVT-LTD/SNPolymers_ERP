import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useEstimatedBillsUrlState } from './useEstimatedBillsUrlState';

function createWrapper(initialUrl = '/estimated-bills') {
  return function Wrapper({ children }) {
    return (
      <MemoryRouter initialEntries={[initialUrl]}>
        {children}
      </MemoryRouter>
    );
  };
}

describe('useEstimatedBillsUrlState hook', () => {
  it('parses initial filters and modal state from URL', () => {
    const { result } = renderHook(
      () => useEstimatedBillsUrlState(),
      {
        wrapper: createWrapper(
          '/estimated-bills?zone=North+Bengal&wo=WO-101&status=Running&surety=75&from=2026-03-01&to=2026-03-31&modal=new&modal_wo=WO-101'
        )
      }
    );

    expect(result.current.filters.zone).toBe('North Bengal');
    expect(result.current.filters.work_order_no).toBe('WO-101');
    expect(result.current.filters.status).toBe('Running');
    expect(result.current.filters.min_surety).toBe('75');
    expect(result.current.filters.payment_date_from).toBe('2026-03-01');
    expect(result.current.filters.payment_date_to).toBe('2026-03-31');
    expect(result.current.modalState.isOpen).toBe(true);
    expect(result.current.modalState.initialWorkOrderNo).toBe('WO-101');
  });

  it('updates filters cleanly', () => {
    const { result } = renderHook(
      () => useEstimatedBillsUrlState(),
      { wrapper: createWrapper('/estimated-bills') }
    );

    act(() => {
      result.current.setFilters(prev => ({
        ...prev,
        zone: 'South Bengal',
        status: 'Closed',
        min_surety: '50'
      }));
    });

    expect(result.current.filters.zone).toBe('South Bengal');
    expect(result.current.filters.status).toBe('Closed');
    expect(result.current.filters.min_surety).toBe('50');
  });

  it('opens and closes modal', () => {
    const { result } = renderHook(
      () => useEstimatedBillsUrlState(),
      { wrapper: createWrapper('/estimated-bills') }
    );
    expect(result.current.modalState.isOpen).toBe(false);

    act(() => {
      result.current.openNewModal('WO-202');
    });
    expect(result.current.modalState.isOpen).toBe(true);
    expect(result.current.modalState.initialWorkOrderNo).toBe('WO-202');

    act(() => {
      result.current.closeModal();
    });
    expect(result.current.modalState.isOpen).toBe(false);
    expect(result.current.modalState.initialWorkOrderNo).toBe(null);
  });
});
