import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useAdminPanelUrlState } from './useAdminPanelUrlState';

const wrapperWithInitialEntry = (initialEntry = '/admin') => {
  return ({ children }) => (
    <MemoryRouter initialEntries={[initialEntry]}>
      {children}
    </MemoryRouter>
  );
};

describe('useAdminPanelUrlState hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('parses default state from clean URL', () => {
    const { result } = renderHook(() => useAdminPanelUrlState(), {
      wrapper: wrapperWithInitialEntry('/admin')
    });

    expect(result.current.searchQuery).toBe('');
    expect(result.current.roleFilter).toBe('all');
    expect(result.current.statusFilter).toBe('all');
    expect(result.current.telegramFilter).toBe('all');
    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(10);
    expect(result.current.showAddModal).toBe(false);
    expect(result.current.showEditModal).toBe(false);
    expect(result.current.userId).toBe('');
  });

  it('parses deep-linked filters, pagination, and modals from search params', () => {
    const { result } = renderHook(() => useAdminPanelUrlState(), {
      wrapper: wrapperWithInitialEntry('/admin?q=John&role=zo&status=active&telegram=connected&page=3&page_size=25&modal=edit&userId=usr_42')
    });

    expect(result.current.searchQuery).toBe('John');
    expect(result.current.roleFilter).toBe('zo');
    expect(result.current.statusFilter).toBe('active');
    expect(result.current.telegramFilter).toBe('connected');
    expect(result.current.page).toBe(3);
    expect(result.current.pageSize).toBe(25);
    expect(result.current.showAddModal).toBe(false);
    expect(result.current.showEditModal).toBe(true);
    expect(result.current.userId).toBe('usr_42');
  });

  it('updates live search query with debounce', () => {
    const { result } = renderHook(() => {
      const state = useAdminPanelUrlState();
      const location = useLocation();
      return { ...state, location };
    }, {
      wrapper: wrapperWithInitialEntry('/admin?page=2')
    });

    act(() => {
      result.current.setSearchQuery('Alice');
    });

    // Before debounce timer fires
    expect(result.current.location.search).toBe('?page=2');

    act(() => {
      vi.advanceTimersByTime(350);
    });

    // After debounce: q is set and page is reset
    expect(result.current.location.search).toContain('q=Alice');
    expect(result.current.location.search).not.toContain('page=2');
  });

  it('updates role and status filters and resets filters', () => {
    const { result } = renderHook(() => {
      const state = useAdminPanelUrlState();
      const location = useLocation();
      return { ...state, location };
    }, {
      wrapper: wrapperWithInitialEntry('/admin?page=4')
    });

    act(() => {
      result.current.setRoleFilter('accounts');
    });
    expect(result.current.location.search).toBe('?role=accounts');

    act(() => {
      result.current.setStatusFilter('deactivated');
    });
    expect(result.current.location.search).toContain('role=accounts');
    expect(result.current.location.search).toContain('status=deactivated');

    act(() => {
      result.current.resetFilters();
    });
    expect(result.current.location.search).toBe('');
  });

  it('handles add and edit modal workflows with history navigation', () => {
    const { result } = renderHook(() => {
      const state = useAdminPanelUrlState();
      const location = useLocation();
      return { ...state, location };
    }, {
      wrapper: wrapperWithInitialEntry('/admin?role=je')
    });

    act(() => {
      result.current.openAddModal();
    });
    expect(result.current.showAddModal).toBe(true);
    expect(result.current.location.search).toContain('modal=add');

    act(() => {
      result.current.openEditModal('usr_99');
    });
    expect(result.current.showEditModal).toBe(true);
    expect(result.current.userId).toBe('usr_99');
    expect(result.current.location.search).toContain('modal=edit');
    expect(result.current.location.search).toContain('userId=usr_99');

    act(() => {
      result.current.closeEditModal();
    });
    expect(result.current.location.search).not.toContain('modal=edit');
    expect(result.current.location.search).not.toContain('userId=usr_99');
  });
});
