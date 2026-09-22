import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

/**
 * useZonalBalancesUrlState
 *
 * Bi-directionally synchronizes Zonal Balances overview, directory,
 * sorting, pagination, and transaction ledger logs with URL search parameters:
 * - zo / zo_user_id: active Zonal Office filter
 * - search / q: search query for ZO name/mobile (debounced)
 * - sort: column sorting key ('name' | 'balance' | 'sync')
 * - dir: column sorting direction ('asc' | 'desc')
 * - zo_page: pagination page for Zonal Offices overview table
 * - page: pagination page for Transaction Ledger logs table
 */
export function useZonalBalancesUrlState() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // 1. Zonal Office Filter
  const selectedZo = searchParams.get('zo') || searchParams.get('zo_user_id') || '';

  const selectZo = useCallback((zoId) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (zoId) {
        next.set('zo', zoId);
      } else {
        next.delete('zo');
      }
      next.delete('zo_user_id');
      next.delete('page');
      next.delete('zo_page');
      return next;
    });
  }, [setSearchParams]);

  const clearZo = useCallback(() => {
    if (selectedZo && window.history.length > 1) {
      navigate(-1);
    } else {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('zo');
        next.delete('zo_user_id');
        next.delete('page');
        next.delete('zo_page');
        return next;
      }, { replace: true });
    }
  }, [selectedZo, navigate, setSearchParams]);

  // 2. Search Query (debounced)
  const urlSearch = searchParams.get('search') || searchParams.get('q') || '';
  const [searchQuery, setSearchQuery] = useState(urlSearch);

  useEffect(() => {
    setSearchQuery(urlSearch);
  }, [urlSearch]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        const trimmed = searchQuery.trim();
        const current = next.get('search') || next.get('q') || '';
        if (trimmed !== current) {
          if (trimmed) {
            next.set('search', trimmed);
          } else {
            next.delete('search');
          }
          next.delete('q');
          next.delete('zo_page');
          return next;
        }
        return prev;
      }, { replace: true });
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, setSearchParams]);

  // 3. Sorting
  const sortKey = searchParams.get('sort') || 'name';
  const sortDirParam = searchParams.get('dir');
  const sortAsc = sortDirParam ? sortDirParam === 'asc' : true;

  const toggleSort = useCallback((key) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const currentKey = next.get('sort') || 'name';
      const currentDir = next.get('dir') || 'asc';

      if (currentKey === key) {
        next.set('dir', currentDir === 'asc' ? 'desc' : 'asc');
      } else {
        next.set('sort', key);
        next.set('dir', key === 'name' ? 'asc' : 'desc');
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // 4. Balances Table Pagination (zo_page)
  const zoPageParam = parseInt(searchParams.get('zo_page'), 10);
  const balancesPage = !isNaN(zoPageParam) && zoPageParam > 0 ? zoPageParam : 1;

  const setBalancesPage = useCallback((newPage) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const val = typeof newPage === 'function' ? newPage(balancesPage) : newPage;
      if (val > 1) {
        next.set('zo_page', String(val));
      } else {
        next.delete('zo_page');
      }
      return next;
    }, { replace: true });
  }, [balancesPage, setSearchParams]);

  // 5. Transaction Ledger Logs Pagination (page)
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

  // 6. Reset Filters
  const resetFilters = useCallback(() => {
    setSearchQuery('');
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('zo');
      next.delete('zo_user_id');
      next.delete('search');
      next.delete('q');
      next.delete('sort');
      next.delete('dir');
      next.delete('zo_page');
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  return {
    selectedZo,
    selectZo,
    clearZo,
    searchQuery,
    setSearchQuery,
    sortKey,
    sortAsc,
    toggleSort,
    balancesPage,
    setBalancesPage,
    page,
    setPage,
    resetFilters
  };
}
