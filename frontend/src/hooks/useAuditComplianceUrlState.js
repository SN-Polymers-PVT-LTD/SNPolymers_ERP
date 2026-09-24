import { useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export const useAuditComplianceUrlState = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  // 1. Module Name
  const moduleName = useMemo(() => {
    return searchParams.get('module') || '';
  }, [searchParams]);

  // 2. User ID / Operator
  const userId = useMemo(() => {
    return searchParams.get('user_id') || '';
  }, [searchParams]);

  // 3. Record Identifier
  const recordId = useMemo(() => {
    return searchParams.get('record') || '';
  }, [searchParams]);

  // 4. Pagination
  const page = useMemo(() => {
    const p = parseInt(searchParams.get('page'), 10);
    return isNaN(p) || p < 1 ? 1 : p;
  }, [searchParams]);

  // --- Updaters ---

  const applyFilters = useCallback(({ module_name, user_id, record_identifier }) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (module_name && module_name.trim()) {
        next.set('module', module_name.trim());
      } else {
        next.delete('module');
      }
      if (user_id && user_id.trim()) {
        next.set('user_id', user_id.trim());
      } else {
        next.delete('user_id');
      }
      if (record_identifier && record_identifier.trim()) {
        next.set('record', record_identifier.trim());
      } else {
        next.delete('record');
      }
      next.delete('page');
      return next;
    });
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

  const resetFilters = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('module');
      next.delete('user_id');
      next.delete('record');
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  return {
    moduleName,
    userId,
    recordId,
    page,
    applyFilters,
    setPage,
    resetFilters
  };
};
