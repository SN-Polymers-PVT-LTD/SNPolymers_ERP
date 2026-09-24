import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

const VALID_STATUSES = ['all', 'Requested', 'Completed', 'Awaiting HO Review', 'Rejected', 'Cancelled'];

/**
 * useExcessFundReturnsUrlState
 *
 * Bi-directionally synchronizes Excess Fund Returns list filters and modal states with URL search parameters:
 * - status: 'all' | 'Requested' | 'Completed' | 'Awaiting HO Review' | 'Rejected' | 'Cancelled'
 * - q: search query string (debounced replace)
 * - modal: 'request' | 'action' | 'ho_action'
 * - id: return request ID for action modals
 */
export function useExcessFundReturnsUrlState() {
  const [searchParams, setSearchParams] = useSearchParams();

  // 1. Status Filter
  const urlStatus = searchParams.get('status') || 'all';
  const statusFilter = VALID_STATUSES.includes(urlStatus) ? urlStatus : 'all';

  const setStatusFilter = useCallback((newStatus) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newStatus && newStatus !== 'all') {
        next.set('status', newStatus);
      } else {
        next.delete('status');
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // 2. Search Query with live local input & debounced URL sync
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
        return next;
      }, { replace: true });
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, setSearchParams]);

  // 3. Modal States
  const activeModal = searchParams.get('modal') || null;
  const activeReturnId = searchParams.get('id') || null;

  const showRequestModal = activeModal === 'request';
  const showActionModal = activeModal === 'action';
  const showHoActionModal = activeModal === 'ho_action';

  const openRequestModal = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('modal', 'request');
      next.delete('id');
      return next;
    });
  }, [setSearchParams]);

  const openActionModal = useCallback((returnId) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('modal', 'action');
      if (returnId) next.set('id', String(returnId));
      return next;
    });
  }, [setSearchParams]);

  const openHoActionModal = useCallback((returnId) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('modal', 'ho_action');
      if (returnId) next.set('id', String(returnId));
      return next;
    });
  }, [setSearchParams]);

  const closeModals = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('modal');
      next.delete('id');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  return {
    statusFilter,
    setStatusFilter,
    searchQuery,
    setSearchQuery: setLocalSearch,
    activeReturnId,
    showRequestModal,
    showActionModal,
    showHoActionModal,
    openRequestModal,
    openActionModal,
    openHoActionModal,
    closeModals
  };
}
