import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import React from 'react';
import { useJeLeaderboardUrlState } from './useJeLeaderboardUrlState';

const wrapperWithInitialEntries = (initialEntries = ['/analytics/leaderboard']) => {
  return ({ children }) => (
    <MemoryRouter initialEntries={initialEntries}>
      {children}
    </MemoryRouter>
  );
};

describe('useJeLeaderboardUrlState hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('parses default state from clean URL', () => {
    const { result } = renderHook(() => useJeLeaderboardUrlState(), {
      wrapper: wrapperWithInitialEntries(['/analytics/leaderboard'])
    });

    expect(result.current.timeframe).toBe('weekly');
    expect(result.current.searchQuery).toBe('');
    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(5);
  });

  it('parses deep link parameters accurately', () => {
    const { result } = renderHook(() => useJeLeaderboardUrlState(), {
      wrapper: wrapperWithInitialEntries(['/analytics/leaderboard?timeframe=monthly&q=Roy&page=3&page_size=10'])
    });

    expect(result.current.timeframe).toBe('monthly');
    expect(result.current.searchQuery).toBe('Roy');
    expect(result.current.page).toBe(3);
    expect(result.current.pageSize).toBe(10);
  });

  it('falls back safely on invalid timeframe and page size', () => {
    const { result } = renderHook(() => useJeLeaderboardUrlState(), {
      wrapper: wrapperWithInitialEntries(['/analytics/leaderboard?timeframe=millennium&page_size=100'])
    });

    expect(result.current.timeframe).toBe('weekly');
    expect(result.current.pageSize).toBe(5);
  });

  it('updates timeframe and resets page to 1', () => {
    const { result } = renderHook(() => {
      const urlState = useJeLeaderboardUrlState();
      const location = useLocation();
      return { urlState, location };
    }, {
      wrapper: wrapperWithInitialEntries(['/analytics/leaderboard?page=4'])
    });

    act(() => {
      result.current.urlState.setTimeframe('lifetime');
    });

    expect(result.current.urlState.timeframe).toBe('lifetime');
    expect(result.current.location.search).toContain('timeframe=lifetime');
    expect(result.current.location.search).not.toContain('page=');
  });

  it('debounces search query updates and resets page to 1', () => {
    const { result } = renderHook(() => {
      const urlState = useJeLeaderboardUrlState();
      const location = useLocation();
      return { urlState, location };
    }, {
      wrapper: wrapperWithInitialEntries(['/analytics/leaderboard?page=3'])
    });

    act(() => {
      result.current.urlState.setSearchQuery('Anand');
    });

    // Before debounce
    expect(result.current.urlState.searchQuery).toBe('');

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.urlState.searchQuery).toBe('Anand');
    expect(result.current.location.search).toContain('q=Anand');
    expect(result.current.location.search).not.toContain('page=');
  });

  it('updates page with direct number and functional updater', () => {
    const { result } = renderHook(() => {
      const urlState = useJeLeaderboardUrlState();
      const location = useLocation();
      return { urlState, location };
    }, {
      wrapper: wrapperWithInitialEntries(['/analytics/leaderboard'])
    });

    act(() => {
      result.current.urlState.setPage(2);
    });
    expect(result.current.urlState.page).toBe(2);
    expect(result.current.location.search).toContain('page=2');

    act(() => {
      result.current.urlState.setPage((prev) => prev + 1);
    });
    expect(result.current.urlState.page).toBe(3);
    expect(result.current.location.search).toContain('page=3');
  });

  it('updates page size and resets page to 1', () => {
    const { result } = renderHook(() => {
      const urlState = useJeLeaderboardUrlState();
      const location = useLocation();
      return { urlState, location };
    }, {
      wrapper: wrapperWithInitialEntries(['/analytics/leaderboard?page=3'])
    });

    act(() => {
      result.current.urlState.setPageSize(20);
    });

    expect(result.current.urlState.pageSize).toBe(20);
    expect(result.current.location.search).toContain('page_size=20');
    expect(result.current.location.search).not.toContain('page=');
  });

  it('resets all filters back to clean URL', () => {
    const { result } = renderHook(() => {
      const urlState = useJeLeaderboardUrlState();
      const location = useLocation();
      return { urlState, location };
    }, {
      wrapper: wrapperWithInitialEntries(['/analytics/leaderboard?timeframe=monthly&q=Kumar&page=2&page_size=10'])
    });

    act(() => {
      result.current.urlState.resetFilters();
    });

    expect(result.current.urlState.timeframe).toBe('weekly');
    expect(result.current.urlState.searchQuery).toBe('');
    expect(result.current.urlState.page).toBe(1);
    expect(result.current.urlState.pageSize).toBe(5);
    expect(result.current.location.search).toBe('');
  });
});
