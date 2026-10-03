import { useMemo, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

export const useAdminPanelUrlState = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const debounceTimerRef = useRef(null);

  // 1. Search Query
  const searchQuery = useMemo(() => {
    return searchParams.get('q') || searchParams.get('search') || '';
  }, [searchParams]);

  // 2. Role Filter ('all', 'je', 'zo', 'ho', 'accounts', 'admin')
  const roleFilter = useMemo(() => {
    return searchParams.get('role') || 'all';
  }, [searchParams]);

  // 3. Status Filter ('all', 'active', 'deactivated')
  const statusFilter = useMemo(() => {
    return searchParams.get('status') || 'all';
  }, [searchParams]);

  // 4. Telegram Filter ('all', 'connected', 'not_set')
  const telegramFilter = useMemo(() => {
    return searchParams.get('telegram') || 'all';
  }, [searchParams]);

  // 5. Pagination
  const page = useMemo(() => {
    const p = parseInt(searchParams.get('page'), 10);
    return isNaN(p) || p < 1 ? 1 : p;
  }, [searchParams]);

  const pageSize = useMemo(() => {
    const s = parseInt(searchParams.get('page_size'), 10);
    return isNaN(s) || s < 1 ? 10 : s;
  }, [searchParams]);

  // 6. Modal State
  const modal = useMemo(() => {
    return searchParams.get('modal') || '';
  }, [searchParams]);

  const userId = useMemo(() => {
    return searchParams.get('userId') || '';
  }, [searchParams]);

  const showAddModal = modal === 'add';
  const showEditModal = modal === 'edit';

  // --- Updaters ---

  const setSearchQuery = useCallback((newQuery) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        const trimmed = newQuery.trim();
        if (trimmed) {
          next.set('q', trimmed);
        } else {
          next.delete('q');
          next.delete('search');
        }
        next.delete('page');
        return next;
      }, { replace: true });
    }, 300);
  }, [setSearchParams]);

  const setRoleFilter = useCallback((role) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (role && role !== 'all') {
        next.set('role', role);
      } else {
        next.delete('role');
      }
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setStatusFilter = useCallback((status) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (status && status !== 'all') {
        next.set('status', status);
      } else {
        next.delete('status');
      }
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setTelegramFilter = useCallback((tele) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (tele && tele !== 'all') {
        next.set('telegram', tele);
      } else {
        next.delete('telegram');
      }
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setPage = useCallback((newPage) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newPage > 1) {
        next.set('page', String(newPage));
      } else {
        next.delete('page');
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setPageSize = useCallback((newSize) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newSize !== 10) {
        next.set('page_size', String(newSize));
      } else {
        next.delete('page_size');
      }
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const resetFilters = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('q');
      next.delete('search');
      next.delete('role');
      next.delete('status');
      next.delete('telegram');
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const openAddModal = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('modal', 'add');
      next.delete('userId');
      return next;
    });
  }, [setSearchParams]);

  const closeAddModal = useCallback(() => {
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1);
    } else {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('modal');
        next.delete('userId');
        return next;
      }, { replace: true });
    }
  }, [navigate, setSearchParams]);

  const openEditModal = useCallback((id) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('modal', 'edit');
      if (id) {
        next.set('userId', String(id));
      } else {
        next.delete('userId');
      }
      return next;
    });
  }, [setSearchParams]);

  const closeEditModal = useCallback(() => {
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1);
    } else {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('modal');
        next.delete('userId');
        return next;
      }, { replace: true });
    }
  }, [navigate, setSearchParams]);

  return {
    searchQuery,
    setSearchQuery,
    roleFilter,
    setRoleFilter,
    statusFilter,
    setStatusFilter,
    telegramFilter,
    setTelegramFilter,
    page,
    setPage,
    pageSize,
    setPageSize,
    resetFilters,
    showAddModal,
    showEditModal,
    userId,
    openAddModal,
    closeAddModal,
    openEditModal,
    closeEditModal
  };
};
