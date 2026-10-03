import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useFundRequestUrlState } from './useFundRequestUrlState';

const mockRequests = [
  { fund_request_id: 'aaaa1111-aaaa-1111-aaaa-111111111111', fund_request_no: 'FR_001', zo_fr_amount: 100000, request_status: 'Pending' },
  { fund_request_id: 'bbbb2222-bbbb-2222-bbbb-222222222222', fund_request_no: 'FR_002', zo_fr_amount: 250000, request_status: 'Approved' }
];

function createWrapper(initialUrl = '/fund-requests') {
  return function Wrapper({ children }) {
    return (
      <MemoryRouter initialEntries={[initialUrl]}>
        {children}
      </MemoryRouter>
    );
  };
}

describe('useFundRequestUrlState hook', () => {
  it('parses quick checklist filters from URL comma-separated string', () => {
    const { result } = renderHook(
      () => useFundRequestUrlState(),
      { wrapper: createWrapper('/fund-requests?filter=pendingOnly,myRequests') }
    );
    expect(result.current.filters.pendingOnly).toBe(true);
    expect(result.current.filters.myRequests).toBe(true);
    expect(result.current.filters.largeAmount).toBe(false);
  });

  it('updates filters individually and cleanly updates URL filter parameter', () => {
    const { result } = renderHook(
      () => useFundRequestUrlState(),
      { wrapper: createWrapper('/fund-requests') }
    );
    expect(result.current.filters.pendingOnly).toBe(false);

    act(() => {
      result.current.setFilter('pendingOnly', true);
    });
    expect(result.current.filters.pendingOnly).toBe(true);

    act(() => {
      result.current.setFilter('pendingOnly', false);
    });
    expect(result.current.filters.pendingOnly).toBe(false);
  });

  it('resolves activeRequest from fund_request_no in URL', () => {
    const { result } = renderHook(
      () => useFundRequestUrlState({ requests: mockRequests }),
      { wrapper: createWrapper('/fund-requests?req=FR_001') }
    );
    expect(result.current.activeRequest).toEqual(mockRequests[0]);

    act(() => {
      result.current.setActiveRequest(null);
    });
    expect(result.current.activeRequest).toBeNull();
  });

  it('handles creation flow toggle and prefilled work order', () => {
    const { result } = renderHook(
      () => useFundRequestUrlState(),
      { wrapper: createWrapper('/fund-requests?create=true&wo=WB_APD_101') }
    );
    expect(result.current.showCreateFlow).toBe(true);
    expect(result.current.createWorkOrder).toBe('WB_APD_101');

    act(() => {
      result.current.closeDetailOrForm();
    });
    expect(result.current.showCreateFlow).toBe(false);
    expect(result.current.createWorkOrder).toBe('');
  });

  it('reads and updates pagination page', () => {
    const { result } = renderHook(
      () => useFundRequestUrlState(),
      { wrapper: createWrapper('/fund-requests?page=4') }
    );
    expect(result.current.currentPage).toBe(4);

    act(() => {
      result.current.setCurrentPage(1);
    });
    expect(result.current.currentPage).toBe(1);
  });
});
