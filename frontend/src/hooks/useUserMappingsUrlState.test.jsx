import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useUserMappingsUrlState } from './useUserMappingsUrlState';

function createWrapper(initialUrl = '/user-mappings') {
  return function Wrapper({ children }) {
    return (
      <MemoryRouter initialEntries={[initialUrl]}>
        {children}
      </MemoryRouter>
    );
  };
}

describe('useUserMappingsUrlState hook', () => {
  it('parses default state from clean URL', () => {
    const { result } = renderHook(
      () => useUserMappingsUrlState(),
      { wrapper: createWrapper('/user-mappings') }
    );

    expect(result.current.activeTab).toBe('active');
    expect(result.current.searchQuery).toBe('');
    expect(result.current.pageSize).toBe(10);
    expect(result.current.page).toBe(1);
    expect(result.current.showModal).toBe(false);
    expect(result.current.showUnmapModal).toBe(false);
    expect(result.current.unmappingId).toBe(null);
  });

  it('parses deep-linked state from URL parameters', () => {
    const { result } = renderHook(
      () => useUserMappingsUrlState(),
      {
        wrapper: createWrapper(
          '/user-mappings?tab=history&search=Rahul&page_size=20&page=3&modal=unmap&id=map-uuid-99'
        )
      }
    );

    expect(result.current.activeTab).toBe('history');
    expect(result.current.searchQuery).toBe('Rahul');
    expect(result.current.pageSize).toBe(20);
    expect(result.current.page).toBe(3);
    expect(result.current.showModal).toBe(false);
    expect(result.current.showUnmapModal).toBe(true);
    expect(result.current.unmappingId).toBe('map-uuid-99');
  });

  it('switches between active and history tabs', () => {
    const { result } = renderHook(
      () => useUserMappingsUrlState(),
      { wrapper: createWrapper('/user-mappings') }
    );
    expect(result.current.activeTab).toBe('active');

    act(() => {
      result.current.setActiveTab('history');
    });
    expect(result.current.activeTab).toBe('history');

    act(() => {
      result.current.setActiveTab('active');
    });
    expect(result.current.activeTab).toBe('active');
  });

  it('updates page and page size', () => {
    const { result } = renderHook(
      () => useUserMappingsUrlState(),
      { wrapper: createWrapper('/user-mappings') }
    );

    act(() => {
      result.current.setPageSize(50);
    });
    expect(result.current.pageSize).toBe(50);

    act(() => {
      result.current.setPage(4);
    });
    expect(result.current.page).toBe(4);
  });

  it('controls assign modal and unmap modal lifecycle', () => {
    const { result } = renderHook(
      () => useUserMappingsUrlState(),
      { wrapper: createWrapper('/user-mappings') }
    );

    expect(result.current.showModal).toBe(false);

    act(() => {
      result.current.openModal();
    });
    expect(result.current.showModal).toBe(true);

    act(() => {
      result.current.closeModal();
    });
    expect(result.current.showModal).toBe(false);

    act(() => {
      result.current.openUnmapModal('map-123');
    });
    expect(result.current.showUnmapModal).toBe(true);
    expect(result.current.unmappingId).toBe('map-123');

    act(() => {
      result.current.closeUnmapModal();
    });
    expect(result.current.showUnmapModal).toBe(false);
    expect(result.current.unmappingId).toBe(null);
  });
});
