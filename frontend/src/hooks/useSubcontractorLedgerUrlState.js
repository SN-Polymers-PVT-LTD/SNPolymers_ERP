import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

const VALID_TABS = ['contractors', 'requisitions'];
const VALID_DATE_BASES = ['created', 'approved', 'paid'];

/**
 * useSubcontractorLedgerUrlState
 *
 * Bi-directionally synchronizes Subcontractor Ledger view state with URL search parameters:
 * - tab: active view mode ('contractors' | 'requisitions')
 * - wo: work order filter ('WB_APD_101')
 * - q: contractor / work type search query
 * - page: pagination page number
 * - basis: date basis ('created' | 'approved' | 'paid')
 * - from: date from (YYYY-MM-DD)
 * - to: date to (YYYY-MM-DD)
 * - modal: active modal ('entries' | 'adjust')
 * - modal target fields: subcontractor_id, work_order_no, etc.
 */
export function useSubcontractorLedgerUrlState({ defaultTab = 'contractors' } = {}) {
  const [searchParams, setSearchParams] = useSearchParams();

  // 1. View Mode (Tabs)
  const urlTab = searchParams.get('tab');
  const viewMode = VALID_TABS.includes(urlTab) ? urlTab : defaultTab;

  const setViewMode = useCallback((newTab) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newTab && VALID_TABS.includes(newTab)) {
        next.set('tab', newTab);
      } else {
        next.delete('tab');
      }
      next.delete('page');
      return next;
    });
  }, [setSearchParams]);

  // 2. Work Order Filter (live input + debounced URL sync)
  const urlWo = searchParams.get('wo') || '';
  const [workOrderFilter, setLocalWorkOrder] = useState(urlWo);

  useEffect(() => {
    setLocalWorkOrder(urlWo);
  }, [urlWo]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        const trimmed = workOrderFilter.trim();
        const currentInUrl = next.get('wo') || '';
        if (trimmed === currentInUrl) return prev;

        if (trimmed) {
          next.set('wo', trimmed);
        } else {
          next.delete('wo');
        }
        next.delete('page');
        return next;
      }, { replace: true });
    }, 300);

    return () => clearTimeout(timer);
  }, [workOrderFilter, setSearchParams]);

  // 3. Search Query (live input + debounced URL sync)
  const urlQ = searchParams.get('q') || searchParams.get('search') || '';
  const [searchInput, setLocalSearch] = useState(urlQ);

  useEffect(() => {
    setLocalSearch(urlQ);
  }, [urlQ]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        const trimmed = searchInput.trim();
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
    }, 300);

    return () => clearTimeout(timer);
  }, [searchInput, setSearchParams]);

  const debouncedSearch = urlQ;

  // 4. Pagination
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

  // 5. Date Filters
  const urlBasis = searchParams.get('basis');
  const dateBasis = VALID_DATE_BASES.includes(urlBasis) ? urlBasis : 'created';
  const dateFrom = searchParams.get('from') || '';
  const dateTo = searchParams.get('to') || '';

  const setDateBasis = useCallback((newBasis) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newBasis && newBasis !== 'created' && VALID_DATE_BASES.includes(newBasis)) {
        next.set('basis', newBasis);
      } else {
        next.delete('basis');
      }
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setDateFrom = useCallback((newFrom) => {
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

  const setDateTo = useCallback((newTo) => {
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

  // 6. Reset Filters
  const resetFilters = useCallback(() => {
    setLocalWorkOrder('');
    setLocalSearch('');
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('wo');
      next.delete('q');
      next.delete('search');
      next.delete('basis');
      next.delete('from');
      next.delete('to');
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // 7. Modals: Entries Statement Modal & Balance Adjustment Modal
  const modalParam = searchParams.get('modal'); // 'entries' | 'adjust'
  const subId = searchParams.get('subcontractor_id') || '';
  const subName = searchParams.get('subcontractor_name') || '';
  const modalWo = searchParams.get('modal_wo') || searchParams.get('work_order_no') || '';
  const workId = searchParams.get('subcontract_work_id') || '';
  const subHead = searchParams.get('material_sub_head') || '';
  const details = searchParams.get('material_details') || '';

  const viewingEntry = useMemo(() => {
    if (modalParam !== 'entries' || (!subId && !modalWo)) return null;
    return {
      subcontractor_id: subId,
      subcontractor_name: subName,
      work_order_no: modalWo,
      subcontract_work_id: workId,
      material_sub_head: subHead,
      material_details: details
    };
  }, [modalParam, subId, subName, modalWo, workId, subHead, details]);

  const adjustingEntry = useMemo(() => {
    if (modalParam !== 'adjust' || (!subId && !modalWo)) return null;
    return {
      subcontractor_id: subId,
      subcontractor_name: subName,
      work_order_no: modalWo,
      subcontract_work_id: workId,
      material_sub_head: subHead,
      material_details: details
    };
  }, [modalParam, subId, subName, modalWo, workId, subHead, details]);

  const setViewingEntry = useCallback((entry) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (entry) {
        next.set('modal', 'entries');
        if (entry.subcontractor_id) next.set('subcontractor_id', entry.subcontractor_id);
        if (entry.subcontractor_name) next.set('subcontractor_name', entry.subcontractor_name);
        if (entry.work_order_no) next.set('modal_wo', entry.work_order_no);
        if (entry.subcontract_work_id) next.set('subcontract_work_id', entry.subcontract_work_id);
        if (entry.material_sub_head) next.set('material_sub_head', entry.material_sub_head);
        if (entry.material_details) next.set('material_details', entry.material_details);
      } else {
        next.delete('modal');
        next.delete('subcontractor_id');
        next.delete('subcontractor_name');
        next.delete('modal_wo');
        next.delete('work_order_no');
        next.delete('subcontract_work_id');
        next.delete('material_sub_head');
        next.delete('material_details');
      }
      return next;
    });
  }, [setSearchParams]);

  const setAdjustingEntry = useCallback((entry) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (entry) {
        next.set('modal', 'adjust');
        if (entry.subcontractor_id) next.set('subcontractor_id', entry.subcontractor_id);
        if (entry.subcontractor_name) next.set('subcontractor_name', entry.subcontractor_name);
        if (entry.work_order_no) next.set('modal_wo', entry.work_order_no);
        if (entry.subcontract_work_id) next.set('subcontract_work_id', entry.subcontract_work_id);
        if (entry.material_sub_head) next.set('material_sub_head', entry.material_sub_head);
        if (entry.material_details) next.set('material_details', entry.material_details);
      } else {
        next.delete('modal');
        next.delete('subcontractor_id');
        next.delete('subcontractor_name');
        next.delete('modal_wo');
        next.delete('work_order_no');
        next.delete('subcontract_work_id');
        next.delete('material_sub_head');
        next.delete('material_details');
      }
      return next;
    });
  }, [setSearchParams]);

  const closeModal = useCallback(() => {
    setViewingEntry(null);
  }, [setViewingEntry]);

  return {
    viewMode,
    setViewMode,
    workOrderFilter,
    setWorkOrderFilter: setLocalWorkOrder,
    searchInput,
    setSearchInput: setLocalSearch,
    debouncedSearch,
    page,
    setPage,
    dateBasis,
    setDateBasis,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    resetFilters,
    viewingEntry,
    setViewingEntry,
    adjustingEntry,
    setAdjustingEntry,
    closeModal
  };
}
