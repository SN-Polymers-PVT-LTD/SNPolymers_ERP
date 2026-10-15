import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import React from 'react';
import { useProjectDigitalTwinUrlState } from './useProjectDigitalTwinUrlState';

const wrapperWithInitialEntries = (initialEntries = ['/projects/WO-101/digital-twin']) => {
  return ({ children }) => (
    <MemoryRouter initialEntries={initialEntries}>
      {children}
    </MemoryRouter>
  );
};

describe('useProjectDigitalTwinUrlState hook', () => {
  it('parses default state from clean URL', () => {
    const { result } = renderHook(() => useProjectDigitalTwinUrlState(), {
      wrapper: wrapperWithInitialEntries(['/projects/WO-101/digital-twin'])
    });

    expect(result.current.activeTab).toBe('overview');
    expect(result.current.isForecastModalOpen).toBe(false);
    expect(result.current.selectedPhotoId).toBe(null);
  });

  it('parses deep link parameters and falls back on invalid tab', () => {
    const { result: validRes } = renderHook(() => useProjectDigitalTwinUrlState(), {
      wrapper: wrapperWithInitialEntries(['/projects/WO-101/digital-twin?tab=forecast&modal=forecast_entry&photo=88'])
    });

    expect(validRes.current.activeTab).toBe('forecast');
    expect(validRes.current.isForecastModalOpen).toBe(true);
    expect(validRes.current.selectedPhotoId).toBe('88');

    const { result: invalidRes } = renderHook(() => useProjectDigitalTwinUrlState(), {
      wrapper: wrapperWithInitialEntries(['/projects/WO-101/digital-twin?tab=nonexistent'])
    });

    expect(invalidRes.current.activeTab).toBe('overview');
  });

  it('switches tabs and updates URL state', () => {
    const { result } = renderHook(() => {
      const urlState = useProjectDigitalTwinUrlState();
      const location = useLocation();
      return { urlState, location };
    }, {
      wrapper: wrapperWithInitialEntries(['/projects/WO-101/digital-twin'])
    });

    act(() => {
      result.current.urlState.setActiveTab('financials');
    });

    expect(result.current.urlState.activeTab).toBe('financials');
    expect(result.current.location.search).toContain('tab=financials');

    act(() => {
      result.current.urlState.setActiveTab('overview');
    });

    expect(result.current.urlState.activeTab).toBe('overview');
    expect(result.current.location.search).not.toContain('tab=');
  });

  it('opens and closes forecast modal with history discipline', () => {
    const { result } = renderHook(() => {
      const urlState = useProjectDigitalTwinUrlState();
      const location = useLocation();
      return { urlState, location };
    }, {
      wrapper: wrapperWithInitialEntries(['/projects/WO-101/digital-twin?tab=forecast'])
    });

    act(() => {
      result.current.urlState.openForecastModal();
    });

    expect(result.current.urlState.isForecastModalOpen).toBe(true);
    expect(result.current.location.search).toContain('modal=forecast_entry');

    act(() => {
      result.current.urlState.closeForecastModal();
    });

    expect(result.current.urlState.isForecastModalOpen).toBe(false);
    expect(result.current.location.search).not.toContain('modal=');
  });

  it('opens and closes photo modal and resolves photo from media list', () => {
    const sampleMedia = [
      { report_id: '42', site_visit_date: '2026-09-15', physical_work_progress: 65 },
      { report_id: '43', site_visit_date: '2026-09-18', physical_work_progress: 70 }
    ];

    const { result } = renderHook(() => {
      const urlState = useProjectDigitalTwinUrlState();
      const location = useLocation();
      return { urlState, location };
    }, {
      wrapper: wrapperWithInitialEntries(['/projects/WO-101/digital-twin'])
    });

    act(() => {
      result.current.urlState.openPhotoModal(sampleMedia[0]);
    });

    expect(result.current.urlState.selectedPhotoId).toBe('42');
    expect(result.current.location.search).toContain('photo=42');

    const resolved = result.current.urlState.resolvePhoto(sampleMedia);
    expect(resolved).toEqual(sampleMedia[0]);

    act(() => {
      result.current.urlState.closePhotoModal();
    });

    expect(result.current.urlState.selectedPhotoId).toBe(null);
    expect(result.current.location.search).not.toContain('photo=');
    expect(result.current.urlState.resolvePhoto(sampleMedia)).toBe(null);
  });
});
