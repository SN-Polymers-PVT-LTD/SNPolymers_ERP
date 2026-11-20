import { useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

const VALID_MODALS = ['history', 'edit', 'create', 'preview'];

/**
 * usePayrollMastersUrlState
 *
 * Bi-directionally synchronizes Payroll Masters (Policies & Statutory) view state with URL parameters:
 * - page: pagination page number (omitted when 1)
 * - modal: 'history' | 'edit' | 'create' | 'preview'
 * - revisionId: revision identifier for active modal
 */
export function usePayrollMastersUrlState() {
  const [searchParams, setSearchParams] = useSearchParams();

  // 1. Pagination
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

  // 2. Modal & Revision Identifier
  const modalParam = searchParams.get('modal') || '';
  const modal = VALID_MODALS.includes(modalParam) ? modalParam : '';
  const revisionId = searchParams.get('revisionId') || '';

  const openHistory = useCallback((id) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('modal', 'history');
      if (id) next.set('revisionId', id); else next.delete('revisionId');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const openEdit = useCallback((id) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('modal', 'edit');
      if (id) next.set('revisionId', id); else next.delete('revisionId');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const openCreate = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('modal', 'create');
      next.delete('revisionId');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const openPreview = useCallback((id) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('modal', 'preview');
      if (id) next.set('revisionId', id); else next.delete('revisionId');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const closeModal = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('modal');
      next.delete('revisionId');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  return {
    page,
    setPage,
    modal,
    revisionId,
    openHistory,
    openEdit,
    openCreate,
    openPreview,
    closeModal
  };
}

export default usePayrollMastersUrlState;
