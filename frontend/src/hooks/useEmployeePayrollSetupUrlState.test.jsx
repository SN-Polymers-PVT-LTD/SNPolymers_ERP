import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { useEmployeePayrollSetupUrlState } from './useEmployeePayrollSetupUrlState';

function createWrapper(initialUrl = '/admin/employee-management?tab=payroll-setup') {
  return function Wrapper({ children }) {
    return <MemoryRouter initialEntries={[initialUrl]}>{children}</MemoryRouter>;
  };
}

describe('useEmployeePayrollSetupUrlState', () => {
  it('reads default state when no search params are provided', () => {
    const { result } = renderHook(() => useEmployeePayrollSetupUrlState(), {
      wrapper: createWrapper()
    });

    expect(result.current.status).toBe('needs_setup');
    expect(result.current.search).toBe('');
    expect(result.current.department).toBe('');
    expect(result.current.category).toBe('');
    expect(result.current.page).toBe(1);
    expect(result.current.employeeId).toBe('');
  });

  it('hydrates initial filters and employee ID from search params', () => {
    const { result } = renderHook(() => useEmployeePayrollSetupUrlState(), {
      wrapper: createWrapper('/admin/employee-management?tab=payroll-setup&status=has_setup&search=Adam&department=SNP%20Factory&page=2&employee=emp-123')
    });

    expect(result.current.status).toBe('has_setup');
    expect(result.current.search).toBe('Adam');
    expect(result.current.department).toBe('SNP Factory');
    expect(result.current.page).toBe(2);
    expect(result.current.employeeId).toBe('emp-123');
  });

  it('updates filters and resets page to 1', () => {
    const { result } = renderHook(() => useEmployeePayrollSetupUrlState(), {
      wrapper: createWrapper('/admin/employee-management?tab=payroll-setup&page=3')
    });

    expect(result.current.page).toBe(3);

    act(() => {
      result.current.setStatus('all');
    });
    expect(result.current.status).toBe('all');
    expect(result.current.page).toBe(1);

    act(() => {
      result.current.setSearch('Sharma');
    });
    expect(result.current.search).toBe('Sharma');
    expect(result.current.page).toBe(1);
  });

  it('opens and closes employee drawer', () => {
    const { result } = renderHook(() => useEmployeePayrollSetupUrlState(), {
      wrapper: createWrapper()
    });

    act(() => {
      result.current.openEmployee('emp-456');
    });
    expect(result.current.employeeId).toBe('emp-456');

    act(() => {
      result.current.closeEmployee();
    });
    expect(result.current.employeeId).toBe('');
  });
});
