import { useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

const VALID_TIMEFRAMES = ['weekly', 'monthly', 'annually', 'lifetime'];
const VALID_PAGE_SIZES = [5, 10, 20];

export const useJeLeaderboardUrlState = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const debounceTimerRef = useRef(null);

  // 1. Timeframe
  const timeframe = useMemo(() => {
    const raw = searchParams.get('timeframe');
    if (raw && VALID_TIMEFRAMES.includes(raw.toLowerCase())) {
      return raw.toLowerCase();
    }
    return 'weekly';
  }, [searchParams]);

  // 2. Search Query
  const searchQuery = useMemo(() => {
    return searchParams.get('q') || searchParams.get('search') || '';
  }, [searchParams]);

  // 3. Pagination Page
  const page = useMemo(() => {
    const p = parseInt(searchParams.get('page'), 10);
    return isNaN(p) || p < 1 ? 1 : p;
  }, [searchParams]);

  // 4. Page Size
  const pageSize = useMemo(() => {
    const raw = searchParams.get('page_size') || searchParams.get('limit');
    const s = parseInt(raw, 10);
    if (!isNaN(s) && VALID_PAGE_SIZES.includes(s)) {
      return s;
    }
    return 5;
  }, [searchParams]);

  // --- Updaters ---

  const setTimeframe = useCallback((newTf) => {
    const target = VALID_TIMEFRAMES.includes(newTf) ? newTf : 'weekly';
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (target === 'weekly') {
        next.delete('timeframe');
      } else {
        next.set('timeframe', target);
      }
      next.delete('page'); // Reset to page 1
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setSearchQuery = useCallback((newQuery) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (newQuery && newQuery.trim()) {
          next.set('q', newQuery.trim());
          next.delete('search');
        } else {
          next.delete('q');
          next.delete('search');
        }
        next.delete('page'); // Reset to page 1
        return next;
      }, { replace: true });
    }, 300);
  }, [setSearchParams]);

  const setPage = useCallback((updater) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const current = parseInt(next.get('page'), 10) || 1;
      const target = typeof updater === 'function' ? updater(current) : updater;
      if (target > 1) {
        next.set('page', String(target));
      } else {
        next.delete('page');
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setPageSize = useCallback((newSize) => {
    const s = Number(newSize);
    const target = VALID_PAGE_SIZES.includes(s) ? s : 5;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (target === 5) {
        next.delete('page_size');
        next.delete('limit');
      } else {
        next.set('page_size', String(target));
        next.delete('limit');
      }
      next.delete('page'); // Reset to page 1
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const resetFilters = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('timeframe');
      next.delete('q');
      next.delete('search');
      next.delete('page');
      next.delete('page_size');
      next.delete('limit');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  return {
    timeframe,
    setTimeframe,
    searchQuery,
    setSearchQuery,
    page,
    setPage,
    pageSize,
    setPageSize,
    resetFilters
  };
};

export default useJeLeaderboardUrlState;
