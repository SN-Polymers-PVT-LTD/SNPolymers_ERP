import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export const VALID_FILTER_KEYS = [
  'myRequests',
  'pendingOnly',
  'approvedThisMonth',
  'onHoldRequests',
  'largeAmount',
  'notSentToHo',
  'remainingFundRequest'
];

export const DEFAULT_FILTERS = {
  myRequests: false,
  pendingOnly: false,
  approvedThisMonth: false,
  onHoldRequests: false,
  largeAmount: false,
  notSentToHo: false,
  remainingFundRequest: false
};

/**
 * useFundRequestUrlState
 *
 * Bi-directionally synchronizes Fund Requests dashboard UI state with URL search parameters:
 * - req: fund request number or UUID for detail panel
 * - create: boolean flag to open New Request creation panel
 * - wo: work order number pre-fill for creation flow
 * - filter: comma-separated list of active quick checklist filters
 * - q: live search query (debounced replace)
 * - page: pagination page number
 */
export function useFundRequestUrlState({ requests = [] } = {}) {
  const [searchParams, setSearchParams] = useSearchParams();

  // 1. Search Query with live typing & debounced URL sync
  const urlQ = searchParams.get('q') || searchParams.get('search') || '';
  const [search, setLocalSearch] = useState(urlQ);

  useEffect(() => {
    setLocalSearch(urlQ);
  }, [urlQ]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        const trimmed = search.trim();
        const currentInUrl = next.get('q') || next.get('search') || '';
        if (trimmed === currentInUrl) return prev;

        if (trimmed) {
          next.set('q', trimmed);
          next.delete('search');
        } else {
          next.delete('q');
          next.delete('search');
        }
        next.delete('page');
        return next;
      }, { replace: true });
    }, 250);

    return () => clearTimeout(timer);
  }, [search, setSearchParams]);

  // 2. Pagination State
  const pageParam = parseInt(searchParams.get('page'), 10);
  const currentPage = !isNaN(pageParam) && pageParam > 0 ? pageParam : 1;

  const setCurrentPage = useCallback((newPage) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const val = typeof newPage === 'function' ? newPage(currentPage) : newPage;
      if (val > 1) {
        next.set('page', String(val));
      } else {
        next.delete('page');
      }
      return next;
    }, { replace: true });
  }, [currentPage, setSearchParams]);

  // 3. Quick Checklist Filters
  const filterParam = searchParams.get('filter') || searchParams.get('filters') || '';
  const filters = useMemo(() => {
    const activeKeys = filterParam ? filterParam.split(',').map((s) => s.trim()) : [];
    const state = { ...DEFAULT_FILTERS };
    for (const key of VALID_FILTER_KEYS) {
      if (activeKeys.includes(key)) {
        state[key] = true;
      }
    }
    return state;
  }, [filterParam]);

  const setFilter = useCallback((key, boolValue) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const currentParam = next.get('filter') || next.get('filters') || '';
      const currentActive = currentParam ? currentParam.split(',').map((s) => s.trim()) : [];
      let updatedActive = [...currentActive];

      if (boolValue) {
        if (!updatedActive.includes(key) && VALID_FILTER_KEYS.includes(key)) {
          updatedActive.push(key);
        }
      } else {
        updatedActive = updatedActive.filter((k) => k !== key);
      }

      if (updatedActive.length > 0) {
        next.set('filter', updatedActive.join(','));
      } else {
        next.delete('filter');
      }
      next.delete('filters');
      next.delete('page'); // Reset pagination on filter change
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setFilters = useCallback((updaterOrNew) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const currentParam = next.get('filter') || next.get('filters') || '';
      const currentActive = currentParam ? currentParam.split(',').map((s) => s.trim()) : [];
      const currentMap = { ...DEFAULT_FILTERS };
      for (const k of currentActive) {
        if (VALID_FILTER_KEYS.includes(k)) currentMap[k] = true;
      }

      const newMap = typeof updaterOrNew === 'function' ? updaterOrNew(currentMap) : updaterOrNew;
      const updatedActive = Object.keys(newMap).filter((k) => newMap[k] && VALID_FILTER_KEYS.includes(k));

      if (updatedActive.length > 0) {
        next.set('filter', updatedActive.join(','));
      } else {
        next.delete('filter');
      }
      next.delete('filters');
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // 4. Create Mode & Work Order
  const createParam = searchParams.get('create');
  const showCreateFlow = createParam === 'true' || createParam === '1';
  const createWorkOrder = searchParams.get('wo') || '';

  const setShowCreateFlow = useCallback((isOpen, workOrderNo = '') => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (isOpen) {
        next.set('create', 'true');
        if (workOrderNo) {
          next.set('wo', workOrderNo);
        } else {
          next.delete('wo');
        }
        next.delete('req');
      } else {
        next.delete('create');
        next.delete('wo');
      }
      return next;
    });
  }, [setSearchParams]);

  // 5. Active Request for Detail Panel
  const reqParam = searchParams.get('req');
  const activeRequest = useMemo(() => {
    if (!reqParam || showCreateFlow) return null;
    const found = requests.find(
      (r) => r.fund_request_no === reqParam || r.fund_request_id === reqParam
    );
    if (found) return found;
    // Fallback stub while requests list is loading
    return { fund_request_id: reqParam, fund_request_no: reqParam };
  }, [reqParam, showCreateFlow, requests]);

  const setActiveRequest = useCallback((req) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (req) {
        next.set('req', req.fund_request_no || req.fund_request_id);
        next.delete('create');
        next.delete('wo');
      } else {
        next.delete('req');
      }
      return next;
    });
  }, [setSearchParams]);

  // 6. Close Panel helper
  const closeDetailOrForm = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('req');
      next.delete('create');
      next.delete('wo');
      return next;
    });
  }, [setSearchParams]);

  return {
    search,
    setSearch: setLocalSearch,
    currentPage,
    setCurrentPage,
    filters,
    setFilter,
    setFilters,
    showCreateFlow,
    setShowCreateFlow,
    createWorkOrder,
    activeRequest,
    setActiveRequest,
    closeDetailOrForm
  };
}
