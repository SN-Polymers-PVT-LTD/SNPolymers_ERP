import { useMemo, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

/**
 * URL state synchronization hook for Audit Session Logs (/admin/sessions).
 * Handles userId, dateFrom, dateTo, status, search (q), pagination (page, page_size),
 * and session inspect modal (?modal=inspect&sessionId=...).
 */
export function useAuditSessionsUrlState() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const debounceTimerRef = useRef(null);

  // 1. Operator / User ID Filter
  const userId = useMemo(() => {
    return searchParams.get('userId') || searchParams.get('user') || '';
  }, [searchParams]);

  // 2. Date From Filter
  const dateFrom = useMemo(() => {
    return searchParams.get('dateFrom') || searchParams.get('from') || '';
  }, [searchParams]);

  // 3. Date To Filter
  const dateTo = useMemo(() => {
    return searchParams.get('dateTo') || searchParams.get('to') || '';
  }, [searchParams]);

  // 4. Status Filter ('all', 'active', 'expired')
  const status = useMemo(() => {
    const raw = (searchParams.get('status') || '').toLowerCase().trim();
    if (raw === 'active' || raw === 'expired') return raw;
    return 'all';
  }, [searchParams]);

  // 5. Text Search Query ('q')
  const searchQuery = useMemo(() => {
    return searchParams.get('q') || searchParams.get('search') || '';
  }, [searchParams]);

  // 6. Pagination (page & pageSize)
  const page = useMemo(() => {
    const p = parseInt(searchParams.get('page'), 10);
    return isNaN(p) || p < 1 ? 1 : p;
  }, [searchParams]);

  const pageSize = useMemo(() => {
    const s = parseInt(searchParams.get('page_size') || searchParams.get('limit'), 10);
    return isNaN(s) || s < 1 ? 20 : s;
  }, [searchParams]);

  // 7. Inspect Modal
  const modal = useMemo(() => searchParams.get('modal') || '', [searchParams]);
  const selectedSessionId = useMemo(() => searchParams.get('sessionId') || '', [searchParams]);
  const isInspectModalOpen = modal === 'inspect' && !!selectedSessionId;

  // Setters
  const setUserId = useCallback((id, { replace = true } = {}) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set('userId', id);
      else {
        next.delete('userId');
        next.delete('user');
      }
      next.delete('page');
      return next;
    }, { replace });
  }, [setSearchParams]);

  const setDateFrom = useCallback((val, { replace = true } = {}) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (val) next.set('dateFrom', val);
      else {
        next.delete('dateFrom');
        next.delete('from');
      }
      next.delete('page');
      return next;
    }, { replace });
  }, [setSearchParams]);

  const setDateTo = useCallback((val, { replace = true } = {}) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (val) next.set('dateTo', val);
      else {
        next.delete('dateTo');
        next.delete('to');
      }
      next.delete('page');
      return next;
    }, { replace });
  }, [setSearchParams]);

  const setStatus = useCallback((val, { replace = true } = {}) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (val && val !== 'all') next.set('status', val);
      else next.delete('status');
      next.delete('page');
      return next;
    }, { replace });
  }, [setSearchParams]);

  const setSearchQuery = useCallback((query, { debounce = false, replace = true } = {}) => {
    const update = (q) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (q && q.trim()) {
          next.set('q', q.trim());
        } else {
          next.delete('q');
          next.delete('search');
        }
        next.delete('page');
        return next;
      }, { replace });
    };

    if (debounce) {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => update(query), 300);
    } else {
      update(query);
    }
  }, [setSearchParams]);

  const setPage = useCallback((updater, { replace = true } = {}) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const currentPage = parseInt(next.get('page'), 10) || 1;
      const newPage = typeof updater === 'function' ? updater(currentPage) : updater;
      if (newPage <= 1) {
        next.delete('page');
      } else {
        next.set('page', String(newPage));
      }
      return next;
    }, { replace });
  }, [setSearchParams]);

  const setPageSize = useCallback((size, { replace = true } = {}) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const s = parseInt(size, 10);
      if (isNaN(s) || s === 20) {
        next.delete('page_size');
        next.delete('limit');
      } else {
        next.set('page_size', String(s));
      }
      next.delete('page');
      return next;
    }, { replace });
  }, [setSearchParams]);

  const openInspectModal = useCallback((sessionId) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('modal', 'inspect');
      next.set('sessionId', String(sessionId));
      return next;
    }, { replace: false });
  }, [setSearchParams]);

  const closeModal = useCallback(() => {
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1);
    } else {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('modal');
        next.delete('sessionId');
        return next;
      }, { replace: true });
    }
  }, [navigate, setSearchParams]);

  const applyFilters = useCallback((filters = {}, { replace = true } = {}) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (filters.userId) next.set('userId', filters.userId);
      else {
        next.delete('userId');
        next.delete('user');
      }
      if (filters.dateFrom) next.set('dateFrom', filters.dateFrom);
      else {
        next.delete('dateFrom');
        next.delete('from');
      }
      if (filters.dateTo) next.set('dateTo', filters.dateTo);
      else {
        next.delete('dateTo');
        next.delete('to');
      }
      if (filters.status && filters.status !== 'all') next.set('status', filters.status);
      else next.delete('status');
      if (filters.q && filters.q.trim()) next.set('q', filters.q.trim());
      else {
        next.delete('q');
        next.delete('search');
      }
      next.delete('page');
      return next;
    }, { replace });
  }, [setSearchParams]);

  const resetFilters = useCallback(({ replace = true } = {}) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('userId');
      next.delete('user');
      next.delete('dateFrom');
      next.delete('from');
      next.delete('dateTo');
      next.delete('to');
      next.delete('status');
      next.delete('q');
      next.delete('search');
      next.delete('page');
      next.delete('page_size');
      next.delete('limit');
      next.delete('modal');
      next.delete('sessionId');
      return next;
    }, { replace });
  }, [setSearchParams]);

  const hasActiveFilters = Boolean(userId || dateFrom || dateTo || status !== 'all' || searchQuery);

  return {
    userId,
    dateFrom,
    dateTo,
    status,
    searchQuery,
    page,
    pageSize,
    modal,
    selectedSessionId,
    isInspectModalOpen,
    setUserId,
    setDateFrom,
    setDateTo,
    setStatus,
    setSearchQuery,
    setPage,
    setPageSize,
    openInspectModal,
    closeModal,
    applyFilters,
    resetFilters,
    hasActiveFilters,
  };
}

export default useAuditSessionsUrlState;
