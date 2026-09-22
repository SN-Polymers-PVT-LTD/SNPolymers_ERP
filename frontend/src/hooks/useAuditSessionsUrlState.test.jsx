import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useAuditSessionsUrlState } from './useAuditSessionsUrlState';

const wrapperWithInitialEntry = (initialEntry = '/admin/sessions') => {
  return ({ children }) => (
    <MemoryRouter initialEntries={[initialEntry]}>
      {children}
    </MemoryRouter>
  );
};

describe('useAuditSessionsUrlState hook', () => {
  it('parses default state from clean URL', () => {
    const { result } = renderHook(() => useAuditSessionsUrlState(), {
      wrapper: wrapperWithInitialEntry('/admin/sessions')
    });

    expect(result.current.userId).toBe('');
    expect(result.current.dateFrom).toBe('');
    expect(result.current.dateTo).toBe('');
    expect(result.current.status).toBe('all');
    expect(result.current.searchQuery).toBe('');
    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(20);
    expect(result.current.isInspectModalOpen).toBe(false);
    expect(result.current.hasActiveFilters).toBe(false);
  });

  it('parses deep-linked query parameters accurately', () => {
    const { result } = renderHook(() => useAuditSessionsUrlState(), {
      wrapper: wrapperWithInitialEntry('/admin/sessions?userId=usr_42&dateFrom=2026-09-01&dateTo=2026-09-22&status=active&q=192.168&page=3&page_size=50&modal=inspect&sessionId=sess_101')
    });

    expect(result.current.userId).toBe('usr_42');
    expect(result.current.dateFrom).toBe('2026-09-01');
    expect(result.current.dateTo).toBe('2026-09-22');
    expect(result.current.status).toBe('active');
    expect(result.current.searchQuery).toBe('192.168');
    expect(result.current.page).toBe(3);
    expect(result.current.pageSize).toBe(50);
    expect(result.current.isInspectModalOpen).toBe(true);
    expect(result.current.selectedSessionId).toBe('sess_101');
    expect(result.current.hasActiveFilters).toBe(true);
  });

  it('hydrates legacy aliases and replaces them with canonical parameters on write', () => {
    const { result } = renderHook(() => {
      const state = useAuditSessionsUrlState();
      return { ...state, location: useLocation() };
    }, {
      wrapper: wrapperWithInitialEntry('/admin/sessions?user=usr_42&from=2026-09-01&to=2026-09-22&search=Chrome&limit=50&unrelated=keep')
    });

    expect(result.current.userId).toBe('usr_42');
    expect(result.current.dateFrom).toBe('2026-09-01');
    expect(result.current.dateTo).toBe('2026-09-22');
    expect(result.current.searchQuery).toBe('Chrome');
    expect(result.current.pageSize).toBe(50);

    act(() => result.current.setUserId('usr_99'));
    act(() => result.current.setDateFrom('2026-10-01'));
    act(() => result.current.setDateTo('2026-10-31'));
    act(() => result.current.setSearchQuery('Firefox'));
    act(() => result.current.setPageSize(100));

    expect(result.current.location.search).toContain('userId=usr_99');
    expect(result.current.location.search).toContain('dateFrom=2026-10-01');
    expect(result.current.location.search).toContain('dateTo=2026-10-31');
    expect(result.current.location.search).toContain('q=Firefox');
    expect(result.current.location.search).toContain('page_size=100');
    expect(result.current.location.search).not.toMatch(/(?:\?|&)user=/);
    expect(result.current.location.search).not.toMatch(/(?:\?|&)from=/);
    expect(result.current.location.search).not.toMatch(/(?:\?|&)to=/);
    expect(result.current.location.search).not.toMatch(/(?:\?|&)search=/);
    expect(result.current.location.search).not.toMatch(/(?:\?|&)limit=/);
    expect(result.current.location.search).toContain('unrelated=keep');
  });

  it('updates individual filters and resets page to 1', () => {
    const { result } = renderHook(() => {
      const state = useAuditSessionsUrlState();
      const location = useLocation();
      return { ...state, location };
    }, {
      wrapper: wrapperWithInitialEntry('/admin/sessions?page=4')
    });

    act(() => {
      result.current.setUserId('usr_99');
    });
    expect(result.current.location.search).toContain('userId=usr_99');
    expect(result.current.location.search).not.toContain('page=4');

    act(() => {
      result.current.setStatus('expired');
    });
    expect(result.current.location.search).toContain('status=expired');

    act(() => {
      result.current.setDateFrom('2026-09-10');
    });
    expect(result.current.location.search).toContain('dateFrom=2026-09-10');

    act(() => {
      result.current.setDateTo('2026-09-20');
    });
    expect(result.current.location.search).toContain('dateTo=2026-09-20');
  });

  it('updates search query immediately when debounce is false', () => {
    const { result } = renderHook(() => {
      const state = useAuditSessionsUrlState();
      const location = useLocation();
      return { ...state, location };
    }, {
      wrapper: wrapperWithInitialEntry('/admin/sessions')
    });

    act(() => {
      result.current.setSearchQuery('Chrome');
    });

    expect(result.current.location.search).toBe('?q=Chrome');
    expect(result.current.searchQuery).toBe('Chrome');
  });

  it('updates page and page size correctly', () => {
    const { result } = renderHook(() => {
      const state = useAuditSessionsUrlState();
      const location = useLocation();
      return { ...state, location };
    }, {
      wrapper: wrapperWithInitialEntry('/admin/sessions')
    });

    act(() => {
      result.current.setPage(5);
    });
    expect(result.current.location.search).toContain('page=5');

    act(() => {
      result.current.setPageSize(50);
    });
    expect(result.current.location.search).toContain('page_size=50');
    expect(result.current.location.search).not.toContain('page=5');
  });

  it('handles inspect modal open and close', () => {
    const { result } = renderHook(() => {
      const state = useAuditSessionsUrlState();
      const location = useLocation();
      return { ...state, location };
    }, {
      wrapper: wrapperWithInitialEntry('/admin/sessions')
    });

    act(() => {
      result.current.openInspectModal('sess_abc_123');
    });

    expect(result.current.isInspectModalOpen).toBe(true);
    expect(result.current.selectedSessionId).toBe('sess_abc_123');
    expect(result.current.location.search).toContain('modal=inspect');
    expect(result.current.location.search).toContain('sessionId=sess_abc_123');

    act(() => {
      result.current.closeModal();
    });

    expect(result.current.isInspectModalOpen).toBe(false);
  });

  it('batch applies filters and resets filters', () => {
    const { result } = renderHook(() => {
      const state = useAuditSessionsUrlState();
      const location = useLocation();
      return { ...state, location };
    }, {
      wrapper: wrapperWithInitialEntry('/admin/sessions')
    });

    act(() => {
      result.current.applyFilters({
        userId: 'usr_77',
        dateFrom: '2026-09-01',
        dateTo: '2026-09-15',
        status: 'active',
        q: 'Firefox'
      });
    });

    expect(result.current.userId).toBe('usr_77');
    expect(result.current.dateFrom).toBe('2026-09-01');
    expect(result.current.dateTo).toBe('2026-09-15');
    expect(result.current.status).toBe('active');
    expect(result.current.searchQuery).toBe('Firefox');

    act(() => {
      result.current.resetFilters();
    });

    expect(result.current.userId).toBe('');
    expect(result.current.dateFrom).toBe('');
    expect(result.current.dateTo).toBe('');
    expect(result.current.status).toBe('all');
    expect(result.current.searchQuery).toBe('');
    expect(result.current.location.search).toBe('');
  });

  it('cancels a pending debounced search when unmounted', () => {
    vi.useFakeTimers();
    try {
      const { result, unmount } = renderHook(() => useAuditSessionsUrlState(), {
        wrapper: wrapperWithInitialEntry('/admin/sessions')
      });

      act(() => result.current.setSearchQuery('late write', { debounce: true }));
      unmount();
      act(() => vi.advanceTimersByTime(300));
    } finally {
      vi.useRealTimers();
    }
  });
});
