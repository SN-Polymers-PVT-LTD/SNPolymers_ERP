import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

/**
 * useWorkOrderMappingsUrlState
 *
 * Bi-directionally synchronizes Work Order Mappings tabs, search query,
 * pagination, and modal dialogs with URL search parameters:
 * - tab: 'active' (default) | 'history'
 * - search / q: search query for Work Order or JE name/mobile (debounced)
 * - page_size: items per page (default 10)
 * - page: pagination page (default 1)
 * - modal: 'map' | 'deactivate'
 * - id: target mapping ID when in 'deactivate' modal
 * - wo: pre-filled work order number for 'map' modal
 * - je: pre-filled JE mobile number for 'map' modal
 */
export function useWorkOrderMappingsUrlState() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // 1. Tab Control ('active' | 'history')
  const urlTab = searchParams.get('tab');
  const activeTab = urlTab === 'history' ? 'history' : 'active';

  const setActiveTab = useCallback((newTab) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newTab === 'history') {
        next.set('tab', 'history');
      } else {
        next.delete('tab');
      }
      next.delete('page');
      return next;
    });
  }, [setSearchParams]);

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
          next.delete('page');
          return next;
        }
        return prev;
      }, { replace: true });
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, setSearchParams]);

  // 3. Page Size
  const pageSizeParam = parseInt(searchParams.get('page_size'), 10);
  const pageSize = !isNaN(pageSizeParam) && [5, 10, 20, 50].includes(pageSizeParam) ? pageSizeParam : 10;

  const setPageSize = useCallback((newSize) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const val = Number(newSize);
      if (val !== 10) {
        next.set('page_size', String(val));
      } else {
        next.delete('page_size');
      }
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // 4. Page Pagination
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

  // 5. Map Modal
  const modalParam = searchParams.get('modal');
  const showMapModal = modalParam === 'map' || modalParam === 'create';
  const prefillWO = searchParams.get('wo') || '';
  const prefillJE = searchParams.get('je') || '';

  const openMapModal = useCallback((wo = null, je = null) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('modal', 'map');
      if (wo) next.set('wo', wo);
      else next.delete('wo');
      if (je) next.set('je', je);
      else next.delete('je');
      return next;
    });
  }, [setSearchParams]);

  const closeMapModal = useCallback(() => {
    if ((modalParam === 'map' || modalParam === 'create') && window.history.length > 1) {
      navigate(-1);
    } else {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('modal');
        next.delete('wo');
        next.delete('je');
        return next;
      }, { replace: true });
    }
  }, [modalParam, navigate, setSearchParams]);

  // 6. Deactivate Modal
  const showDeactivateModal = modalParam === 'deactivate';
  const deactivatingId = searchParams.get('id') || null;

  const openDeactivateModal = useCallback((id) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('modal', 'deactivate');
      if (id) {
        next.set('id', String(id));
      } else {
        next.delete('id');
      }
      return next;
    });
  }, [setSearchParams]);

  const closeDeactivateModal = useCallback(() => {
    if (modalParam === 'deactivate' && window.history.length > 1) {
      navigate(-1);
    } else {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('modal');
        next.delete('id');
        return next;
      }, { replace: true });
    }
  }, [modalParam, navigate, setSearchParams]);

  const resetFilters = useCallback(() => {
    setSearchQuery('');
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('tab');
      next.delete('search');
      next.delete('q');
      next.delete('page_size');
      next.delete('page');
      next.delete('modal');
      next.delete('wo');
      next.delete('je');
      next.delete('id');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  return {
    activeTab,
    setActiveTab,
    searchQuery,
    setSearchQuery,
    pageSize,
    setPageSize,
    page,
    setPage,
    showMapModal,
    prefillWO,
    prefillJE,
    openMapModal,
    closeMapModal,
    showDeactivateModal,
    deactivatingId,
    openDeactivateModal,
    closeDeactivateModal,
    resetFilters
  };
}
