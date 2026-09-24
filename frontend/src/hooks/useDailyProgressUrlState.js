import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

/**
 * useDailyProgressUrlState
 *
 * Bi-directionally synchronizes Daily Work Progress dashboard, directory, and sheet states with URL search parameters:
 * - tab: 'dashboard' (default) | 'directory'
 * - wo: active work order number (drill-down into sheet)
 * - search_wo: directory filter by work order
 * - dept: directory filter by department
 * - zone: directory filter by zone
 * - page: directory pagination page
 * - feed_page: dashboard activity feed page
 * - modal: 'create' | 'break_request'
 */
export function useDailyProgressUrlState() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // 1. Tab control ('dashboard' | 'directory')
  const urlTab = searchParams.get('tab');
  const currentTab = urlTab === 'directory' ? 'directory' : 'dashboard';

  const setCurrentTab = useCallback((newTab) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newTab === 'directory') {
        next.set('tab', 'directory');
      } else {
        next.delete('tab');
      }
      return next;
    });
  }, [setSearchParams]);

  // 2. Active Work Order (drill-down)
  const activeWONo = searchParams.get('wo') || '';

  const selectWO = useCallback((woNo) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (woNo) {
        next.set('wo', woNo);
      } else {
        next.delete('wo');
      }
      next.delete('modal');
      next.delete('report_id');
      return next;
    });
  }, [setSearchParams]);

  const clearWO = useCallback(() => {
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1);
    } else {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('wo');
        next.delete('modal');
        next.delete('report_id');
        return next;
      }, { replace: true });
    }
  }, [navigate, setSearchParams]);

  // 3. Directory Search Filters (debounced)
  const urlSearchWO = searchParams.get('search_wo') || searchParams.get('q') || '';
  const [searchWO, setSearchWO] = useState(urlSearchWO);

  const urlSearchDept = searchParams.get('dept') || '';
  const [searchDept, setSearchDept] = useState(urlSearchDept);

  const urlSearchZone = searchParams.get('zone') || '';
  const [searchZone, setSearchZone] = useState(urlSearchZone);

  useEffect(() => { setSearchWO(urlSearchWO); }, [urlSearchWO]);
  useEffect(() => { setSearchDept(urlSearchDept); }, [urlSearchDept]);
  useEffect(() => { setSearchZone(urlSearchZone); }, [urlSearchZone]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        let changed = false;

        const trimmedWO = searchWO.trim();
        const currentWO = next.get('search_wo') || next.get('q') || '';
        if (trimmedWO !== currentWO) {
          if (trimmedWO) next.set('search_wo', trimmedWO);
          else next.delete('search_wo');
          next.delete('q');
          changed = true;
        }

        const trimmedDept = searchDept.trim();
        const currentDept = next.get('dept') || '';
        if (trimmedDept !== currentDept) {
          if (trimmedDept) next.set('dept', trimmedDept);
          else next.delete('dept');
          changed = true;
        }

        const trimmedZone = searchZone.trim();
        const currentZone = next.get('zone') || '';
        if (trimmedZone !== currentZone) {
          if (trimmedZone) next.set('zone', trimmedZone);
          else next.delete('zone');
          changed = true;
        }

        if (changed) {
          next.delete('page');
        }

        return changed ? next : prev;
      }, { replace: true });
    }, 300);

    return () => clearTimeout(timer);
  }, [searchWO, searchDept, searchZone, setSearchParams]);

  // 4. Directory Pagination (page)
  const pageParam = parseInt(searchParams.get('page'), 10);
  const dirPage = !isNaN(pageParam) && pageParam > 0 ? pageParam : 1;

  const setDirPage = useCallback((newPage) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const val = typeof newPage === 'function' ? newPage(dirPage) : newPage;
      if (val > 1) {
        next.set('page', String(val));
      } else {
        next.delete('page');
      }
      return next;
    }, { replace: true });
  }, [dirPage, setSearchParams]);

  // 5. Dashboard Feed Pagination (feed_page)
  const feedPageParam = parseInt(searchParams.get('feed_page'), 10);
  const pageFeed = !isNaN(feedPageParam) && feedPageParam > 0 ? feedPageParam : 1;

  const setPageFeed = useCallback((newPage) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const val = typeof newPage === 'function' ? newPage(pageFeed) : newPage;
      if (val > 1) {
        next.set('feed_page', String(val));
      } else {
        next.delete('feed_page');
      }
      return next;
    }, { replace: true });
  }, [pageFeed, setSearchParams]);

  // 6. Modal States
  const modalParam = searchParams.get('modal');
  const showCreateFlow = modalParam === 'create';
  const showBreakRequestFlow = modalParam === 'break_request';

  const openCreateFlow = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('modal', 'create');
      return next;
    });
  }, [setSearchParams]);

  const closeCreateFlow = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (next.get('modal') === 'create') {
        next.delete('modal');
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const openBreakRequestFlow = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('modal', 'break_request');
      return next;
    });
  }, [setSearchParams]);

  const closeBreakRequestFlow = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (next.get('modal') === 'break_request') {
        next.delete('modal');
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  return {
    currentTab,
    setCurrentTab,
    activeWONo,
    selectWO,
    clearWO,
    searchWO,
    setSearchWO,
    searchDept,
    setSearchDept,
    searchZone,
    setSearchZone,
    dirPage,
    setDirPage,
    pageFeed,
    setPageFeed,
    showCreateFlow,
    openCreateFlow,
    closeCreateFlow,
    showBreakRequestFlow,
    openBreakRequestFlow,
    closeBreakRequestFlow
  };
}
