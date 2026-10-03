import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { usePurchaseOptionsUrlState } from './usePurchaseOptionsUrlState';

const wrapperWithInitialEntry = (initialEntry = '/admin/purchase-options') => {
  return ({ children }) => (
    <MemoryRouter initialEntries={[initialEntry]}>
      {children}
    </MemoryRouter>
  );
};

describe('usePurchaseOptionsUrlState hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('parses default state from clean URL', () => {
    const { result } = renderHook(() => usePurchaseOptionsUrlState(), {
      wrapper: wrapperWithInitialEntry('/admin/purchase-options')
    });

    expect(result.current.searchQuery).toBe('');
    expect(result.current.statusFilter).toBe('all');
    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(10);
    expect(result.current.showAddModal).toBe(false);
    expect(result.current.showEditModal).toBe(false);
    expect(result.current.targetId).toBe('');
  });

  it('parses deep-linked filters and modals from search params', () => {
    const { result } = renderHook(() => usePurchaseOptionsUrlState(), {
      wrapper: wrapperWithInitialEntry('/admin/purchase-options?q=Market&status=active&page=2&page_size=25&modal=edit&id=opt_12')
    });

    expect(result.current.searchQuery).toBe('Market');
    expect(result.current.statusFilter).toBe('active');
    expect(result.current.page).toBe(2);
    expect(result.current.pageSize).toBe(25);
    expect(result.current.showAddModal).toBe(false);
    expect(result.current.showEditModal).toBe(true);
    expect(result.current.targetId).toBe('opt_12');
  });

  it('updates live search query with debounce and resets page', () => {
    const { result } = renderHook(() => {
      const state = usePurchaseOptionsUrlState();
      const location = useLocation();
      return { ...state, location };
    }, {
      wrapper: wrapperWithInitialEntry('/admin/purchase-options?page=3')
    });

    act(() => {
      result.current.setSearchQuery('Retail');
    });

    expect(result.current.location.search).toBe('?page=3');

    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(result.current.location.search).toContain('q=Retail');
    expect(result.current.location.search).not.toContain('page=3');
  });

  it('handles status filter toggles and resetFilters', () => {
    const { result } = renderHook(() => {
      const state = usePurchaseOptionsUrlState();
      const location = useLocation();
      return { ...state, location };
    }, {
      wrapper: wrapperWithInitialEntry('/admin/purchase-options')
    });

    act(() => {
      result.current.setStatusFilter('inactive');
    });
    expect(result.current.location.search).toBe('?status=inactive');

    act(() => {
      result.current.resetFilters();
    });
    expect(result.current.location.search).toBe('');
  });

  it('handles add and edit modal workflows and close navigation', () => {
    const { result } = renderHook(() => {
      const state = usePurchaseOptionsUrlState();
      const location = useLocation();
      return { ...state, location };
    }, {
      wrapper: wrapperWithInitialEntry('/admin/purchase-options')
    });

    act(() => {
      result.current.openAddModal();
    });
    expect(result.current.showAddModal).toBe(true);
    expect(result.current.location.search).toBe('?modal=add');

    act(() => {
      result.current.openEditModal('opt_99');
    });
    expect(result.current.showEditModal).toBe(true);
    expect(result.current.targetId).toBe('opt_99');
    expect(result.current.location.search).toContain('modal=edit');
    expect(result.current.location.search).toContain('id=opt_99');

    act(() => {
      result.current.closeModal();
    });
    expect(result.current.showEditModal).toBe(false);
    expect(result.current.location.search).not.toContain('modal=edit');
    expect(result.current.location.search).not.toContain('id=opt_99');
  });
});
