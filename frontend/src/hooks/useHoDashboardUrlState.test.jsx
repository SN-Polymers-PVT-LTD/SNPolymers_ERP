import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useHoDashboardUrlState } from './useHoDashboardUrlState';

const wrapperWithInitialEntry = (initialEntry = '/analytics/ho') => {
  return ({ children }) => (
    <MemoryRouter initialEntries={[initialEntry]}>
      {children}
    </MemoryRouter>
  );
};

describe('useHoDashboardUrlState hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('parses default state from clean URL', () => {
    const { result } = renderHook(() => useHoDashboardUrlState(), {
      wrapper: wrapperWithInitialEntry('/analytics/ho')
    });

    expect(result.current.selectedZone).toBe(null);
    expect(result.current.projectStatusFilter).toBe('all');
    expect(result.current.datePreset).toBe('all');
    expect(result.current.startDate).toBe('');
    expect(result.current.endDate).toBe('');
    expect(result.current.activeView).toBe('all');
    expect(result.current.zoomedChart).toBe(null);
    expect(result.current.kpiModal).toBe(null);
  });

  it('parses deep-linked filters and modals from search params', () => {
    const { result } = renderHook(() => useHoDashboardUrlState(), {
      wrapper: wrapperWithInitialEntry('/analytics/ho?zone=North&status=Running&preset=month&from=2026-09-01&to=2026-09-22&view=zo&zoom=bubble&kpi=at_risk')
    });

    expect(result.current.selectedZone).toBe('North');
    expect(result.current.projectStatusFilter).toBe('Running');
    expect(result.current.datePreset).toBe('month');
    expect(result.current.startDate).toBe('2026-09-01');
    expect(result.current.endDate).toBe('2026-09-22');
    expect(result.current.activeView).toBe('zo');
    expect(result.current.zoomedChart).toBe('bubble');
    expect(result.current.kpiModal).toBe('at_risk');
  });

  it('updates zone and status filters and resets them', () => {
    const { result } = renderHook(() => {
      const state = useHoDashboardUrlState();
      const location = useLocation();
      return { ...state, location };
    }, {
      wrapper: wrapperWithInitialEntry('/analytics/ho')
    });

    act(() => {
      result.current.setSelectedZone('South');
    });
    expect(result.current.location.search).toBe('?zone=South');

    act(() => {
      result.current.setProjectStatusFilter('Closed');
    });
    expect(result.current.location.search).toContain('zone=South');
    expect(result.current.location.search).toContain('status=Closed');

    act(() => {
      result.current.resetFilters();
    });
    expect(result.current.location.search).toBe('');
  });

  it('updates date preset and custom range', () => {
    const { result } = renderHook(() => {
      const state = useHoDashboardUrlState();
      const location = useLocation();
      return { ...state, location };
    }, {
      wrapper: wrapperWithInitialEntry('/analytics/ho')
    });

    act(() => {
      result.current.handleDatePreset('quarter');
    });
    expect(result.current.location.search).toContain('preset=quarter');
    expect(result.current.location.search).toContain('from=');
    expect(result.current.location.search).toContain('to=');

    act(() => {
      result.current.setCustomDateRange('2026-01-01', '2026-06-30');
    });
    expect(result.current.location.search).toContain('preset=custom');
    expect(result.current.location.search).toContain('from=2026-01-01');
    expect(result.current.location.search).toContain('to=2026-06-30');
  });

  it('manages chart zoom and KPI modal state with history navigation', () => {
    const { result } = renderHook(() => {
      const state = useHoDashboardUrlState();
      const location = useLocation();
      return { ...state, location };
    }, {
      wrapper: wrapperWithInitialEntry('/analytics/ho?zone=Central')
    });

    act(() => {
      result.current.openZoom('scurve');
    });
    expect(result.current.zoomedChart).toBe('scurve');
    expect(result.current.location.search).toContain('zoom=scurve');

    act(() => {
      result.current.closeZoom();
    });
    expect(result.current.zoomedChart).toBe(null);
    expect(result.current.location.search).not.toContain('zoom=scurve');

    act(() => {
      result.current.openKpiModal('delayed');
    });
    expect(result.current.kpiModal).toBe('delayed');
    expect(result.current.location.search).toContain('kpi=delayed');

    act(() => {
      result.current.closeKpiModal();
    });
    expect(result.current.kpiModal).toBe(null);
    expect(result.current.location.search).not.toContain('kpi=delayed');
  });
});
