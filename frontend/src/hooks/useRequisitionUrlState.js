import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

const VALID_TABS = ['pending', 'approved', 'hold', 'all', 'directory'];
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * useRequisitionUrlState
 *
 * Bi-directionally synchronizes Requisitions page UI state with URL search parameters:
 * - tab: active tab ('pending' | 'approved' | 'hold' | 'all' | 'directory')
 * - wo: active work order for drilldown ('WB_APD_101')
 * - req: requisition number or UUID
 * - action: modal action ('review' | 'route')
 * - create: boolean flag to open Create Requisition modal
 * - q: live search query (debounced replace to prevent history spam)
 * - page: pagination page number
 */
export function useRequisitionUrlState({ user, requisitions = [], projects = [] } = {}) {
  const [searchParams, setSearchParams] = useSearchParams();

  // 1. Tab Resolution
  const defaultTab = user?.role === 'je' ? 'all' : 'pending';
  const urlTab = searchParams.get('tab');
  const currentTab = VALID_TABS.includes(urlTab) ? urlTab : defaultTab;

  const setTab = useCallback((newTab) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newTab && VALID_TABS.includes(newTab)) {
        next.set('tab', newTab);
      } else {
        next.delete('tab');
      }
      next.delete('page'); // Reset pagination on tab change
      return next;
    });
  }, [setSearchParams]);

  // 2. Search Query with live typing and debounced URL sync
  const urlQ = searchParams.get('q') || searchParams.get('search') || '';
  const [search, setLocalSearch] = useState(urlQ);

  // Sync internal search if URL changes externally (e.g., Back/Forward navigation)
  useEffect(() => {
    setLocalSearch(urlQ);
  }, [urlQ]);

  // Debounced update of 'q' in URL using replace: true
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        const trimmed = search.trim();
        const currentInUrl = next.get('q') || next.get('search') || '';
        if (trimmed === currentInUrl) return prev; // No change

        if (trimmed) {
          next.set('q', trimmed);
          next.delete('search');
        } else {
          next.delete('q');
          next.delete('search');
        }
        next.delete('page'); // Reset pagination when search changes
        return next;
      }, { replace: true });
    }, 250);

    return () => clearTimeout(timer);
  }, [search, setSearchParams]);

  // 3. Pagination State
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

  // 4. Active Work Order (Directory Drilldown)
  const woParam = searchParams.get('wo');
  const activeWO = useMemo(() => {
    if (!woParam) return null;
    const found = projects.find((p) => p.work_order_no === woParam);
    if (found) return found;
    // Fallback stub if projects data is loading or offline
    return { work_order_no: woParam, site_details: '', status: 'Running' };
  }, [woParam, projects]);

  const setActiveWO = useCallback((target) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (!target) {
        next.delete('wo');
      } else {
        const woNo = typeof target === 'string' ? target : target.work_order_no;
        next.set('wo', woNo);
      }
      return next;
    });
  }, [setSearchParams]);

  // 5. Create Requisition Modal Flag
  const createParam = searchParams.get('create');
  const showCreateModal = createParam === 'true' || createParam === '1';

  const setShowCreateModal = useCallback((isOpen) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (isOpen) {
        next.set('create', 'true');
      } else {
        next.delete('create');
      }
      return next;
    });
  }, [setSearchParams]);

  // 6. Requisition Selection & Modals (Detail, Review Action, Route)
  const reqParam = searchParams.get('req');
  const actionParam = searchParams.get('action'); // 'review' | 'route'

  // Resolve target requisition object
  const matchedReq = useMemo(() => {
    if (!reqParam) return null;
    return requisitions.find(
      (r) => r.requisition_no === reqParam || r.requisition_id === reqParam
    ) || null;
  }, [reqParam, requisitions]);

  // Detail Modal ID
  const activeReqId = useMemo(() => {
    if (!reqParam || actionParam) return null;
    if (matchedReq) return matchedReq.requisition_id;
    if (UUID_REGEX.test(reqParam)) return reqParam;
    return null;
  }, [reqParam, actionParam, matchedReq]);

  const setActiveReqId = useCallback((idOrNo) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (idOrNo) {
        next.set('req', idOrNo);
        next.delete('action');
      } else {
        next.delete('req');
        next.delete('action');
      }
      return next;
    });
  }, [setSearchParams]);

  // Action Target (Approver Modal)
  const actionTargetReq = useMemo(() => {
    if (actionParam !== 'review' || !reqParam) return null;
    return matchedReq;
  }, [actionParam, reqParam, matchedReq]);

  const setActionTargetReq = useCallback((req) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (req) {
        next.set('req', req.requisition_no || req.requisition_id);
        next.set('action', 'review');
      } else {
        next.delete('req');
        next.delete('action');
      }
      return next;
    });
  }, [setSearchParams]);

  // Route Target (ZO Balance vs Accounts)
  const routeTargetReq = useMemo(() => {
    if (actionParam !== 'route' || !reqParam) return null;
    return matchedReq;
  }, [actionParam, reqParam, matchedReq]);

  const setRouteTargetReq = useCallback((req) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (req) {
        next.set('req', req.requisition_no || req.requisition_id);
        next.set('action', 'route');
      } else {
        next.delete('req');
        next.delete('action');
      }
      return next;
    });
  }, [setSearchParams]);

  // Helper to close all modals at once
  const closeAllModals = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('req');
      next.delete('action');
      next.delete('create');
      return next;
    });
  }, [setSearchParams]);

  return {
    currentTab,
    setTab,
    search,
    setSearch: setLocalSearch,
    currentPage,
    setCurrentPage,
    activeWO,
    setActiveWO,
    activeReqId,
    setActiveReqId,
    actionTargetReq,
    setActionTargetReq,
    routeTargetReq,
    setRouteTargetReq,
    showCreateModal,
    setShowCreateModal,
    closeAllModals,
  };
}
