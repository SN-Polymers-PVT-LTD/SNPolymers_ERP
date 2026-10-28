import { useMemo, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

export const useMasterDataUrlState = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const debounceTimerRef = useRef(null);

  // 1. Tab ('running' | 'archive')
  const activeTab = useMemo(() => {
    const t = searchParams.get('tab');
    return t === 'archive' ? 'archive' : 'running';
  }, [searchParams]);

  // 2. Search Query
  const searchQuery = useMemo(() => {
    return searchParams.get('q') || searchParams.get('search') || '';
  }, [searchParams]);

  // 3. Department Filter
  const departmentFilter = useMemo(() => {
    return searchParams.get('dept') || searchParams.get('department') || 'all';
  }, [searchParams]);

  // 4. Zone Filter
  const zoneFilter = useMemo(() => {
    return searchParams.get('zone') || 'all';
  }, [searchParams]);

  // 5. Status Filter
  const statusFilter = useMemo(() => {
    return searchParams.get('status') || 'all';
  }, [searchParams]);

  // 6. Pagination
  const page = useMemo(() => {
    const p = parseInt(searchParams.get('page'), 10);
    return isNaN(p) || p < 1 ? 1 : p;
  }, [searchParams]);

  const pageSize = useMemo(() => {
    const s = parseInt(searchParams.get('page_size'), 10);
    return isNaN(s) || s < 1 ? 10 : s;
  }, [searchParams]);

  // 7. Modal State
  const modal = useMemo(() => {
    return searchParams.get('modal') || '';
  }, [searchParams]);

  const targetWorkOrder = useMemo(() => {
    return searchParams.get('wo') || searchParams.get('work_order_no') || '';
  }, [searchParams]);

  const showCreateModal = modal === 'create';
  const showEditModal = modal === 'edit';
  const showStatusModal = modal === 'status';

  // --- Updaters ---

  const setActiveTab = useCallback((newTab) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newTab === 'archive') {
        next.set('tab', 'archive');
      } else {
        next.delete('tab');
      }
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

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

  const setDepartmentFilter = useCallback((dept) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (dept && dept !== 'all') {
        next.set('dept', dept);
      } else {
        next.delete('dept');
        next.delete('department');
      }
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setZoneFilter = useCallback((zone) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (zone && zone !== 'all') {
        next.set('zone', zone);
      } else {
        next.delete('zone');
      }
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setStatusFilter = useCallback((st) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (st && st !== 'all') {
        next.set('status', st);
      } else {
        next.delete('status');
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
      next.delete('dept');
      next.delete('department');
      next.delete('zone');
      next.delete('status');
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const openCreateModal = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('modal', 'create');
      next.delete('wo');
      next.delete('work_order_no');
      return next;
    });
  }, [setSearchParams]);

  const openEditModal = useCallback((wo) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('modal', 'edit');
      if (wo) {
        next.set('wo', String(wo));
      } else {
        next.delete('wo');
        next.delete('work_order_no');
      }
      return next;
    });
  }, [setSearchParams]);

  const openStatusModal = useCallback((wo) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('modal', 'status');
      if (wo) {
        next.set('wo', String(wo));
      } else {
        next.delete('wo');
        next.delete('work_order_no');
      }
      return next;
    });
  }, [setSearchParams]);

  const closeModal = useCallback(() => {
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1);
    } else {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('modal');
        next.delete('wo');
        next.delete('work_order_no');
        return next;
      }, { replace: true });
    }
  }, [navigate, setSearchParams]);

  return {
    activeTab,
    setActiveTab,
    searchQuery,
    setSearchQuery,
    departmentFilter,
    setDepartmentFilter,
    zoneFilter,
    setZoneFilter,
    statusFilter,
    setStatusFilter,
    page,
    setPage,
    pageSize,
    setPageSize,
    resetFilters,
    modal,
    targetWorkOrder,
    showCreateModal,
    showEditModal,
    showStatusModal,
    openCreateModal,
    openEditModal,
    openStatusModal,
    closeModal
  };
};
