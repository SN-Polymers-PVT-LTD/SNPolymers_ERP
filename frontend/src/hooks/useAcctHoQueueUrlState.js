import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * useAcctHoQueueUrlState
 *
 * Bi-directionally synchronizes Head Office Requisitions Queue state with URL search parameters:
 * - status: 'Submitted' (default, Pending Review) | 'Reviewed'
 * - q: sheet number search string (debounced replace)
 * - from: date_from (YYYY-MM-DD)
 * - to: date_to (YYYY-MM-DD)
 * - page: pagination page number
 */
export function useAcctHoQueueUrlState() {
  const [searchParams, setSearchParams] = useSearchParams();

  // 1. Status Filter ('Submitted' | 'Reviewed')
  const urlStatus = searchParams.get('status') || searchParams.get('sheet_status') || 'Submitted';
  const statusFilter = urlStatus === 'Reviewed' ? 'Reviewed' : 'Submitted';

  const setStatusFilter = useCallback((newStatus) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newStatus === 'Reviewed') {
        next.set('status', 'Reviewed');
      } else {
        next.delete('status');
      }
      next.delete('sheet_status');
      next.delete('page');
      return next;
    });
  }, [setSearchParams]);

  // 2. Search query with live input & debounced URL sync
  const urlQ = searchParams.get('q') || searchParams.get('sheet_number') || '';
  const [searchQuery, setLocalSearch] = useState(urlQ);

  useEffect(() => {
    setLocalSearch(urlQ);
  }, [urlQ]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        const trimmed = searchQuery.trim();
        const currentInUrl = next.get('q') || next.get('sheet_number') || '';
        if (trimmed === currentInUrl) return prev;

        if (trimmed) {
          next.set('q', trimmed);
          next.delete('sheet_number');
        } else {
          next.delete('q');
          next.delete('sheet_number');
        }
        next.delete('page');
        return next;
      }, { replace: true });
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, setSearchParams]);

  // 3. Date Range (from, to)
  const dateFrom = searchParams.get('from') || searchParams.get('date_from') || '';
  const setDateFrom = useCallback((newFrom) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newFrom) {
        next.set('from', newFrom);
      } else {
        next.delete('from');
      }
      next.delete('date_from');
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const dateTo = searchParams.get('to') || searchParams.get('date_to') || '';
  const setDateTo = useCallback((newTo) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newTo) {
        next.set('to', newTo);
      } else {
        next.delete('to');
      }
      next.delete('date_to');
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setDateRange = useCallback((fromVal, toVal) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (fromVal) next.set('from', fromVal);
      else next.delete('from');
      if (toVal) next.set('to', toVal);
      else next.delete('to');
      next.delete('date_from');
      next.delete('date_to');
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

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

  // 5. Reset filters (preserves active status tab)
  const resetFilters = useCallback(() => {
    setLocalSearch('');
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('q');
      next.delete('sheet_number');
      next.delete('from');
      next.delete('date_from');
      next.delete('to');
      next.delete('date_to');
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  return {
    statusFilter,
    setStatusFilter,
    searchQuery,
    setSearchQuery: setLocalSearch,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    setDateRange,
    page,
    setPage,
    resetFilters
  };
}
