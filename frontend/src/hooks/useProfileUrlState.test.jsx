import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useProfileUrlState } from './useProfileUrlState';

const wrapperWithInitialEntry = (initialEntry = '/profile') => {
  return ({ children }) => (
    <MemoryRouter initialEntries={[initialEntry]}>
      {children}
    </MemoryRouter>
  );
};

describe('useProfileUrlState hook', () => {
  it('parses default state from clean URL', () => {
    const { result } = renderHook(() => useProfileUrlState(), {
      wrapper: wrapperWithInitialEntry('/profile')
    });

    expect(result.current.tab).toBe('profile');
    expect(result.current.isProfileTab).toBe(true);
    expect(result.current.isAppearanceTab).toBe(false);
    expect(result.current.isAllTab).toBe(false);
  });

  it('parses deep-linked tab=appearance', () => {
    const { result } = renderHook(() => useProfileUrlState(), {
      wrapper: wrapperWithInitialEntry('/profile?tab=appearance')
    });

    expect(result.current.tab).toBe('appearance');
    expect(result.current.isProfileTab).toBe(false);
    expect(result.current.isAppearanceTab).toBe(true);
    expect(result.current.isAllTab).toBe(false);
  });

  it('parses settings alias tab=settings into appearance', () => {
    const { result } = renderHook(() => useProfileUrlState(), {
      wrapper: wrapperWithInitialEntry('/profile?tab=settings')
    });

    expect(result.current.tab).toBe('appearance');
    expect(result.current.isAppearanceTab).toBe(true);
  });

  it('parses tab=all', () => {
    const { result } = renderHook(() => useProfileUrlState(), {
      wrapper: wrapperWithInitialEntry('/profile?tab=all')
    });

    expect(result.current.tab).toBe('all');
    expect(result.current.isAllTab).toBe(true);
  });

  it('switches tab to appearance and updates URL', () => {
    const { result } = renderHook(() => {
      const state = useProfileUrlState();
      const location = useLocation();
      return { ...state, location };
    }, {
      wrapper: wrapperWithInitialEntry('/profile')
    });

    act(() => {
      result.current.setTab('appearance');
    });

    expect(result.current.tab).toBe('appearance');
    expect(result.current.isAppearanceTab).toBe(true);
    expect(result.current.location.search).toBe('?tab=appearance');
  });

  it('switches tab back to profile and cleans URL', () => {
    const { result } = renderHook(() => {
      const state = useProfileUrlState();
      const location = useLocation();
      return { ...state, location };
    }, {
      wrapper: wrapperWithInitialEntry('/profile?tab=appearance')
    });

    act(() => {
      result.current.setTab('profile');
    });

    expect(result.current.tab).toBe('profile');
    expect(result.current.isProfileTab).toBe(true);
    expect(result.current.location.search).toBe('');
  });

  it('preserves existing query parameters when changing tab', () => {
    const { result } = renderHook(() => {
      const state = useProfileUrlState();
      const location = useLocation();
      return { ...state, location };
    }, {
      wrapper: wrapperWithInitialEntry('/profile?ref=sidebar')
    });

    act(() => {
      result.current.setTab('appearance');
    });

    expect(result.current.location.search).toContain('ref=sidebar');
    expect(result.current.location.search).toContain('tab=appearance');
  });
});
