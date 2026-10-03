import { useMemo, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

export const useMaterialMasterUrlState = (options = {}) => {
  const { isAdmin = false } = options;
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const debounceTimerRef = useRef(null);

  // 1. Search Query
  const searchQuery = useMemo(() => {
    return searchParams.get('q') || searchParams.get('search') || '';
  }, [searchParams]);

  // 2. Main Head Filter (Category)
  const mainHeadFilter = useMemo(() => {
    return searchParams.get('main_head') || '';
  }, [searchParams]);

  // 3. Sub Head Filter (Sub-category)
  const subHeadFilter = useMemo(() => {
    return searchParams.get('sub_head') || '';
  }, [searchParams]);

  // 4. Operational Status Filter ('true' | 'false' | '')
  const activeFilter = useMemo(() => {
    const raw = searchParams.get('active');
    if (raw !== null) {
      if (raw === 'all') return '';
      return raw;
    }
    return isAdmin ? 'true' : '';
  }, [searchParams, isAdmin]);

  // 5. Sorting
  const sortBy = useMemo(() => {
    return searchParams.get('sort_by') || 'Material_Details';
  }, [searchParams]);

  const sortOrder = useMemo(() => {
    return searchParams.get('sort_order') === 'desc' ? 'desc' : 'asc';
  }, [searchParams]);

  // 6. Pagination
  const page = useMemo(() => {
    const p = parseInt(searchParams.get('page'), 10);
    return isNaN(p) || p < 1 ? 1 : p;
  }, [searchParams]);

  const limit = useMemo(() => {
    const l = parseInt(searchParams.get('limit'), 10);
    return isNaN(l) || l < 1 ? 10 : l;
  }, [searchParams]);

  // 7. Modals
  const modal = useMemo(() => {
    return searchParams.get('modal') || '';
  }, [searchParams]);

  const materialId = useMemo(() => {
    return searchParams.get('materialId') || '';
  }, [searchParams]);

  const isCreateModalOpen = modal === 'create';
  const isEditModalOpen = modal === 'edit';

  // --- Updaters ---

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
    }, 400);
  }, [setSearchParams]);

  const setMainHeadFilter = useCallback((newHead) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newHead) {
        next.set('main_head', newHead);
      } else {
        next.delete('main_head');
      }
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setSubHeadFilter = useCallback((newSubHead) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newSubHead) {
        next.set('sub_head', newSubHead);
      } else {
        next.delete('sub_head');
      }
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setActiveFilter = useCallback((newActive) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newActive !== undefined && newActive !== null && newActive !== '') {
        next.set('active', newActive);
      } else {
        // If empty string or 'all', explicitly set or delete depending on admin default
        if (isAdmin) {
          next.set('active', 'all');
        } else {
          next.delete('active');
        }
      }
      next.delete('page');
      return next;
    }, { replace: true });
  }, [isAdmin, setSearchParams]);

  const handleSort = useCallback((field) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const currentSortBy = next.get('sort_by') || 'Material_Details';
      const currentSortOrder = next.get('sort_order') === 'desc' ? 'desc' : 'asc';

      if (currentSortBy === field) {
        const newOrder = currentSortOrder === 'asc' ? 'desc' : 'asc';
        next.set('sort_order', newOrder);
      } else {
        next.set('sort_by', field);
        next.set('sort_order', 'asc');
      }
      next.delete('page');
      return next;
    }, { replace: true });
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

  const openCreateModal = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('modal', 'create');
      next.delete('materialId');
      return next;
    });
  }, [setSearchParams]);

  const openEditModal = useCallback((id) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('modal', 'edit');
      if (id !== undefined && id !== null) {
        next.set('materialId', String(id));
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
        next.delete('materialId');
        return next;
      }, { replace: true });
    }
  }, [navigate, setSearchParams]);

  const resetFilters = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('q');
      next.delete('search');
      next.delete('main_head');
      next.delete('sub_head');
      next.delete('active');
      next.delete('sort_by');
      next.delete('sort_order');
      next.delete('page');
      next.delete('limit');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  return {
    searchQuery,
    setSearchQuery,
    mainHeadFilter,
    setMainHeadFilter,
    subHeadFilter,
    setSubHeadFilter,
    activeFilter,
    setActiveFilter,
    sortBy,
    sortOrder,
    handleSort,
    page,
    setPage,
    limit,
    materialId,
    isCreateModalOpen,
    isEditModalOpen,
    openCreateModal,
    openEditModal,
    closeModal,
    resetFilters
  };
};

export default useMaterialMasterUrlState;
