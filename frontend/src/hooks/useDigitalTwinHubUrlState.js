import { useMemo, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

const VALID_STATUSES = ['Healthy', 'Warning', 'Critical'];

export const useDigitalTwinHubUrlState = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const debounceTimerRef = useRef(null);

  // 1. Search Query (?q= or ?search=)
  const searchTerm = useMemo(() => {
    return searchParams.get('q') || searchParams.get('search') || '';
  }, [searchParams]);

  // 2. Health Status Filter (?status=all|Healthy|Warning|Critical)
  const statusFilter = useMemo(() => {
    const raw = searchParams.get('status') || '';
    if (!raw || raw.toLowerCase() === 'all') return '';
    const match = VALID_STATUSES.find(s => s.toLowerCase() === raw.toLowerCase());
    return match || '';
  }, [searchParams]);

  // 3. Zone Filter (?zone=)
  const zoneFilter = useMemo(() => {
    const z = searchParams.get('zone');
    if (!z || z.toLowerCase() === 'all') return '';
    return z;
  }, [searchParams]);

  // 4. Pagination (?page=)
  const page = useMemo(() => {
    const p = parseInt(searchParams.get('page'), 10);
    return isNaN(p) || p < 1 ? 1 : p;
  }, [searchParams]);

  // 5. Modal State (?modal=pin_limit)
  const modal = useMemo(() => {
    return searchParams.get('modal') || '';
  }, [searchParams]);

  const showPinLimitModal = modal === 'pin_limit';

  // --- Updaters ---

  const setSearchTerm = useCallback((newTerm) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (newTerm && newTerm.trim()) {
          next.set('q', newTerm.trim());
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

  const setStatusFilter = useCallback((newStatus) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newStatus && newStatus !== 'all') {
        next.set('status', newStatus);
      } else {
        next.delete('status');
      }
      next.delete('page'); // Reset to page 1
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setZoneFilter = useCallback((newZone) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newZone && newZone !== 'all') {
        next.set('zone', newZone);
      } else {
        next.delete('zone');
      }
      next.delete('page'); // Reset to page 1
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

  const openPinLimitModal = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('modal', 'pin_limit');
      return next;
    });
  }, [setSearchParams]);

  const closePinLimitModal = useCallback(() => {
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1);
    } else {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('modal');
        return next;
      }, { replace: true });
    }
  }, [navigate, setSearchParams]);

  const resetFilters = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('q');
      next.delete('search');
      next.delete('status');
      next.delete('zone');
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  return {
    searchTerm,
    setSearchTerm,
    statusFilter,
    setStatusFilter,
    zoneFilter,
    setZoneFilter,
    page,
    setPage,
    showPinLimitModal,
    openPinLimitModal,
    closePinLimitModal,
    resetFilters
  };
};

export default useDigitalTwinHubUrlState;
