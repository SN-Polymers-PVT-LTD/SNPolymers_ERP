import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import React from 'react';
import { useDigitalTwinHubUrlState } from './useDigitalTwinHubUrlState';

const wrapperWithInitialEntries = (initialEntries = ['/analytics/digital-twin']) => {
  return ({ children }) => (
    <MemoryRouter initialEntries={initialEntries}>
      {children}
    </MemoryRouter>
  );
};

describe('useDigitalTwinHubUrlState hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('parses default state from clean URL', () => {
    const { result } = renderHook(() => useDigitalTwinHubUrlState(), {
      wrapper: wrapperWithInitialEntries(['/analytics/digital-twin'])
    });

    expect(result.current.searchTerm).toBe('');
    expect(result.current.statusFilter).toBe('');
    expect(result.current.zoneFilter).toBe('');
    expect(result.current.page).toBe(1);
    expect(result.current.showPinLimitModal).toBe(false);
  });

  it('parses deep link parameters accurately', () => {
    const { result } = renderHook(() => useDigitalTwinHubUrlState(), {
      wrapper: wrapperWithInitialEntries(['/analytics/digital-twin?q=metro&status=Warning&zone=South&page=4&modal=pin_limit'])
    });

    expect(result.current.searchTerm).toBe('metro');
    expect(result.current.statusFilter).toBe('Warning');
    expect(result.current.zoneFilter).toBe('South');
    expect(result.current.page).toBe(4);
    expect(result.current.showPinLimitModal).toBe(true);
  });

  it('debounces search term updates and resets page to 1', () => {
    const { result } = renderHook(() => {
      const urlState = useDigitalTwinHubUrlState();
      const location = useLocation();
      return { urlState, location };
    }, {
      wrapper: wrapperWithInitialEntries(['/analytics/digital-twin?page=3'])
    });

    act(() => {
      result.current.urlState.setSearchTerm('pipe');
    });

    // Before timer fires, URL has not changed
    expect(result.current.urlState.searchTerm).toBe('');

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.urlState.searchTerm).toBe('pipe');
    expect(result.current.location.search).toContain('q=pipe');
    expect(result.current.location.search).not.toContain('page=');
  });

  it('updates status and zone filters and resets page', () => {
    const { result } = renderHook(() => {
      const urlState = useDigitalTwinHubUrlState();
      const location = useLocation();
      return { urlState, location };
    }, {
      wrapper: wrapperWithInitialEntries(['/analytics/digital-twin?page=2'])
    });

    act(() => {
      result.current.urlState.setStatusFilter('Critical');
    });

    expect(result.current.urlState.statusFilter).toBe('Critical');
    expect(result.current.location.search).toContain('status=Critical');
    expect(result.current.location.search).not.toContain('page=');

    act(() => {
      result.current.urlState.setZoneFilter('North');
    });

    expect(result.current.urlState.zoneFilter).toBe('North');
    expect(result.current.location.search).toContain('zone=North');
  });

  it('updates page with direct number or functional updater', () => {
    const { result } = renderHook(() => {
      const urlState = useDigitalTwinHubUrlState();
      const location = useLocation();
      return { urlState, location };
    }, {
      wrapper: wrapperWithInitialEntries(['/analytics/digital-twin'])
    });

    act(() => {
      result.current.urlState.setPage(3);
    });
    expect(result.current.urlState.page).toBe(3);
    expect(result.current.location.search).toContain('page=3');

    act(() => {
      result.current.urlState.setPage((prev) => prev + 1);
    });
    expect(result.current.urlState.page).toBe(4);
    expect(result.current.location.search).toContain('page=4');
  });

  it('opens and closes pin limit modal cleanly', () => {
    const { result } = renderHook(() => {
      const urlState = useDigitalTwinHubUrlState();
      const location = useLocation();
      return { urlState, location };
    }, {
      wrapper: wrapperWithInitialEntries(['/analytics/digital-twin'])
    });

    act(() => {
      result.current.urlState.openPinLimitModal();
    });
    expect(result.current.urlState.showPinLimitModal).toBe(true);
    expect(result.current.location.search).toContain('modal=pin_limit');

    act(() => {
      result.current.urlState.closePinLimitModal();
    });
    expect(result.current.urlState.showPinLimitModal).toBe(false);
    expect(result.current.location.search).not.toContain('modal=');
  });

  it('resets all filters back to clean URL', () => {
    const { result } = renderHook(() => {
      const urlState = useDigitalTwinHubUrlState();
      const location = useLocation();
      return { urlState, location };
    }, {
      wrapper: wrapperWithInitialEntries(['/analytics/digital-twin?q=pipeline&status=Healthy&zone=Central&page=2'])
    });

    act(() => {
      result.current.urlState.resetFilters();
    });

    expect(result.current.urlState.searchTerm).toBe('');
    expect(result.current.urlState.statusFilter).toBe('');
    expect(result.current.urlState.zoneFilter).toBe('');
    expect(result.current.urlState.page).toBe(1);
    expect(result.current.location.search).toBe('');
  });
});
