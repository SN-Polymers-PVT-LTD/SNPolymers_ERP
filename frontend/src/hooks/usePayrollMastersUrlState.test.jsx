import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { usePayrollMastersUrlState } from './usePayrollMastersUrlState';

function createWrapper(initialUrl = '/admin/payroll/policies') {
  return function Wrapper({ children }) {
    return <MemoryRouter initialEntries={[initialUrl]}>{children}</MemoryRouter>;
  };
}

describe('usePayrollMastersUrlState', () => {
  it('reads default state when no search params are provided', () => {
    const { result } = renderHook(() => usePayrollMastersUrlState(), {
      wrapper: createWrapper()
    });

    expect(result.current.page).toBe(1);
    expect(result.current.modal).toBe('');
    expect(result.current.revisionId).toBe('');
  });

  it('hydrates initial page and modal from search params', () => {
    const { result } = renderHook(() => usePayrollMastersUrlState(), {
      wrapper: createWrapper('/admin/payroll/policies?page=3&modal=history&revisionId=rev-123')
    });

    expect(result.current.page).toBe(3);
    expect(result.current.modal).toBe('history');
    expect(result.current.revisionId).toBe('rev-123');
  });

  it('updates page and clears it when set to 1', () => {
    const { result } = renderHook(() => usePayrollMastersUrlState(), {
      wrapper: createWrapper()
    });

    act(() => {
      result.current.setPage(4);
    });
    expect(result.current.page).toBe(4);

    act(() => {
      result.current.setPage(1);
    });
    expect(result.current.page).toBe(1);
  });

  it('opens and closes modal states', () => {
    const { result } = renderHook(() => usePayrollMastersUrlState(), {
      wrapper: createWrapper()
    });

    act(() => {
      result.current.openCreate();
    });
    expect(result.current.modal).toBe('create');
    expect(result.current.revisionId).toBe('');

    act(() => {
      result.current.openEdit('rev-edit-1');
    });
    expect(result.current.modal).toBe('edit');
    expect(result.current.revisionId).toBe('rev-edit-1');

    act(() => {
      result.current.openPreview('rev-prev-1');
    });
    expect(result.current.modal).toBe('preview');
    expect(result.current.revisionId).toBe('rev-prev-1');

    act(() => {
      result.current.openHistory('rev-hist-1');
    });
    expect(result.current.modal).toBe('history');
    expect(result.current.revisionId).toBe('rev-hist-1');

    act(() => {
      result.current.closeModal();
    });
    expect(result.current.modal).toBe('');
    expect(result.current.revisionId).toBe('');
  });
});
