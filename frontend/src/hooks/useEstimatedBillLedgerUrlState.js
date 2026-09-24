import { useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * useEstimatedBillLedgerUrlState
 *
 * Bi-directionally synchronizes Work Order Timeline Ledger state with URL search parameters:
 * - from: paymentDateFrom (YYYY-MM-DD)
 * - to: paymentDateTo (YYYY-MM-DD)
 * - sort: sortConfig.key
 * - dir: sortConfig.direction ('asc' | 'desc')
 * - modal: 'new'
 */
export function useEstimatedBillLedgerUrlState() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Date filters
  const paymentDateFrom = searchParams.get('from') || searchParams.get('payment_date_from') || '';
  const setPaymentDateFrom = useCallback((val) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (val) next.set('from', val);
      else next.delete('from');
      next.delete('payment_date_from');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const paymentDateTo = searchParams.get('to') || searchParams.get('payment_date_to') || '';
  const setPaymentDateTo = useCallback((val) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (val) next.set('to', val);
      else next.delete('to');
      next.delete('payment_date_to');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Sorting
  const sortKey = searchParams.get('sort') || '';
  const sortDir = searchParams.get('dir') === 'asc' ? 'asc' : 'desc';

  const sortConfig = useMemo(() => ({
    key: sortKey,
    direction: sortDir
  }), [sortKey, sortDir]);

  const handleSort = useCallback((key) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const currentKey = next.get('sort') || '';
      const currentDir = next.get('dir') === 'asc' ? 'asc' : 'desc';

      if (currentKey === key) {
        next.set('dir', currentDir === 'asc' ? 'desc' : 'asc');
      } else {
        next.set('sort', key);
        const defaultDesc = key === 'estimated_bill_amount' || key === 'surety_pct' || key === 'surety_amount';
        next.set('dir', defaultDesc ? 'desc' : 'asc');
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Modal State
  const modalParam = searchParams.get('modal');
  const isModalOpen = modalParam === 'new';

  const openModal = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('modal', 'new');
      return next;
    });
  }, [setSearchParams]);

  const closeModal = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('modal');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  return {
    paymentDateFrom,
    setPaymentDateFrom,
    paymentDateTo,
    setPaymentDateTo,
    sortConfig,
    handleSort,
    isModalOpen,
    openModal,
    closeModal
  };
}
