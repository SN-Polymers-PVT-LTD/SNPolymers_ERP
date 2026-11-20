import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { usePayrollRegisterUrlState } from './usePayrollRegisterUrlState';

function createWrapper(initialUrl = '/hr/payroll/register') {
  return function Wrapper({ children }) {
    return <MemoryRouter initialEntries={[initialUrl]}>{children}</MemoryRouter>;
  };
}

describe('usePayrollRegisterUrlState', () => {
  it('reads default empty state', () => {
    const { result } = renderHook(() => usePayrollRegisterUrlState(), {
      wrapper: createWrapper()
    });

    expect(result.current.filters).toEqual({});
    expect(result.current.page).toBe(1);
    expect(result.current.employee).toBe('');
    expect(result.current.isPayslipOpen).toBe(false);
  });

  it('hydrates filters and pagination from search params', () => {
    const { result } = renderHook(() => usePayrollRegisterUrlState(), {
      wrapper: createWrapper('/hr/payroll/register?q=John&department=Civil&status=CALCULATED&page=3&modal=payslip&employee=row-99')
    });

    expect(result.current.filters).toEqual({
      search: 'John',
      department: 'Civil',
      status: 'CALCULATED'
    });
    expect(result.current.page).toBe(3);
    expect(result.current.employee).toBe('row-99');
    expect(result.current.isPayslipOpen).toBe(true);
  });

  it('applies new filters and resets pagination to 1', () => {
    const { result } = renderHook(() => usePayrollRegisterUrlState(), {
      wrapper: createWrapper('/hr/payroll/register?page=4')
    });

    expect(result.current.page).toBe(4);

    act(() => {
      result.current.applyFilters({ search: 'Dev', department: 'Fabric Factory' });
    });

    expect(result.current.filters).toEqual({
      search: 'Dev',
      department: 'Fabric Factory'
    });
    expect(result.current.page).toBe(1);
  });

  it('opens and closes payslip modal', () => {
    const { result } = renderHook(() => usePayrollRegisterUrlState(), {
      wrapper: createWrapper()
    });

    act(() => {
      result.current.openPayslip('row-456');
    });

    expect(result.current.employee).toBe('row-456');
    expect(result.current.isPayslipOpen).toBe(true);

    act(() => {
      result.current.closePayslip();
    });

    expect(result.current.employee).toBe('');
    expect(result.current.isPayslipOpen).toBe(false);
  });
});
