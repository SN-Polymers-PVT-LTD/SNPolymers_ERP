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
  it('ignores the retired history tab while preserving status and filter URL state', () => {
    const { result } = renderHook(
      () => useSubcontractEstimatesUrlState(),
      { wrapper: createWrapper('/subcontract-estimates?tab=history&status=Final+Approved&filter=Draft') }
    );
    expect(result.current).not.toHaveProperty('hoTab');
    expect(result.current.statusFilter).toBe('Final Approved');
    expect(result.current.selectedFilter).toBe('Draft');
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
