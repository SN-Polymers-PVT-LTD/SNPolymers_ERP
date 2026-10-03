import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useSubcontractorLedgerUrlState } from './useSubcontractorLedgerUrlState';

function createWrapper(initialUrl = '/subcontractor-ledger') {
  return function Wrapper({ children }) {
    return (
      <MemoryRouter initialEntries={[initialUrl]}>
        {children}
      </MemoryRouter>
    );
  };
}

describe('useSubcontractorLedgerUrlState hook', () => {
  it('parses tab, work order, and date filters from initial URL', () => {
    const { result } = renderHook(
      () => useSubcontractorLedgerUrlState(),
      { wrapper: createWrapper('/subcontractor-ledger?tab=requisitions&wo=WB_APD_101&basis=paid&from=2026-01-01&to=2026-03-31') }
    );
    expect(result.current.viewMode).toBe('requisitions');
    expect(result.current.workOrderFilter).toBe('WB_APD_101');
    expect(result.current.dateBasis).toBe('paid');
    expect(result.current.dateFrom).toBe('2026-01-01');
    expect(result.current.dateTo).toBe('2026-03-31');
  });

  it('switches viewMode tabs', () => {
    const { result } = renderHook(
      () => useSubcontractorLedgerUrlState(),
      { wrapper: createWrapper('/subcontractor-ledger') }
    );
    expect(result.current.viewMode).toBe('contractors');

    act(() => {
      result.current.setViewMode('requisitions');
    });
    expect(result.current.viewMode).toBe('requisitions');
  });

  it('handles statement modal state from URL parameters', () => {
    const { result } = renderHook(
      () => useSubcontractorLedgerUrlState(),
      { wrapper: createWrapper('/subcontractor-ledger?modal=entries&subcontractor_id=sub-123&modal_wo=WB_APD_101&subcontractor_name=Sharma+Constructions') }
    );
    expect(result.current.viewingEntry).toEqual({
      subcontractor_id: 'sub-123',
      subcontractor_name: 'Sharma Constructions',
      work_order_no: 'WB_APD_101',
      subcontract_work_id: '',
      material_sub_head: '',
      material_details: ''
    });

    act(() => {
      result.current.closeModal();
    });
    expect(result.current.viewingEntry).toBeNull();
  });

  it('handles balance adjustment modal state from URL parameters', () => {
    const { result } = renderHook(
      () => useSubcontractorLedgerUrlState(),
      { wrapper: createWrapper('/subcontractor-ledger?modal=adjust&subcontractor_id=sub-456&modal_wo=WB_APD_102') }
    );
    expect(result.current.adjustingEntry).toEqual({
      subcontractor_id: 'sub-456',
      subcontractor_name: '',
      work_order_no: 'WB_APD_102',
      subcontract_work_id: '',
      material_sub_head: '',
      material_details: ''
    });

    act(() => {
      result.current.setAdjustingEntry(null);
    });
    expect(result.current.adjustingEntry).toBeNull();
  });

  it('resets all filters cleanly', () => {
    const { result } = renderHook(
      () => useSubcontractorLedgerUrlState(),
      { wrapper: createWrapper('/subcontractor-ledger?wo=WB_APD_101&q=pipe&from=2026-01-01') }
    );
    expect(result.current.workOrderFilter).toBe('WB_APD_101');

    act(() => {
      result.current.resetFilters();
    });
    expect(result.current.workOrderFilter).toBe('');
    expect(result.current.searchInput).toBe('');
    expect(result.current.dateFrom).toBe('');
  });
});
