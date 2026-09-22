import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useRequisitionUrlState } from './useRequisitionUrlState';

const mockRequisitions = [
  { requisition_id: '11111111-1111-1111-1111-111111111111', requisition_no: 'REQ_001', requisition_status: 'Pending' },
  { requisition_id: '22222222-2222-2222-2222-222222222222', requisition_no: 'REQ_002', requisition_status: 'Approved' }
];

const mockProjects = [
  { work_order_no: 'WB_APD_101', site_details: 'Site A', status: 'Running' },
  { work_order_no: 'WB_APD_102', site_details: 'Site B', status: 'Closed' }
];

function createWrapper(initialUrl = '/requisitions') {
  return function Wrapper({ children }) {
    return (
      <MemoryRouter initialEntries={[initialUrl]}>
        {children}
      </MemoryRouter>
    );
  };
}

describe('useRequisitionUrlState hook', () => {
  it('falls back to default tabs based on user role', () => {
    // JE user defaults to 'all'
    const { result: jeResult } = renderHook(
      () => useRequisitionUrlState({ user: { role: 'je' } }),
      { wrapper: createWrapper('/requisitions') }
    );
    expect(jeResult.current.currentTab).toBe('all');

    // ZO/Admin defaults to 'pending'
    const { result: zoResult } = renderHook(
      () => useRequisitionUrlState({ user: { role: 'zo' } }),
      { wrapper: createWrapper('/requisitions') }
    );
    expect(zoResult.current.currentTab).toBe('pending');
  });

  it('reads tab from URL if valid, and allows changing tabs', () => {
    const { result } = renderHook(
      () => useRequisitionUrlState({ user: { role: 'zo' } }),
      { wrapper: createWrapper('/requisitions?tab=hold') }
    );
    expect(result.current.currentTab).toBe('hold');

    act(() => {
      result.current.setTab('approved');
    });
    expect(result.current.currentTab).toBe('approved');
  });

  it('resolves activeWO from URL wo parameter', () => {
    const { result } = renderHook(
      () => useRequisitionUrlState({ user: { role: 'admin' }, projects: mockProjects }),
      { wrapper: createWrapper('/requisitions?wo=WB_APD_101') }
    );
    expect(result.current.activeWO).toEqual(mockProjects[0]);

    act(() => {
      result.current.setActiveWO(null);
    });
    expect(result.current.activeWO).toBeNull();
  });

  it('opens and closes the create requisition modal via URL', () => {
    const { result } = renderHook(
      () => useRequisitionUrlState({ user: { role: 'je' } }),
      { wrapper: createWrapper('/requisitions?create=true') }
    );
    expect(result.current.showCreateModal).toBe(true);

    act(() => {
      result.current.setShowCreateModal(false);
    });
    expect(result.current.showCreateModal).toBe(false);
  });

  it('resolves activeReqId from human-readable requisition_no in URL', () => {
    const { result } = renderHook(
      () => useRequisitionUrlState({ user: { role: 'zo' }, requisitions: mockRequisitions }),
      { wrapper: createWrapper('/requisitions?req=REQ_001') }
    );
    // Should resolve REQ_001 to its UUID for the modal
    expect(result.current.activeReqId).toBe('11111111-1111-1111-1111-111111111111');
    expect(result.current.actionTargetReq).toBeNull();

    act(() => {
      result.current.setActiveReqId(null);
    });
    expect(result.current.activeReqId).toBeNull();
  });

  it('resolves actionTargetReq when action=review is present', () => {
    const { result } = renderHook(
      () => useRequisitionUrlState({ user: { role: 'zo' }, requisitions: mockRequisitions }),
      { wrapper: createWrapper('/requisitions?req=REQ_001&action=review') }
    );
    expect(result.current.actionTargetReq).toEqual(mockRequisitions[0]);
    expect(result.current.activeReqId).toBeNull(); // Action modal takes precedence over detail modal

    act(() => {
      result.current.closeAllModals();
    });
    expect(result.current.actionTargetReq).toBeNull();
  });

  it('resolves routeTargetReq when action=route is present', () => {
    const { result } = renderHook(
      () => useRequisitionUrlState({ user: { role: 'zo' }, requisitions: mockRequisitions }),
      { wrapper: createWrapper('/requisitions?req=REQ_002&action=route') }
    );
    expect(result.current.routeTargetReq).toEqual(mockRequisitions[1]);
    expect(result.current.activeReqId).toBeNull();
  });

  it('reads and updates page number properly', () => {
    const { result } = renderHook(
      () => useRequisitionUrlState({ user: { role: 'zo' } }),
      { wrapper: createWrapper('/requisitions?page=3') }
    );
    expect(result.current.currentPage).toBe(3);

    act(() => {
      result.current.setCurrentPage(1);
    });
    expect(result.current.currentPage).toBe(1);
  });
});
