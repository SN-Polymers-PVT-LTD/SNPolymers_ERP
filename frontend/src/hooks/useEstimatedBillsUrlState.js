import { useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * useEstimatedBillsUrlState
 *
 * Bi-directionally synchronizes Estimated Bills Overview filter and modal states with URL search parameters:
 * - zone: zone filter
 * - wo: work_order_no
 * - status: project status filter
 * - surety: min_surety percentage filter
 * - from: payment_date_from
 * - to: payment_date_to
 * - modal: 'new'
 * - modal_wo: initialWorkOrderNo for modal
 */
export function useEstimatedBillsUrlState(defaultZone = '') {
  const [searchParams, setSearchParams] = useSearchParams();

  // Read filters from URL
  const zone = searchParams.get('zone') ?? defaultZone;
  const work_order_no = searchParams.get('wo') || searchParams.get('work_order_no') || '';
  const status = searchParams.get('status') || '';
  const min_surety = searchParams.get('surety') || searchParams.get('min_surety') || '';
  const payment_date_from = searchParams.get('from') || searchParams.get('payment_date_from') || '';
  const payment_date_to = searchParams.get('to') || searchParams.get('payment_date_to') || '';

  const filters = useMemo(() => ({
    zone,
    work_order_no,
    status,
    min_surety,
    payment_date_from,
    payment_date_to
  }), [zone, work_order_no, status, min_surety, payment_date_from, payment_date_to]);

  const setFilters = useCallback((updater) => {
    setSearchParams((prev) => {
      const currentFilters = {
        zone: prev.get('zone') ?? defaultZone,
        work_order_no: prev.get('wo') || prev.get('work_order_no') || '',
        status: prev.get('status') || '',
        min_surety: prev.get('surety') || prev.get('min_surety') || '',
        payment_date_from: prev.get('from') || prev.get('payment_date_from') || '',
        payment_date_to: prev.get('to') || prev.get('payment_date_to') || ''
      };

      const nextFilters = typeof updater === 'function' ? updater(currentFilters) : updater;
      const next = new URLSearchParams(prev);

      // Zone
      if (nextFilters.zone && nextFilters.zone !== defaultZone) next.set('zone', nextFilters.zone);
      else if (nextFilters.zone === defaultZone) next.delete('zone');
      else next.delete('zone');

      // Work Order
      if (nextFilters.work_order_no) next.set('wo', nextFilters.work_order_no);
      else next.delete('wo');
      next.delete('work_order_no');

      // Status
      if (nextFilters.status) next.set('status', nextFilters.status);
      else next.delete('status');

      // Min Surety
      if (nextFilters.min_surety) next.set('surety', nextFilters.min_surety);
      else next.delete('surety');
      next.delete('min_surety');

      // Dates
      if (nextFilters.payment_date_from) next.set('from', nextFilters.payment_date_from);
      else next.delete('from');
      next.delete('payment_date_from');

      if (nextFilters.payment_date_to) next.set('to', nextFilters.payment_date_to);
      else next.delete('to');
      next.delete('payment_date_to');

      return next;
    }, { replace: true });
  }, [defaultZone, setSearchParams]);

  // Modal State
  const modalParam = searchParams.get('modal');
  const modalWoParam = searchParams.get('modal_wo');
  const isModalOpen = modalParam === 'new';
  const initialWorkOrderNo = modalWoParam || null;

  const modalState = useMemo(() => ({
    isOpen: isModalOpen,
    initialWorkOrderNo
  }), [isModalOpen, initialWorkOrderNo]);

  const openNewModal = useCallback((workOrderNo = null) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('modal', 'new');
      if (workOrderNo) next.set('modal_wo', workOrderNo);
      else next.delete('modal_wo');
      return next;
    });
  }, [setSearchParams]);

  const closeModal = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('modal');
      next.delete('modal_wo');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  return {
    filters,
    setFilters,
    modalState,
    openNewModal,
    closeModal
  };
}
