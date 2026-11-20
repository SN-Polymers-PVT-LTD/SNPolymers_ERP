import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useZonalBalancesUrlState } from './useZonalBalancesUrlState';

function createWrapper(initialUrl = '/zonal-balances') {
  return function Wrapper({ children }) {
    return (
      <MemoryRouter initialEntries={[initialUrl]}>
        {children}
      </MemoryRouter>
    );
  };
}

describe('useZonalBalancesUrlState hook', () => {
  it('parses default state from clean URL', () => {
    const { result } = renderHook(
      () => useZonalBalancesUrlState(),
      { wrapper: createWrapper('/zonal-balances') }
    );

    expect(result.current.selectedZo).toBe('');
    expect(result.current.searchQuery).toBe('');
    expect(result.current.sortKey).toBe('name');
    expect(result.current.sortAsc).toBe(true);
    expect(result.current.balancesPage).toBe(1);
    expect(result.current.page).toBe(1);
  });

  it('parses deep-linked state from URL parameters', () => {
    const { result } = renderHook(
      () => useZonalBalancesUrlState(),
      {
        wrapper: createWrapper(
          '/zonal-balances?zo=%2B919876543210&search=Kolkata&sort=balance&dir=desc&zo_page=2&page=4'
        )
      }
    );

    expect(result.current.selectedZo).toBe('+919876543210');
    expect(result.current.searchQuery).toBe('Kolkata');
    expect(result.current.sortKey).toBe('balance');
    expect(result.current.sortAsc).toBe(false);
    expect(result.current.balancesPage).toBe(2);
    expect(result.current.page).toBe(4);
  });

  it('selects and clears active Zonal Office', () => {
    const { result } = renderHook(
      () => useZonalBalancesUrlState(),
      { wrapper: createWrapper('/zonal-balances') }
    );
    expect(result.current.selectedZo).toBe('');

    act(() => {
      result.current.selectZo('+919876543210');
    });
    expect(result.current.selectedZo).toBe('+919876543210');

    act(() => {
      result.current.clearZo();
    });
    expect(result.current.selectedZo).toBe('');
  });

  it('toggles column sorting direction and key', () => {
    const { result } = renderHook(
      () => useZonalBalancesUrlState(),
      { wrapper: createWrapper('/zonal-balances') }
    );
    expect(result.current.sortKey).toBe('name');
    expect(result.current.sortAsc).toBe(true);

    // Toggle same key -> desc
    act(() => {
      result.current.toggleSort('name');
    });
    expect(result.current.sortKey).toBe('name');
    expect(result.current.sortAsc).toBe(false);

    // Toggle different key -> balance (desc by default for metrics)
    act(() => {
      result.current.toggleSort('balance');
    });
    expect(result.current.sortKey).toBe('balance');
    expect(result.current.sortAsc).toBe(false);

    // Toggle balance again -> asc
    act(() => {
      result.current.toggleSort('balance');
    });
    expect(result.current.sortKey).toBe('balance');
    expect(result.current.sortAsc).toBe(true);
  });

  it('updates pagination pages and resets filters', () => {
    const { result } = renderHook(
      () => useZonalBalancesUrlState(),
      { wrapper: createWrapper('/zonal-balances') }
    );

    act(() => {
      result.current.setBalancesPage(3);
    });
    expect(result.current.balancesPage).toBe(3);

    act(() => {
      result.current.setPage(5);
    });
    expect(result.current.page).toBe(5);

    act(() => {
      result.current.resetFilters();
    });
    expect(result.current.selectedZo).toBe('');
    expect(result.current.searchQuery).toBe('');
    expect(result.current.sortKey).toBe('name');
    expect(result.current.sortAsc).toBe(true);
    expect(result.current.balancesPage).toBe(1);
    expect(result.current.page).toBe(1);
  });
});
