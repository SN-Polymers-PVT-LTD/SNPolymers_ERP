import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { useDocsUrlState } from './useDocsUrlState';

const wrapperWithRoute = (initialEntry = '/docs/what-is-idbp') => {
  return ({ children }) => (
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/docs" element={children} />
        <Route path="/docs/:pageId" element={children} />
      </Routes>
    </MemoryRouter>
  );
};

describe('useDocsUrlState hook', () => {
  it('parses default pageId and empty search query from clean URL', () => {
    const { result } = renderHook(() => useDocsUrlState(), {
      wrapper: wrapperWithRoute('/docs')
    });

    expect(result.current.pageId).toBe('what-is-idbp');
    expect(result.current.searchQuery).toBe('');
  });

  it('parses specific pageId and deep-linked search query from URL', () => {
    const { result } = renderHook(() => useDocsUrlState(), {
      wrapper: wrapperWithRoute('/docs/account-setup?q=telegram')
    });

    expect(result.current.pageId).toBe('account-setup');
    expect(result.current.searchQuery).toBe('telegram');
  });

  it('updates search query immediately when debounce is false', () => {
    const { result } = renderHook(() => {
      const state = useDocsUrlState();
      const location = useLocation();
      return { ...state, location };
    }, {
      wrapper: wrapperWithRoute('/docs/what-is-idbp')
    });

    act(() => {
      result.current.setSearchQuery('estimation', { debounce: false });
    });

    expect(result.current.searchQuery).toBe('estimation');
    expect(result.current.location.search).toBe('?q=estimation');
  });

  it('clears search query and cleans URL', () => {
    const { result } = renderHook(() => {
      const state = useDocsUrlState();
      const location = useLocation();
      return { ...state, location };
    }, {
      wrapper: wrapperWithRoute('/docs/what-is-idbp?q=something')
    });

    expect(result.current.searchQuery).toBe('something');

    act(() => {
      result.current.clearSearch();
    });

    expect(result.current.searchQuery).toBe('');
    expect(result.current.location.search).toBe('');
  });

  it('navigates to another page preserving search query when requested', () => {
    const { result } = renderHook(() => {
      const state = useDocsUrlState();
      const location = useLocation();
      return { ...state, location };
    }, {
      wrapper: wrapperWithRoute('/docs/what-is-idbp?q=telegram')
    });

    act(() => {
      result.current.navigateToPage('account-setup', { preserveSearch: true });
    });

    expect(result.current.location.pathname).toBe('/docs/account-setup');
    expect(result.current.location.search).toBe('?q=telegram');
  });
});
