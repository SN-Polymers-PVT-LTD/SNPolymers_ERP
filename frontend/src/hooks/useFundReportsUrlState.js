import { useMemo, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

const VALID_TABS = ['active', 'deleted'];
const VALID_PAGE_SIZES = [5, 10, 20, 50];

export const useFundReportsUrlState = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const debounceTimerRef = useRef(null);

  // 1. Tab ('active' | 'deleted')
  const tab = useMemo(() => {
    const raw = searchParams.get('tab');
    if (raw && VALID_TABS.includes(raw.toLowerCase())) {
      return raw.toLowerCase();
    }
    return 'active';
  }, [searchParams]);

  // 2. Search Query
  const searchQuery = useMemo(() => {
    return searchParams.get('q') || searchParams.get('search') || '';
  }, [searchParams]);

  // 3. Pagination Page
  const page = useMemo(() => {
    const p = parseInt(searchParams.get('page'), 10);
    return isNaN(p) || p < 1 ? 1 : p;
  }, [searchParams]);

  // 4. Page Size
  const pageSize = useMemo(() => {
    const s = parseInt(searchParams.get('page_size'), 10);
    if (!isNaN(s) && VALID_PAGE_SIZES.includes(s)) {
      return s;
    }
    return 10;
  }, [searchParams]);

  // 5. Modal State
  const modal = useMemo(() => {
    return searchParams.get('modal') || '';
  }, [searchParams]);

  const reportId = useMemo(() => {
    return searchParams.get('reportId') || '';
  }, [searchParams]);

  const workOrderNo = useMemo(() => {
    return searchParams.get('wo') || '';
  }, [searchParams]);

  const isCreateModalOpen = modal === 'create';
  const isEditModalOpen = modal === 'edit';

  // --- Updaters ---

  const setTab = useCallback((newTab) => {
    const target = VALID_TABS.includes(newTab) ? newTab : 'active';
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (target === 'active') {
        next.delete('tab');
      } else {
        next.set('tab', target);
      }
      next.delete('page'); // Reset to page 1
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
        if (newQuery && newQuery.trim()) {
          next.set('q', newQuery.trim());
          next.delete('search');
        } else {
          next.delete('q');
          next.delete('search');
        }
        next.delete('page'); // Reset to page 1
        return next;
      }, { replace: true });
    }, 300);
  }, [setSearchParams]);

  const setPage = useCallback((updater) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const current = parseInt(next.get('page'), 10) || 1;
      const target = typeof updater === 'function' ? updater(current) : updater;
      if (target > 1) {
        next.set('page', String(target));
      } else {
        next.delete('page');
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setPageSize = useCallback((newSize) => {
    const s = Number(newSize);
    const target = VALID_PAGE_SIZES.includes(s) ? s : 10;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (target === 10) {
        next.delete('page_size');
      } else {
        next.set('page_size', String(target));
      }
      next.delete('page'); // Reset to page 1
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const openCreateModal = useCallback((initialWo) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('modal', 'create');
      next.delete('reportId');
      if (initialWo) {
        next.set('wo', initialWo);
      } else {
        next.delete('wo');
      }
      return next;
    });
  }, [setSearchParams]);

  const openEditModal = useCallback((id) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('modal', 'edit');
      next.delete('wo');
      if (id !== undefined && id !== null) {
        next.set('reportId', String(id));
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
        next.delete('reportId');
        next.delete('wo');
        return next;
      }, { replace: true });
    }
  }, [navigate, setSearchParams]);

  const resetFilters = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('q');
      next.delete('search');
      next.delete('page');
      next.delete('page_size');
      next.delete('wo');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  return {
    tab,
    setTab,
    searchQuery,
    setSearchQuery,
    page,
    setPage,
    pageSize,
    setPageSize,
    workOrderNo,
    reportId,
    isCreateModalOpen,
    isEditModalOpen,
    openCreateModal,
    openEditModal,
    closeModal,
    resetFilters
  };
};

export default useFundReportsUrlState;
