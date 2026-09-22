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
  it('parses initial hoTab, status, and filter from URL', () => {
    const { result } = renderHook(
      () => useEstimatesUrlState(),
      { wrapper: createWrapper('/estimates?tab=history&status=Final+Approved&filter=Draft') }
    );
    expect(result.current.hoTab).toBe('history');
    expect(result.current.statusFilter).toBe('Final Approved');
    expect(result.current.selectedFilter).toBe('Draft');
  });

  it('switches hoTab between active and history', () => {
    const { result } = renderHook(
      () => useEstimatesUrlState(),
      { wrapper: createWrapper('/estimates') }
    );
    expect(result.current.hoTab).toBe('active');

    act(() => {
      result.current.setHoTab('history');
    });
    expect(result.current.hoTab).toBe('history');
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
