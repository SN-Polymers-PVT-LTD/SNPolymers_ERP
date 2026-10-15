import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * useSubcontractEstimatesUrlState
 *
 * Synchronizes Subcontract Estimates filter & queue view state with URL parameters:
 * - status: 'All' | 'Draft' | 'Pending' | etc.
 * - filter: 'All' | 'Draft'
 * - q: search query string (debounced replace)
 * - page: pagination page number
 */
export function useSubcontractEstimatesUrlState() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Remove the retired HO history view parameter from existing bookmarks.
  useEffect(() => {
    if (!searchParams.has('tab')) return;
    const next = new URLSearchParams(searchParams);
    next.delete('tab');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // 2. Draft / All quick filter
  const urlFilter = searchParams.get('filter');
  const selectedFilter = urlFilter === 'Draft' ? 'Draft' : 'All';

  const setSelectedFilter = useCallback((newFilter) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newFilter === 'Draft') {
        next.set('filter', 'Draft');
      } else {
        next.delete('filter');
      }
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // 3. Status Filter
  const statusFilter = searchParams.get('status') || 'All';

  const setStatusFilter = useCallback((newStatus) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newStatus && newStatus !== 'All') {
        next.set('status', newStatus);
      } else {
        next.delete('status');
      }
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // 4. Search query (live input + debounced URL replace)
  const urlQ = searchParams.get('q') || searchParams.get('search') || '';
  const [searchQuery, setLocalSearch] = useState(urlQ);

  useEffect(() => {
    setLocalSearch(urlQ);
  }, [urlQ]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        const trimmed = searchQuery.trim();
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
  }, [searchQuery, setSearchParams]);

  // 5. Pagination
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

  return {
    selectedFilter,
    setSelectedFilter,
    statusFilter,
    setStatusFilter,
    searchQuery,
    setSearchQuery: setLocalSearch,
    page,
    setPage
  };
}
