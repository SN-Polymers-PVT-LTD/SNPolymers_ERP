import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { usePayrollReviewUrlState } from './usePayrollReviewUrlState';

function createWrapper(initialUrl = '/hr/payroll/review') {
  return function Wrapper({ children }) {
    return <MemoryRouter initialEntries={[initialUrl]}>{children}</MemoryRouter>;
  };
}

describe('usePayrollReviewUrlState', () => {
  it('reads default empty state', () => {
    const { result } = renderHook(() => usePayrollReviewUrlState(), {
      wrapper: createWrapper()
    });

    expect(result.current.page).toBe(1);
    expect(result.current.status).toBe('');
    expect(result.current.runId).toBe('');
    expect(result.current.rowId).toBe('');
  });

  it('hydrates initial parameters from URL', () => {
    const { result } = renderHook(() => usePayrollReviewUrlState(), {
      wrapper: createWrapper('/hr/payroll/review?status=PENDING_HO_APPROVAL&page=2&run=run-456&row=row-789')
    });

    expect(result.current.page).toBe(2);
    expect(result.current.status).toBe('PENDING_HO_APPROVAL');
    expect(result.current.runId).toBe('run-456');
    expect(result.current.rowId).toBe('row-789');
  });

  it('updates status and resets page to 1', () => {
    const { result } = renderHook(() => usePayrollReviewUrlState(), {
      wrapper: createWrapper('/hr/payroll/review?page=3')
    });

    act(() => {
      result.current.setStatus('CALCULATED');
    });

    expect(result.current.status).toBe('CALCULATED');
    expect(result.current.page).toBe(1);
  });

  it('changes runId and clears rowId', () => {
    const { result } = renderHook(() => usePayrollReviewUrlState(), {
      wrapper: createWrapper('/hr/payroll/review?run=run-old&row=row-old')
    });

    act(() => {
      result.current.setRunId('run-new');
    });

    expect(result.current.runId).toBe('run-new');
    expect(result.current.rowId).toBe('');
  });
});
