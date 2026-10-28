import { useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * usePayrollReviewUrlState
 *
 * Bi-directionally synchronizes Payroll Review queue, selected sheet,
 * and individual employee review drawer with URL search parameters:
 * - page: pagination page of review queue
 * - status: review status filter for queue
 * - run: selected payroll run/sheet id
 * - row: selected employee row id for detail drawer/review
 */
export function usePayrollReviewUrlState() {
  const [searchParams, setSearchParams] = useSearchParams();

  // 1. Pagination for queue
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

  // 2. Queue status filter
  const status = searchParams.get('status') || '';

  const setStatus = useCallback((newStatus) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newStatus) {
        next.set('status', newStatus);
      } else {
        next.delete('status');
      }
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // 3. Selected run (sheet)
  const runId = searchParams.get('run') || '';

  const setRunId = useCallback((newRunId) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newRunId) {
        next.set('run', newRunId);
      } else {
        next.delete('run');
      }
      next.delete('row');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // 4. Selected employee row for review detail
  const rowId = searchParams.get('row') || '';

  const setRowId = useCallback((newRowId) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newRowId) {
        next.set('row', newRowId);
      } else {
        next.delete('row');
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  return {
    page,
    setPage,
    status,
    setStatus,
    runId,
    setRunId,
    rowId,
    setRowId
  };
}

export default usePayrollReviewUrlState;
