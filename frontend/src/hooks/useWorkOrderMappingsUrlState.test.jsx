import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useWorkOrderMappingsUrlState } from './useWorkOrderMappingsUrlState';

function createWrapper(initialUrl = '/work-order-mappings') {
  return function Wrapper({ children }) {
    return (
      <MemoryRouter initialEntries={[initialUrl]}>
        {children}
      </MemoryRouter>
    );
  };
}

describe('useWorkOrderMappingsUrlState hook', () => {
  it('parses default state from clean URL', () => {
    const { result } = renderHook(
      () => useWorkOrderMappingsUrlState(),
      { wrapper: createWrapper('/work-order-mappings') }
    );

    expect(result.current.activeTab).toBe('active');
    expect(result.current.searchQuery).toBe('');
    expect(result.current.pageSize).toBe(10);
    expect(result.current.page).toBe(1);
    expect(result.current.showMapModal).toBe(false);
    expect(result.current.prefillWO).toBe('');
    expect(result.current.prefillJE).toBe('');
    expect(result.current.showDeactivateModal).toBe(false);
    expect(result.current.deactivatingId).toBe(null);
  });

  it('parses deep-linked state from URL parameters', () => {
    const { result } = renderHook(
      () => useWorkOrderMappingsUrlState(),
      {
        wrapper: createWrapper(
          '/work-order-mappings?tab=history&search=WO-101&page_size=20&page=2&modal=map&wo=WO-101&je=%2B919876543210'
        )
      }
    );

    expect(result.current.activeTab).toBe('history');
    expect(result.current.searchQuery).toBe('WO-101');
    expect(result.current.pageSize).toBe(20);
    expect(result.current.page).toBe(2);
    expect(result.current.showMapModal).toBe(true);
    expect(result.current.prefillWO).toBe('WO-101');
    expect(result.current.prefillJE).toBe('+919876543210');
  });

  it('switches between active and history tabs', () => {
    const { result } = renderHook(
      () => useWorkOrderMappingsUrlState(),
      { wrapper: createWrapper('/work-order-mappings') }
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

  it('controls map modal and deactivate modal lifecycle', () => {
    const { result } = renderHook(
      () => useWorkOrderMappingsUrlState(),
      { wrapper: createWrapper('/work-order-mappings') }
    );

    expect(result.current.showMapModal).toBe(false);

    act(() => {
      result.current.openMapModal('WO-505', '+919999999999');
    });
    expect(result.current.showMapModal).toBe(true);
    expect(result.current.prefillWO).toBe('WO-505');
    expect(result.current.prefillJE).toBe('+919999999999');

    act(() => {
      result.current.closeMapModal();
    });
    expect(result.current.showMapModal).toBe(false);
    expect(result.current.prefillWO).toBe('');

    act(() => {
      result.current.openDeactivateModal('deact-uuid-1');
    });
    expect(result.current.showDeactivateModal).toBe(true);
    expect(result.current.deactivatingId).toBe('deact-uuid-1');

    act(() => {
      result.current.closeDeactivateModal();
    });
    expect(result.current.showDeactivateModal).toBe(false);
    expect(result.current.deactivatingId).toBe(null);
  });
});
