import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useZoDashboardUrlState } from './useZoDashboardUrlState';

const wrapperWithInitialEntry = (initialEntry = '/analytics/zo') => {
  return ({ children }) => (
    <MemoryRouter initialEntries={[initialEntry]}>
      {children}
    </MemoryRouter>
  );
};

describe('useZoDashboardUrlState hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('parses default state from clean URL', () => {
    const { result } = renderHook(() => useZoDashboardUrlState(), {
      wrapper: wrapperWithInitialEntry('/analytics/zo')
    });

    expect(result.current.selectedZo).toBe(null);
    expect(result.current.projectStatusFilter).toBe('all');
    expect(result.current.datePreset).toBe('all');
    expect(result.current.startDate).toBe('');
    expect(result.current.endDate).toBe('');
    expect(result.current.zoomedChart).toBe(null);
    expect(result.current.kpiModal).toBe(null);
  });

  it('parses deep-linked filters and modals from search params', () => {
    const { result } = renderHook(() => useZoDashboardUrlState(), {
      wrapper: wrapperWithInitialEntry('/analytics/zo?zo=ZO_Kolkata&status=Running&preset=month&from=2026-09-01&to=2026-09-22&zoom=leaderboard&kpi=delayed')
    });

    expect(result.current.selectedZo).toBe('ZO_Kolkata');
    expect(result.current.projectStatusFilter).toBe('Running');
    expect(result.current.datePreset).toBe('month');
    expect(result.current.startDate).toBe('2026-09-01');
    expect(result.current.endDate).toBe('2026-09-22');
    expect(result.current.zoomedChart).toBe('leaderboard');
    expect(result.current.kpiModal).toBe('delayed');
  });

  it('updates ZO and status filters and resets them', () => {
    const { result } = renderHook(() => {
      const state = useZoDashboardUrlState();
      const location = useLocation();
      return { ...state, location };
    }, {
      wrapper: wrapperWithInitialEntry('/analytics/zo')
    });

    act(() => {
      result.current.setSelectedZo('ZO_North');
    });
    expect(result.current.location.search).toBe('?zo=ZO_North');

    act(() => {
      result.current.setProjectStatusFilter('Closed');
    });
    expect(result.current.location.search).toContain('zo=ZO_North');
    expect(result.current.location.search).toContain('status=Closed');

    act(() => {
      result.current.resetFilters();
    });
    expect(result.current.location.search).toBe('');
  });

  it('manages zoom and KPI modals with history navigation', () => {
    const { result } = renderHook(() => {
      const state = useZoDashboardUrlState();
      const location = useLocation();
      return { ...state, location };
    }, {
      wrapper: wrapperWithInitialEntry('/analytics/zo?zo=ZO_Kolkata')
    });

    act(() => {
      result.current.openZoom('bubble');
    });
    expect(result.current.zoomedChart).toBe('bubble');
    expect(result.current.location.search).toContain('zoom=bubble');

    act(() => {
      result.current.closeZoom();
    });
    expect(result.current.zoomedChart).toBe(null);
    expect(result.current.location.search).not.toContain('zoom=bubble');

    act(() => {
      result.current.openKpiModal('at_risk');
    });
    expect(result.current.kpiModal).toBe('at_risk');
    expect(result.current.location.search).toContain('kpi=at_risk');

    act(() => {
      result.current.closeKpiModal();
    });
    expect(result.current.kpiModal).toBe(null);
    expect(result.current.location.search).not.toContain('kpi=at_risk');
  });
});
