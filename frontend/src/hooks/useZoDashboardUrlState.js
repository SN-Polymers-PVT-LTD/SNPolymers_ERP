import { useMemo, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

export const useZoDashboardUrlState = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // 1. Selected ZO Filter
  const selectedZo = useMemo(() => {
    return searchParams.get('zo') || null;
  }, [searchParams]);

  // 2. Project Status Filter ('all', 'Running', 'Closed', 'Complete Under Maintenance')
  const projectStatusFilter = useMemo(() => {
    return searchParams.get('status') || 'all';
  }, [searchParams]);

  // 3. Date Filters
  const datePreset = useMemo(() => {
    return searchParams.get('preset') || 'all';
  }, [searchParams]);

  const startDate = useMemo(() => {
    return searchParams.get('from') || '';
  }, [searchParams]);

  const endDate = useMemo(() => {
    return searchParams.get('to') || '';
  }, [searchParams]);

  // 4. Zoomed Chart Modal
  const zoomedChart = useMemo(() => {
    return searchParams.get('zoom') || null;
  }, [searchParams]);

  // 5. KPI Details Modal
  const kpiModal = useMemo(() => {
    return searchParams.get('kpi') || null;
  }, [searchParams]);

  // --- Updaters ---

  const setSelectedZo = useCallback((zo) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (zo) {
        next.set('zo', zo);
      } else {
        next.delete('zo');
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setProjectStatusFilter = useCallback((status) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (status && status !== 'all') {
        next.set('status', status);
      } else {
        next.delete('status');
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const handleDatePreset = useCallback((preset) => {
    const now = new Date();
    let from = '';
    let to = '';

    if (preset === 'month') {
      from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      to = now.toISOString().slice(0, 10);
    } else if (preset === 'quarter') {
      from = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      to = now.toISOString().slice(0, 10);
    } else if (preset === 'half') {
      from = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      to = now.toISOString().slice(0, 10);
    }

    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (preset && preset !== 'all') {
        next.set('preset', preset);
      } else {
        next.delete('preset');
      }

      if (from) {
        next.set('from', from);
      } else {
        next.delete('from');
      }

      if (to) {
        next.set('to', to);
      } else {
        next.delete('to');
      }

      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setCustomDateRange = useCallback((from, to) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('preset', 'custom');
      if (from) next.set('from', from);
      else next.delete('from');
      if (to) next.set('to', to);
      else next.delete('to');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const openZoom = useCallback((chartKey) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('zoom', chartKey);
      return next;
    });
  }, [setSearchParams]);

  const closeZoom = useCallback(() => {
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1);
    } else {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('zoom');
        return next;
      }, { replace: true });
    }
  }, [navigate, setSearchParams]);

  const openKpiModal = useCallback((kpiKey) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('kpi', kpiKey);
      return next;
    });
  }, [setSearchParams]);

  const closeKpiModal = useCallback(() => {
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1);
    } else {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('kpi');
        return next;
      }, { replace: true });
    }
  }, [navigate, setSearchParams]);

  const resetFilters = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('zo');
      next.delete('status');
      next.delete('preset');
      next.delete('from');
      next.delete('to');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  return {
    selectedZo,
    setSelectedZo,
    projectStatusFilter,
    setProjectStatusFilter,
    datePreset,
    startDate,
    endDate,
    handleDatePreset,
    setCustomDateRange,
    zoomedChart,
    openZoom,
    closeZoom,
    kpiModal,
    openKpiModal,
    closeKpiModal,
    resetFilters
  };
};
