import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useEstimatesUrlState } from './useEstimatesUrlState';

function createWrapper(initialUrl = '/estimates') {
  return function Wrapper({ children }) {
    return (
      <MemoryRouter initialEntries={[initialUrl]}>
        {children}
      </MemoryRouter>
    );
  };
}

describe('useEstimatesUrlState hook', () => {
  it('ignores the retired history tab while preserving status and filter URL state', () => {
    const { result } = renderHook(
      () => useEstimatesUrlState(),
      { wrapper: createWrapper('/estimates?tab=history&status=Final+Approved&filter=Draft') }
    );
    expect(result.current).not.toHaveProperty('hoTab');
    expect(result.current.statusFilter).toBe('Final Approved');
    expect(result.current.selectedFilter).toBe('Draft');
  });

  it('updates status and resets page', () => {
    const { result } = renderHook(
      () => useEstimatesUrlState(),
      { wrapper: createWrapper('/estimates?page=2') }
    );
    expect(result.current.page).toBe(2);

    act(() => {
      result.current.setStatusFilter('Under HO Review');
    });
    expect(result.current.statusFilter).toBe('Under HO Review');
  });

  it('updates page number', () => {
    const { result } = renderHook(
      () => useEstimatesUrlState(),
      { wrapper: createWrapper('/estimates') }
    );
    expect(result.current.page).toBe(1);

    act(() => {
      result.current.setPage(4);
    });
    expect(result.current.page).toBe(4);
  });
});
