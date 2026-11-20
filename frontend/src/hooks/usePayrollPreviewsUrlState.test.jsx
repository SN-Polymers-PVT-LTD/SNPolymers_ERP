import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { usePayrollPreviewsUrlState } from './usePayrollPreviewsUrlState';

function createWrapper(initialUrl = '/hr/payroll/previews') {
  return function Wrapper({ children }) {
    return <MemoryRouter initialEntries={[initialUrl]}>{children}</MemoryRouter>;
  };
}

describe('usePayrollPreviewsUrlState', () => {
  it('reads default empty state', () => {
    const { result } = renderHook(() => usePayrollPreviewsUrlState(), {
      wrapper: createWrapper()
    });

    expect(result.current.page).toBe(1);
    expect(result.current.run).toBe('');
    expect(result.current.rowPage).toBe(1);
    expect(result.current.rowId).toBe('');
    expect(result.current.isPreviewOpen).toBe(false);
  });

  it('hydrates initial parameters from URL', () => {
    const { result } = renderHook(() => usePayrollPreviewsUrlState(), {
      wrapper: createWrapper('/hr/payroll/previews?page=2&run=run-xyz&rowPage=3&modal=preview&rowId=row-123')
    });

    expect(result.current.page).toBe(2);
    expect(result.current.run).toBe('run-xyz');
    expect(result.current.rowPage).toBe(3);
    expect(result.current.rowId).toBe('row-123');
    expect(result.current.isPreviewOpen).toBe(true);
  });

  it('changes run and resets rowPage/modal', () => {
    const { result } = renderHook(() => usePayrollPreviewsUrlState(), {
      wrapper: createWrapper('/hr/payroll/previews?run=old-run&rowPage=2&modal=preview&rowId=row-1')
    });

    act(() => {
      result.current.setRun('new-run');
    });

    expect(result.current.run).toBe('new-run');
    expect(result.current.rowPage).toBe(1);
    expect(result.current.rowId).toBe('');
    expect(result.current.isPreviewOpen).toBe(false);
  });

  it('opens and closes preview modal', () => {
    const { result } = renderHook(() => usePayrollPreviewsUrlState(), {
      wrapper: createWrapper()
    });

    act(() => {
      result.current.openPreview('target-row-789');
    });

    expect(result.current.rowId).toBe('target-row-789');
    expect(result.current.isPreviewOpen).toBe(true);

    act(() => {
      result.current.closePreview();
    });

    expect(result.current.rowId).toBe('');
    expect(result.current.isPreviewOpen).toBe(false);
  });
});
