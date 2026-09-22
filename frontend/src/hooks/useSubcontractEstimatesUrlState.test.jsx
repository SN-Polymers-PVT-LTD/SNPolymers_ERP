import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useSubcontractEstimatesUrlState } from './useSubcontractEstimatesUrlState';

function createWrapper(initialUrl = '/subcontract-estimates') {
  return function Wrapper({ children }) {
    return (
      <MemoryRouter initialEntries={[initialUrl]}>
        {children}
      </MemoryRouter>
    );
  };
}

describe('useSubcontractEstimatesUrlState hook', () => {
  it('parses hoTab, status, and filter from URL', () => {
    const { result } = renderHook(
      () => useSubcontractEstimatesUrlState(),
      { wrapper: createWrapper('/subcontract-estimates?tab=history&status=Final+Approved&filter=Draft') }
    );
    expect(result.current.hoTab).toBe('history');
    expect(result.current.statusFilter).toBe('Final Approved');
    expect(result.current.selectedFilter).toBe('Draft');
  });

  it('switches hoTab and updates URL state', () => {
    const { result } = renderHook(
      () => useSubcontractEstimatesUrlState(),
      { wrapper: createWrapper('/subcontract-estimates') }
    );
    expect(result.current.hoTab).toBe('active');

    act(() => {
      result.current.setHoTab('history');
    });
    expect(result.current.hoTab).toBe('history');
  });

  it('updates status and resets page', () => {
    const { result } = renderHook(
      () => useSubcontractEstimatesUrlState(),
      { wrapper: createWrapper('/subcontract-estimates?page=3') }
    );
    expect(result.current.page).toBe(3);

    act(() => {
      result.current.setStatusFilter('Under HO Review');
    });
    expect(result.current.statusFilter).toBe('Under HO Review');
  });
});
