import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import React from 'react';
import { useFundReportsUrlState } from './useFundReportsUrlState';

const wrapperWithInitialEntries = (initialEntries = ['/fund-reports']) => {
  return ({ children }) => (
    <MemoryRouter initialEntries={initialEntries}>
      {children}
    </MemoryRouter>
  );
};

describe('useFundReportsUrlState hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('parses default state from clean URL', () => {
    const { result } = renderHook(() => useFundReportsUrlState(), {
      wrapper: wrapperWithInitialEntries(['/fund-reports'])
    });

    expect(result.current.tab).toBe('active');
    expect(result.current.searchQuery).toBe('');
    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(10);
    expect(result.current.isCreateModalOpen).toBe(false);
    expect(result.current.isEditModalOpen).toBe(false);
  });

  it('parses deep link parameters accurately', () => {
    const { result } = renderHook(() => useFundReportsUrlState(), {
      wrapper: wrapperWithInitialEntries([
        '/fund-reports?tab=deleted&q=WO-99&page=3&page_size=20&modal=edit&reportId=77'
      ])
    });

    expect(result.current.tab).toBe('deleted');
    expect(result.current.searchQuery).toBe('WO-99');
    expect(result.current.page).toBe(3);
    expect(result.current.pageSize).toBe(20);
    expect(result.current.isCreateModalOpen).toBe(false);
    expect(result.current.isEditModalOpen).toBe(true);
    expect(result.current.reportId).toBe('77');
  });

  it('falls back safely on invalid tab and invalid page size', () => {
    const { result } = renderHook(() => useFundReportsUrlState(), {
      wrapper: wrapperWithInitialEntries(['/fund-reports?tab=unknown&page_size=999'])
    });

    expect(result.current.tab).toBe('active');
    expect(result.current.pageSize).toBe(10);
  });

  it('updates tab and resets page to 1', () => {
    const { result } = renderHook(() => {
      const urlState = useFundReportsUrlState();
      const location = useLocation();
      return { urlState, location };
    }, {
      wrapper: wrapperWithInitialEntries(['/fund-reports?page=4'])
    });

    act(() => {
      result.current.urlState.setTab('deleted');
    });

    expect(result.current.urlState.tab).toBe('deleted');
    expect(result.current.location.search).toContain('tab=deleted');
    expect(result.current.location.search).not.toContain('page=');
  });

  it('debounces search query updates and resets page to 1', () => {
    const { result } = renderHook(() => {
      const urlState = useFundReportsUrlState();
      const location = useLocation();
      return { urlState, location };
    }, {
      wrapper: wrapperWithInitialEntries(['/fund-reports?page=2'])
    });

    act(() => {
      result.current.urlState.setSearchQuery('Disbursement');
    });

    // Before debounce timer
    expect(result.current.urlState.searchQuery).toBe('');

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.urlState.searchQuery).toBe('Disbursement');
    expect(result.current.location.search).toContain('q=Disbursement');
    expect(result.current.location.search).not.toContain('page=');
  });

  it('updates page with direct number and functional updater', () => {
    const { result } = renderHook(() => {
      const urlState = useFundReportsUrlState();
      const location = useLocation();
      return { urlState, location };
    }, {
      wrapper: wrapperWithInitialEntries(['/fund-reports'])
    });

    act(() => {
      result.current.urlState.setPage(3);
    });
    expect(result.current.urlState.page).toBe(3);
    expect(result.current.location.search).toContain('page=3');

    act(() => {
      result.current.urlState.setPage((prev) => prev + 1);
    });
    expect(result.current.urlState.page).toBe(4);
    expect(result.current.location.search).toContain('page=4');
  });

  it('updates page size and resets page to 1', () => {
    const { result } = renderHook(() => {
      const urlState = useFundReportsUrlState();
      const location = useLocation();
      return { urlState, location };
    }, {
      wrapper: wrapperWithInitialEntries(['/fund-reports?page=5'])
    });

    act(() => {
      result.current.urlState.setPageSize(50);
    });

    expect(result.current.urlState.pageSize).toBe(50);
    expect(result.current.location.search).toContain('page_size=50');
    expect(result.current.location.search).not.toContain('page=');
  });

  it('opens create modal with optional wo and edit modal with history pop', () => {
    const { result } = renderHook(() => {
      const urlState = useFundReportsUrlState();
      const location = useLocation();
      return { urlState, location };
    }, {
      wrapper: wrapperWithInitialEntries(['/fund-reports'])
    });

    act(() => {
      result.current.urlState.openCreateModal('WO-2026-001');
    });
    expect(result.current.urlState.isCreateModalOpen).toBe(true);
    expect(result.current.urlState.workOrderNo).toBe('WO-2026-001');
    expect(result.current.location.search).toContain('modal=create');
    expect(result.current.location.search).toContain('wo=WO-2026-001');

    act(() => {
      result.current.urlState.closeModal();
    });
    expect(result.current.urlState.isCreateModalOpen).toBe(false);
    expect(result.current.location.search).not.toContain('modal=');

    act(() => {
      result.current.urlState.openEditModal(42);
    });
    expect(result.current.urlState.isEditModalOpen).toBe(true);
    expect(result.current.urlState.reportId).toBe('42');
    expect(result.current.location.search).toContain('modal=edit');
    expect(result.current.location.search).toContain('reportId=42');

    act(() => {
      result.current.urlState.closeModal();
    });
    expect(result.current.urlState.isEditModalOpen).toBe(false);
    expect(result.current.location.search).not.toContain('modal=');
  });

  it('resets all filters back to clean URL', () => {
    const { result } = renderHook(() => {
      const urlState = useFundReportsUrlState();
      const location = useLocation();
      return { urlState, location };
    }, {
      wrapper: wrapperWithInitialEntries(['/fund-reports?q=Kolkata&page=2&page_size=20&wo=WO-101'])
    });

    act(() => {
      result.current.urlState.resetFilters();
    });

    expect(result.current.urlState.searchQuery).toBe('');
    expect(result.current.urlState.page).toBe(1);
    expect(result.current.urlState.pageSize).toBe(10);
    expect(result.current.location.search).toBe('');
  });
});
