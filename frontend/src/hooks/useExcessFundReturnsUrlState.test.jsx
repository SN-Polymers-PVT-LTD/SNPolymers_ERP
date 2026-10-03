import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useExcessFundReturnsUrlState } from './useExcessFundReturnsUrlState';

function createWrapper(initialUrl = '/excess-fund-returns') {
  return function Wrapper({ children }) {
    return (
      <MemoryRouter initialEntries={[initialUrl]}>
        {children}
      </MemoryRouter>
    );
  };
}

describe('useExcessFundReturnsUrlState hook', () => {
  it('parses initial status and search query from URL', () => {
    const { result } = renderHook(
      () => useExcessFundReturnsUrlState(),
      { wrapper: createWrapper('/excess-fund-returns?status=Requested&q=WO-101') }
    );
    expect(result.current.statusFilter).toBe('Requested');
    expect(result.current.searchQuery).toBe('WO-101');
    expect(result.current.showRequestModal).toBe(false);
  });

  it('switches status filter', () => {
    const { result } = renderHook(
      () => useExcessFundReturnsUrlState(),
      { wrapper: createWrapper('/excess-fund-returns') }
    );
    expect(result.current.statusFilter).toBe('all');

    act(() => {
      result.current.setStatusFilter('Completed');
    });
    expect(result.current.statusFilter).toBe('Completed');

    act(() => {
      result.current.setStatusFilter('all');
    });
    expect(result.current.statusFilter).toBe('all');
  });

  it('opens and closes action modals with return ID', () => {
    const { result } = renderHook(
      () => useExcessFundReturnsUrlState(),
      { wrapper: createWrapper('/excess-fund-returns') }
    );

    act(() => {
      result.current.openActionModal('42');
    });
    expect(result.current.showActionModal).toBe(true);
    expect(result.current.activeReturnId).toBe('42');

    act(() => {
      result.current.closeModals();
    });
    expect(result.current.showActionModal).toBe(false);
    expect(result.current.activeReturnId).toBe(null);
  });

  it('opens and closes HO request modal', () => {
    const { result } = renderHook(
      () => useExcessFundReturnsUrlState(),
      { wrapper: createWrapper('/excess-fund-returns') }
    );

    act(() => {
      result.current.openRequestModal();
    });
    expect(result.current.showRequestModal).toBe(true);

    act(() => {
      result.current.closeModals();
    });
    expect(result.current.showRequestModal).toBe(false);
  });
});
