import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useMasterDataUrlState } from './useMasterDataUrlState';

const wrapperWithInitialEntry = (initialEntry = '/admin/master-data') => {
  return ({ children }) => (
    <MemoryRouter initialEntries={[initialEntry]}>
      {children}
    </MemoryRouter>
  );
};

describe('useMasterDataUrlState hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('parses default state from clean URL', () => {
    const { result } = renderHook(() => useMasterDataUrlState(), {
      wrapper: wrapperWithInitialEntry('/admin/master-data')
    });

    expect(result.current.activeTab).toBe('running');
    expect(result.current.searchQuery).toBe('');
    expect(result.current.departmentFilter).toBe('all');
    expect(result.current.zoneFilter).toBe('all');
    expect(result.current.statusFilter).toBe('all');
    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(10);
    expect(result.current.showCreateModal).toBe(false);
    expect(result.current.showEditModal).toBe(false);
    expect(result.current.showStatusModal).toBe(false);
    expect(result.current.targetWorkOrder).toBe('');
  });

  it('parses deep-linked parameters correctly', () => {
    const { result } = renderHook(() => useMasterDataUrlState(), {
      wrapper: wrapperWithInitialEntry('/admin/master-data?tab=archive&q=APD&dept=PWD&zone=North&status=Closed&page=2&page_size=25&modal=edit&wo=WB_APD_101')
    });

    expect(result.current.activeTab).toBe('archive');
    expect(result.current.searchQuery).toBe('APD');
    expect(result.current.departmentFilter).toBe('PWD');
    expect(result.current.zoneFilter).toBe('North');
    expect(result.current.statusFilter).toBe('Closed');
    expect(result.current.page).toBe(2);
    expect(result.current.pageSize).toBe(25);
    expect(result.current.showCreateModal).toBe(false);
    expect(result.current.showEditModal).toBe(true);
    expect(result.current.targetWorkOrder).toBe('WB_APD_101');
  });

  it('handles tab switches and live debounced search', () => {
    const { result } = renderHook(() => {
      const state = useMasterDataUrlState();
      const location = useLocation();
      return { ...state, location };
    }, {
      wrapper: wrapperWithInitialEntry('/admin/master-data?page=3')
    });

    act(() => {
      result.current.setActiveTab('archive');
    });
    expect(result.current.location.search).toBe('?tab=archive');

    act(() => {
      result.current.setSearchQuery('Kolkata');
    });
    expect(result.current.location.search).toBe('?tab=archive');

    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(result.current.location.search).toContain('q=Kolkata');
  });

  it('handles department and zone filter updates and resetFilters', () => {
    const { result } = renderHook(() => {
      const state = useMasterDataUrlState();
      const location = useLocation();
      return { ...state, location };
    }, {
      wrapper: wrapperWithInitialEntry('/admin/master-data')
    });

    act(() => {
      result.current.setDepartmentFilter('MED');
    });
    expect(result.current.location.search).toBe('?dept=MED');

    act(() => {
      result.current.setZoneFilter('South');
    });
    expect(result.current.location.search).toContain('dept=MED');
    expect(result.current.location.search).toContain('zone=South');

    act(() => {
      result.current.resetFilters();
    });
    expect(result.current.location.search).toBe('');
  });

  it('handles modal workflows and targetWorkOrder propagation', () => {
    const { result } = renderHook(() => {
      const state = useMasterDataUrlState();
      const location = useLocation();
      return { ...state, location };
    }, {
      wrapper: wrapperWithInitialEntry('/admin/master-data')
    });

    act(() => {
      result.current.openCreateModal();
    });
    expect(result.current.showCreateModal).toBe(true);
    expect(result.current.location.search).toBe('?modal=create');

    act(() => {
      result.current.openEditModal('WB_BUR_202');
    });
    expect(result.current.showEditModal).toBe(true);
    expect(result.current.targetWorkOrder).toBe('WB_BUR_202');
    expect(result.current.location.search).toContain('modal=edit');
    expect(result.current.location.search).toContain('wo=WB_BUR_202');

    act(() => {
      result.current.openStatusModal('WB_BUR_202');
    });
    expect(result.current.showStatusModal).toBe(true);
    expect(result.current.location.search).toContain('modal=status');

    act(() => {
      result.current.closeModal();
    });
    expect(result.current.showStatusModal).toBe(false);
    expect(result.current.location.search).not.toContain('modal=status');
    expect(result.current.location.search).not.toContain('wo=WB_BUR_202');
  });
});
