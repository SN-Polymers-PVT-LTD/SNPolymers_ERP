import { useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Lightweight URL state hook for User Profile, Appearance, and Leave Requests.
 * Supports '?tab=profile' (default), '?tab=appearance', '?tab=leave', and '?tab=all'.
 */
export function useProfileUrlState() {
  const [searchParams, setSearchParams] = useSearchParams();

  const tab = useMemo(() => {
    const rawTab = (searchParams.get('tab') || '').toLowerCase().trim();
    if (rawTab === 'appearance' || rawTab === 'settings') {
      return 'appearance';
    }
    if (rawTab === 'leave' || rawTab === 'leaves') {
      return 'leave';
    }
    if (rawTab === 'all') {
      return 'all';
    }
    return 'profile';
  }, [searchParams]);

  const setTab = useCallback((nextTab, options = {}) => {
    const { replace = false } = options;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const normalized = (nextTab || '').toLowerCase().trim();

      if (!normalized || normalized === 'profile') {
        next.delete('tab');
      } else if (normalized === 'appearance' || normalized === 'settings') {
        next.set('tab', 'appearance');
      } else if (normalized === 'leave' || normalized === 'leaves') {
        next.set('tab', 'leave');
      } else if (normalized === 'all') {
        next.set('tab', 'all');
      } else {
        next.set('tab', normalized);
      }
      return next;
    }, { replace });
  }, [setSearchParams]);

  return {
    tab,
    setTab,
    isProfileTab: tab === 'profile',
    isAppearanceTab: tab === 'appearance',
    isLeaveTab: tab === 'leave',
    isAllTab: tab === 'all',
  };
}

export default useProfileUrlState;
