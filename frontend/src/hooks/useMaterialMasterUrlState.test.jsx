import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import React from 'react';
import { useMaterialMasterUrlState } from './useMaterialMasterUrlState';

const wrapperWithInitialEntries = (initialEntries = ['/materials']) => {
  return ({ children }) => (
    <MemoryRouter initialEntries={initialEntries}>
      {children}
    </MemoryRouter>
  );
};

describe('useMaterialMasterUrlState hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('parses default state from clean URL for non-admin and admin', () => {
    const { result: nonAdminRes } = renderHook(() => useMaterialMasterUrlState({ isAdmin: false }), {
      wrapper: wrapperWithInitialEntries(['/materials'])
    });

    expect(nonAdminRes.current.searchQuery).toBe('');
    expect(nonAdminRes.current.mainHeadFilter).toBe('');
    expect(nonAdminRes.current.subHeadFilter).toBe('');
    expect(nonAdminRes.current.activeFilter).toBe('');
    expect(nonAdminRes.current.sortBy).toBe('Material_Details');
    expect(nonAdminRes.current.sortOrder).toBe('asc');
    expect(nonAdminRes.current.page).toBe(1);
    expect(nonAdminRes.current.isCreateModalOpen).toBe(false);
    expect(nonAdminRes.current.isEditModalOpen).toBe(false);

    const { result: adminRes } = renderHook(() => useMaterialMasterUrlState({ isAdmin: true }), {
      wrapper: wrapperWithInitialEntries(['/materials'])
    });

    expect(adminRes.current.activeFilter).toBe('true');
  });

  it('parses deep link parameters accurately', () => {
    const { result } = renderHook(() => useMaterialMasterUrlState({ isAdmin: true }), {
      wrapper: wrapperWithInitialEntries([
        '/materials?q=Cement&main_head=Raw+Materials&sub_head=OPC&active=false&sort_by=Material_Main_Head&sort_order=desc&page=4&modal=edit&materialId=42'
      ])
    });

    expect(result.current.searchQuery).toBe('Cement');
    expect(result.current.mainHeadFilter).toBe('Raw Materials');
    expect(result.current.subHeadFilter).toBe('OPC');
    expect(result.current.activeFilter).toBe('false');
    expect(result.current.sortBy).toBe('Material_Main_Head');
    expect(result.current.sortOrder).toBe('desc');
    expect(result.current.page).toBe(4);
    expect(result.current.isCreateModalOpen).toBe(false);
    expect(result.current.isEditModalOpen).toBe(true);
    expect(result.current.materialId).toBe('42');
  });

  it('debounces search query and resets page to 1', () => {
    const { result } = renderHook(() => {
      const urlState = useMaterialMasterUrlState();
      const location = useLocation();
      return { urlState, location };
    }, {
      wrapper: wrapperWithInitialEntries(['/materials?page=3'])
    });

    act(() => {
      result.current.urlState.setSearchQuery('Bitumen');
    });

    // Before debounce timer
    expect(result.current.urlState.searchQuery).toBe('');

    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(result.current.urlState.searchQuery).toBe('Bitumen');
    expect(result.current.location.search).toContain('q=Bitumen');
    expect(result.current.location.search).not.toContain('page=');
  });

  it('updates category filters and resets page to 1', () => {
    const { result } = renderHook(() => {
      const urlState = useMaterialMasterUrlState();
      const location = useLocation();
      return { urlState, location };
    }, {
      wrapper: wrapperWithInitialEntries(['/materials?page=2'])
    });

    act(() => {
      result.current.urlState.setMainHeadFilter('Aggregates');
    });

    expect(result.current.urlState.mainHeadFilter).toBe('Aggregates');
    expect(result.current.location.search).toContain('main_head=Aggregates');
    expect(result.current.location.search).not.toContain('page=');

    act(() => {
      result.current.urlState.setSubHeadFilter('Sand');
    });

    expect(result.current.urlState.subHeadFilter).toBe('Sand');
    expect(result.current.location.search).toContain('sub_head=Sand');
  });

  it('handles sort field and direction toggling', () => {
    const { result } = renderHook(() => {
      const urlState = useMaterialMasterUrlState();
      const location = useLocation();
      return { urlState, location };
    }, {
      wrapper: wrapperWithInitialEntries(['/materials'])
    });

    // Toggle same field: Material_Details asc -> desc
    act(() => {
      result.current.urlState.handleSort('Material_Details');
    });
    expect(result.current.urlState.sortOrder).toBe('desc');
    expect(result.current.location.search).toContain('sort_order=desc');

    // Switch field: sets new field and defaults to asc
    act(() => {
      result.current.urlState.handleSort('Material_Sub_Head');
    });
    expect(result.current.urlState.sortBy).toBe('Material_Sub_Head');
    expect(result.current.urlState.sortOrder).toBe('asc');
    expect(result.current.location.search).toContain('sort_by=Material_Sub_Head');
  });

  it('updates page with direct number and functional updater', () => {
    const { result } = renderHook(() => {
      const urlState = useMaterialMasterUrlState();
      const location = useLocation();
      return { urlState, location };
    }, {
      wrapper: wrapperWithInitialEntries(['/materials'])
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

  it('opens create and edit modals with history discipline', () => {
    const { result } = renderHook(() => {
      const urlState = useMaterialMasterUrlState();
      const location = useLocation();
      return { urlState, location };
    }, {
      wrapper: wrapperWithInitialEntries(['/materials'])
    });

    act(() => {
      result.current.urlState.openCreateModal();
    });
    expect(result.current.urlState.isCreateModalOpen).toBe(true);
    expect(result.current.location.search).toContain('modal=create');

    act(() => {
      result.current.urlState.closeModal();
    });
    expect(result.current.urlState.isCreateModalOpen).toBe(false);
    expect(result.current.location.search).not.toContain('modal=');

    act(() => {
      result.current.urlState.openEditModal(88);
    });
    expect(result.current.urlState.isEditModalOpen).toBe(true);
    expect(result.current.urlState.materialId).toBe('88');
    expect(result.current.location.search).toContain('modal=edit');
    expect(result.current.location.search).toContain('materialId=88');

    act(() => {
      result.current.urlState.closeModal();
    });
    expect(result.current.urlState.isEditModalOpen).toBe(false);
    expect(result.current.location.search).not.toContain('modal=');
  });

  it('resets all filters back to clean URL', () => {
    const { result } = renderHook(() => {
      const urlState = useMaterialMasterUrlState();
      const location = useLocation();
      return { urlState, location };
    }, {
      wrapper: wrapperWithInitialEntries(['/materials?q=Pipes&main_head=Plumbing&active=true&page=2'])
    });

    act(() => {
      result.current.urlState.resetFilters();
    });

    expect(result.current.urlState.searchQuery).toBe('');
    expect(result.current.urlState.mainHeadFilter).toBe('');
    expect(result.current.urlState.page).toBe(1);
    expect(result.current.location.search).toBe('');
  });
});
