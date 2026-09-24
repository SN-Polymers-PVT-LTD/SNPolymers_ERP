import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useAuditComplianceUrlState } from './useAuditComplianceUrlState';

const wrapperWithInitialEntry = (initialEntry = '/analytics/audit') => {
  return ({ children }) => (
    <MemoryRouter initialEntries={[initialEntry]}>
      {children}
    </MemoryRouter>
  );
};

describe('useAuditComplianceUrlState hook', () => {
  it('parses default state from clean URL', () => {
    const { result } = renderHook(() => useAuditComplianceUrlState(), {
      wrapper: wrapperWithInitialEntry('/analytics/audit')
    });

    expect(result.current.moduleName).toBe('');
    expect(result.current.userId).toBe('');
    expect(result.current.recordId).toBe('');
    expect(result.current.page).toBe(1);
  });

  it('parses deep-linked filters and page from search params', () => {
    const { result } = renderHook(() => useAuditComplianceUrlState(), {
      wrapper: wrapperWithInitialEntry('/analytics/audit?module=Requisitions&user_id=usr_12&record=REQ_001&page=3')
    });

    expect(result.current.moduleName).toBe('Requisitions');
    expect(result.current.userId).toBe('usr_12');
    expect(result.current.recordId).toBe('REQ_001');
    expect(result.current.page).toBe(3);
  });

  it('applies filters, resets page to 1, and pushes history', () => {
    const { result } = renderHook(() => {
      const state = useAuditComplianceUrlState();
      const location = useLocation();
      return { ...state, location };
    }, {
      wrapper: wrapperWithInitialEntry('/analytics/audit?page=4')
    });

    act(() => {
      result.current.applyFilters({
        module_name: 'Fund Requests',
        user_id: 'usr_88',
        record_identifier: 'FR_10'
      });
    });

    expect(result.current.location.search).toContain('module=Fund+Requests');
    expect(result.current.location.search).toContain('user_id=usr_88');
    expect(result.current.location.search).toContain('record=FR_10');
    expect(result.current.location.search).not.toContain('page=4');
  });

  it('updates page and resets filters', () => {
    const { result } = renderHook(() => {
      const state = useAuditComplianceUrlState();
      const location = useLocation();
      return { ...state, location };
    }, {
      wrapper: wrapperWithInitialEntry('/analytics/audit?module=Requisitions')
    });

    act(() => {
      result.current.setPage(2);
    });
    expect(result.current.location.search).toContain('page=2');

    act(() => {
      result.current.resetFilters();
    });
    expect(result.current.location.search).toBe('');
  });
});
