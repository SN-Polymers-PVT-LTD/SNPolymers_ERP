import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

/**
 * useRaFinalBillUrlState
 *
 * Bi-directionally synchronizes RA Bills & Final Bills dashboard, directory,
 * project sheet view, filters, pagination, and modals with URL search parameters:
 * - tab: 'dashboard' (default) | 'directory'
 * - wo / work_order_no: active work order number (drill-down into individual project bill sheet)
 * - search / wo_search: dashboard search filter for work orders (debounced)
 * - type: payment type filter ('', 'RA Bill', 'Final Bill', '__no_ra_bill')
 * - from / to: dashboard date boundary filters
 * - page: dashboard bills feed pagination
 * - dir_wo, dir_dept, dir_zone: directory filters (debounced)
 * - modal: 'create'
 * - create_wo: pre-selected work order for create modal
 * - bill_id: active read-only detail view overlay modal
 */
export function useRaFinalBillUrlState() {
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

  // 2. Active Work Order (drill-down into bill sheet)
  const activeWONo = searchParams.get('wo') || searchParams.get('work_order_no') || '';

  const selectWO = useCallback((woNo) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (woNo) {
        next.set('wo', woNo);
      } else {
        next.delete('wo');
      }
      next.delete('work_order_no');
      next.delete('modal');
      next.delete('bill_id');
      next.delete('bill');
      next.delete('create_wo');
      return next;
    });
  }, [setSearchParams]);

  const clearWO = useCallback(() => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('wo');
        next.delete('work_order_no');
        next.delete('modal');
        next.delete('bill_id');
        next.delete('bill');
        next.delete('create_wo');
        return next;
      }, { replace: true });
    }
  }, [navigate, setSearchParams]);

  // 3. Dashboard Filters
  // Search text (filterWO)
  const urlFilterWO = searchParams.get('search') || searchParams.get('wo_search') || '';
  const [filterWO, setFilterWO] = useState(urlFilterWO);

  useEffect(() => {
    setFilterWO(urlFilterWO);
  }, [urlFilterWO]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        const trimmed = filterWO.trim();
        const current = next.get('search') || next.get('wo_search') || '';
        if (trimmed !== current) {
          if (trimmed) {
            next.set('search', trimmed);
          } else {
            next.delete('search');
          }
          next.delete('wo_search');
          next.delete('page');
          return next;
        }
        return prev;
      }, { replace: true });
    }, 300);

    return () => clearTimeout(timer);
  }, [filterWO, setSearchParams]);

  // Payment Type
  const filterType = searchParams.get('type') || '';
  const setFilterType = useCallback((newType) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newType) {
        next.set('type', newType);
      } else {
        next.delete('type');
      }
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Date From & To
  const filterDateFrom = searchParams.get('from') || '';
  const setFilterDateFrom = useCallback((newFrom) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newFrom) {
        next.set('from', newFrom);
      } else {
        next.delete('from');
      }
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const filterDateTo = searchParams.get('to') || '';
  const setFilterDateTo = useCallback((newTo) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newTo) {
        next.set('to', newTo);
      } else {
        next.delete('to');
      }
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Dashboard pagination
  const pageParam = parseInt(searchParams.get('page'), 10);
  const page = !isNaN(pageParam) && pageParam > 0 ? pageParam : 1;

  const setPage = useCallback((newPage) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const val = typeof newPage === 'function' ? newPage(page) : newPage;
      if (val > 1) {
        next.set('page', String(val));
      } else {
        next.delete('page');
      }
      return next;
    }, { replace: true });
  }, [page, setSearchParams]);

  const resetDashboardFilters = useCallback(() => {
    setFilterWO('');
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('search');
      next.delete('wo_search');
      next.delete('type');
      next.delete('from');
      next.delete('to');
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // 4. Directory Search Filters (debounced)
  const urlDirSearchWO = searchParams.get('dir_wo') || '';
  const [dirSearchWO, setDirSearchWO] = useState(urlDirSearchWO);

  const urlDirSearchDept = searchParams.get('dir_dept') || '';
  const [dirSearchDept, setDirSearchDept] = useState(urlDirSearchDept);

  const urlDirSearchZone = searchParams.get('dir_zone') || '';
  const [dirSearchZone, setDirSearchZone] = useState(urlDirSearchZone);

  useEffect(() => { setDirSearchWO(urlDirSearchWO); }, [urlDirSearchWO]);
  useEffect(() => { setDirSearchDept(urlDirSearchDept); }, [urlDirSearchDept]);
  useEffect(() => { setDirSearchZone(urlDirSearchZone); }, [urlDirSearchZone]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        let changed = false;

        const trimmedWO = dirSearchWO.trim();
        const curWO = next.get('dir_wo') || '';
        if (trimmedWO !== curWO) {
          if (trimmedWO) next.set('dir_wo', trimmedWO);
          else next.delete('dir_wo');
          changed = true;
        }

        const trimmedDept = dirSearchDept.trim();
        const curDept = next.get('dir_dept') || '';
        if (trimmedDept !== curDept) {
          if (trimmedDept) next.set('dir_dept', trimmedDept);
          else next.delete('dir_dept');
          changed = true;
        }

        const trimmedZone = dirSearchZone.trim();
        const curZone = next.get('dir_zone') || '';
        if (trimmedZone !== curZone) {
          if (trimmedZone) next.set('dir_zone', trimmedZone);
          else next.delete('dir_zone');
          changed = true;
        }

        return changed ? next : prev;
      }, { replace: true });
    }, 300);

    return () => clearTimeout(timer);
  }, [dirSearchWO, dirSearchDept, dirSearchZone, setSearchParams]);

  const resetDirectoryFilters = useCallback(() => {
    setDirSearchWO('');
    setDirSearchDept('');
    setDirSearchZone('');
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('dir_wo');
      next.delete('dir_dept');
      next.delete('dir_zone');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // 5. Modals & Overlays
  const modalParam = searchParams.get('modal');
  const showCreatePanel = modalParam === 'create';
  const createWONo = searchParams.get('create_wo') || '';

  const openCreatePanel = useCallback((woNo = null) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('modal', 'create');
      if (woNo) {
        next.set('create_wo', woNo);
      } else {
        next.delete('create_wo');
      }
      return next;
    });
  }, [setSearchParams]);

  const closeCreatePanel = useCallback(() => {
    if (modalParam === 'create' && window.history.length > 1) {
      navigate(-1);
    } else {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('modal');
        next.delete('create_wo');
        return next;
      }, { replace: true });
    }
  }, [modalParam, navigate, setSearchParams]);

  // Detail View Overlay
  const billId = searchParams.get('bill_id') ||
                 searchParams.get('bill') ||
                 (modalParam === 'view' ? searchParams.get('id') : null) || '';

  const openBillDetail = useCallback((id) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('bill_id', String(id));
      return next;
    });
  }, [setSearchParams]);

  const closeBillDetail = useCallback(() => {
    if (billId && window.history.length > 1) {
      navigate(-1);
    } else {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('bill_id');
        next.delete('bill');
        if (next.get('modal') === 'view') {
          next.delete('modal');
          next.delete('id');
        }
        return next;
      }, { replace: true });
    }
  }, [billId, navigate, setSearchParams]);

  return {
    // Tabs
    currentTab,
    setCurrentTab,

    // Active Project
    activeWONo,
    selectWO,
    clearWO,

    // Dashboard Filters
    filterWO,
    setFilterWO,
    filterType,
    setFilterType,
    filterDateFrom,
    setFilterDateFrom,
    filterDateTo,
    setFilterDateTo,
    page,
    setPage,
    resetDashboardFilters,

    // Directory Filters
    dirSearchWO,
    setDirSearchWO,
    dirSearchDept,
    setDirSearchDept,
    dirSearchZone,
    setDirSearchZone,
    resetDirectoryFilters,

    // Create Modal
    showCreatePanel,
    createWONo,
    openCreatePanel,
    closeCreatePanel,

    // Detail Modal
    billId,
    openBillDetail,
    closeBillDetail
  };
}
