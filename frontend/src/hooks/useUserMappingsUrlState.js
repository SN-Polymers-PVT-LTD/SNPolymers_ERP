import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

/**
 * useUserMappingsUrlState
 *
 * Bi-directionally synchronizes JE-to-ZO User Mappings tabs, search query,
 * pagination, and modal dialogs with URL search parameters:
 * - tab: 'active' (default) | 'history'
 * - search / q: search query for JE/ZO name or mobile (debounced)
 * - page_size: items per page (default 10)
 * - page: pagination page (default 1)
 * - modal: 'assign' | 'unmap'
 * - id: target mapping ID when in 'unmap' modal
 */
export function useUserMappingsUrlState() {
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

  // 5. Modals
  const modalParam = searchParams.get('modal');
  const showModal = modalParam === 'assign' || modalParam === 'create';

  const openModal = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('modal', 'assign');
      return next;
    });
  }, [setSearchParams]);

  const closeModal = useCallback(() => {
    if ((modalParam === 'assign' || modalParam === 'create') && window.history.length > 1) {
      navigate(-1);
    } else {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('modal');
        return next;
      }, { replace: true });
    }
  }, [modalParam, navigate, setSearchParams]);

  // Unmap Modal
  const showUnmapModal = modalParam === 'unmap';
  const unmappingId = searchParams.get('id') || null;

  const openUnmapModal = useCallback((id) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('modal', 'unmap');
      if (id) {
        next.set('id', String(id));
      } else {
        next.delete('id');
      }
      return next;
    });
  }, [setSearchParams]);

  const closeUnmapModal = useCallback(() => {
    if (modalParam === 'unmap' && window.history.length > 1) {
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
    showModal,
    openModal,
    closeModal,
    showUnmapModal,
    unmappingId,
    openUnmapModal,
    closeUnmapModal,
    resetFilters
  };
}
