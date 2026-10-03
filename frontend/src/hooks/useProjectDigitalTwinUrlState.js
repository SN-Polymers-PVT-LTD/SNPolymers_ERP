import { useMemo, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

const VALID_TABS = ['overview', 'financials', 'progress', 'forecast', 'insights', 'logs'];

export const useProjectDigitalTwinUrlState = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // 1. Active Tab
  const activeTab = useMemo(() => {
    const raw = searchParams.get('tab');
    if (raw && VALID_TABS.includes(raw.toLowerCase())) {
      return raw.toLowerCase();
    }
    return 'overview';
  }, [searchParams]);

  // 2. Billing Forecast Entry Modal (?modal=forecast_entry)
  const modal = useMemo(() => {
    return searchParams.get('modal') || '';
  }, [searchParams]);

  const isForecastModalOpen = modal === 'forecast_entry';

  // 3. Selected Photo Modal (?photo=<report_id>)
  const selectedPhotoId = useMemo(() => {
    return searchParams.get('photo') || null;
  }, [searchParams]);

  // --- Updaters ---

  const setActiveTab = useCallback((tab) => {
    const target = VALID_TABS.includes(tab) ? tab : 'overview';
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (target === 'overview') {
        next.delete('tab');
      } else {
        next.set('tab', target);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const openForecastModal = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('modal', 'forecast_entry');
      return next;
    });
  }, [setSearchParams]);

  const closeForecastModal = useCallback(() => {
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

  const openPhotoModal = useCallback((itemOrId) => {
    const id = typeof itemOrId === 'object' && itemOrId !== null
      ? (itemOrId.report_id || itemOrId.id)
      : itemOrId;

    if (!id) return;

    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('photo', String(id));
      return next;
    });
  }, [setSearchParams]);

  const closePhotoModal = useCallback(() => {
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1);
    } else {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('photo');
        return next;
      }, { replace: true });
    }
  }, [navigate, setSearchParams]);

  const resolvePhoto = useCallback((mediaList = [], fallbackPhoto = null) => {
    if (!selectedPhotoId) return null;
    const found = mediaList.find((item) =>
      String(item.report_id) === String(selectedPhotoId) ||
      String(item.id) === String(selectedPhotoId)
    );
    return found || fallbackPhoto;
  }, [selectedPhotoId]);

  return {
    activeTab,
    setActiveTab,
    isForecastModalOpen,
    openForecastModal,
    closeForecastModal,
    selectedPhotoId,
    openPhotoModal,
    closePhotoModal,
    resolvePhoto
  };
};

export default useProjectDigitalTwinUrlState;
