import { useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * usePayrollPreviewsUrlState
 *
 * Bi-directionally synchronizes Payroll Previews view state with URL parameters:
 * - page: pagination page of draft runs
 * - run: selected run ID
 * - rowPage: pagination page of rows within selected run
 * - modal: 'preview'
 * - rowId: row ID for single employee preview modal
 */
export function usePayrollPreviewsUrlState() {
  const [searchParams, setSearchParams] = useSearchParams();

  // 1. Runs pagination
  const page = useMemo(() => {
    const p = parseInt(searchParams.get('page'), 10);
    return !isNaN(p) && p > 0 ? p : 1;
  }, [searchParams]);

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

  // 2. Selected Run
  const run = searchParams.get('run') || '';

  const setRun = useCallback((newRun) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newRun) {
        next.set('run', newRun);
      } else {
        next.delete('run');
      }
      next.delete('rowPage');
      next.delete('modal');
      next.delete('rowId');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // 3. Row page within selected run
  const rowPage = useMemo(() => {
    const p = parseInt(searchParams.get('rowPage'), 10);
    return !isNaN(p) && p > 0 ? p : 1;
  }, [searchParams]);

  const setRowPage = useCallback((newPage) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const val = typeof newPage === 'function' ? newPage(rowPage) : newPage;
      if (val > 1) {
        next.set('rowPage', String(val));
      } else {
        next.delete('rowPage');
      }
      return next;
    }, { replace: true });
  }, [rowPage, setSearchParams]);

  // 4. Modal / Row preview
  const modal = searchParams.get('modal') || '';
  const rowId = searchParams.get('rowId') || '';

  const openPreview = useCallback((targetRowId) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('modal', 'preview');
      if (targetRowId) next.set('rowId', targetRowId);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const closePreview = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('modal');
      next.delete('rowId');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  return {
    page,
    setPage,
    run,
    setRun,
    rowPage,
    setRowPage,
    rowId,
    isPreviewOpen: modal === 'preview' && !!rowId,
    openPreview,
    closePreview
  };
}

export default usePayrollPreviewsUrlState;
