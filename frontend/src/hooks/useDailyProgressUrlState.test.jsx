import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useDailyProgressUrlState } from './useDailyProgressUrlState';

function createWrapper(initialUrl = '/daily-progress') {
  return function Wrapper({ children }) {
    return (
      <MemoryRouter initialEntries={[initialUrl]}>
        {children}
      </MemoryRouter>
    );
  };
}

describe('useDailyProgressUrlState hook', () => {
  it('parses initial tab, wo, directory filters, and pagination from URL', () => {
    const { result } = renderHook(
      () => useDailyProgressUrlState(),
      {
        wrapper: createWrapper(
          '/daily-progress?tab=directory&wo=WO-101&search_wo=APD&dept=Civil&zone=North&page=2&feed_page=3&modal=create'
        )
      }
    );

    expect(result.current.currentTab).toBe('directory');
    expect(result.current.activeWONo).toBe('WO-101');
    expect(result.current.searchWO).toBe('APD');
    expect(result.current.searchDept).toBe('Civil');
    expect(result.current.searchZone).toBe('North');
    expect(result.current.dirPage).toBe(2);
    expect(result.current.pageFeed).toBe(3);
    expect(result.current.showCreateFlow).toBe(true);
  });

  it('switches tabs between dashboard and directory', () => {
    const { result } = renderHook(
      () => useDailyProgressUrlState(),
      { wrapper: createWrapper('/daily-progress') }
    );
    expect(result.current.currentTab).toBe('dashboard');

    act(() => {
      result.current.setCurrentTab('directory');
    });
    expect(result.current.currentTab).toBe('directory');

    act(() => {
      result.current.setCurrentTab('dashboard');
    });
    expect(result.current.currentTab).toBe('dashboard');
  });

  it('selects and clears active work order', () => {
    const { result } = renderHook(
      () => useDailyProgressUrlState(),
      { wrapper: createWrapper('/daily-progress') }
    );
    expect(result.current.activeWONo).toBe('');

    act(() => {
      result.current.selectWO('WO-505');
    });
    expect(result.current.activeWONo).toBe('WO-505');

    act(() => {
      result.current.clearWO();
    });
    expect(result.current.activeWONo).toBe('');
  });

  it('opens and closes create and break request modals', () => {
    const { result } = renderHook(
      () => useDailyProgressUrlState(),
      { wrapper: createWrapper('/daily-progress') }
    );
    expect(result.current.showCreateFlow).toBe(false);
    expect(result.current.showBreakRequestFlow).toBe(false);

    act(() => {
      result.current.openCreateFlow();
    });
    expect(result.current.showCreateFlow).toBe(true);

    act(() => {
      result.current.closeCreateFlow();
    });
    expect(result.current.showCreateFlow).toBe(false);

    act(() => {
      result.current.openBreakRequestFlow();
    });
    expect(result.current.showBreakRequestFlow).toBe(true);

    act(() => {
      result.current.closeBreakRequestFlow();
    });
    expect(result.current.showBreakRequestFlow).toBe(false);
  });
});
