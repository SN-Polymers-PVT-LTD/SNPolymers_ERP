import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * useAcctRequisitionDetailsUrlState
 *
 * Bi-directionally synchronizes Requisition Details line items search with URL search parameters:
 * - sub_title: account_sub_title
 * - beneficiary_ac: beneficiary_ac_no (debounced)
 * - beneficiary_name: beneficiary_name (debounced)
 * - bank: debit_bank_ac_type
 * - wo: work_order_no
 * - status: requisition_status
 * - from: date_from (YYYY-MM-DD)
 * - to: date_to (YYYY-MM-DD)
 * - page: pagination page number
 */
export function useAcctRequisitionDetailsUrlState() {
  const [searchParams, setSearchParams] = useSearchParams();

  // 1. Account Sub-Title
  const accountSubTitle = searchParams.get('sub_title') || searchParams.get('account_sub_title') || '';
  const setAccountSubTitle = useCallback((val) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (val) next.set('sub_title', val);
      else next.delete('sub_title');
      next.delete('account_sub_title');
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // 2. Beneficiary A/c No (debounced)
  const urlBeneficiaryAc = searchParams.get('beneficiary_ac') || searchParams.get('beneficiary_ac_no') || '';
  const [beneficiaryAcNo, setBeneficiaryAcNo] = useState(urlBeneficiaryAc);

  useEffect(() => {
    setBeneficiaryAcNo(urlBeneficiaryAc);
  }, [urlBeneficiaryAc]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        const trimmed = beneficiaryAcNo.trim();
        const currentInUrl = next.get('beneficiary_ac') || next.get('beneficiary_ac_no') || '';
        if (trimmed === currentInUrl) return prev;

        if (trimmed) {
          next.set('beneficiary_ac', trimmed);
          next.delete('beneficiary_ac_no');
        } else {
          next.delete('beneficiary_ac');
          next.delete('beneficiary_ac_no');
        }
        next.delete('page');
        return next;
      }, { replace: true });
    }, 300);

    return () => clearTimeout(timer);
  }, [beneficiaryAcNo, setSearchParams]);

  // 3. Beneficiary Name (debounced)
  const urlBeneficiaryName = searchParams.get('beneficiary_name') || '';
  const [beneficiaryName, setBeneficiaryName] = useState(urlBeneficiaryName);

  useEffect(() => {
    setBeneficiaryName(urlBeneficiaryName);
  }, [urlBeneficiaryName]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        const trimmed = beneficiaryName.trim();
        const currentInUrl = next.get('beneficiary_name') || '';
        if (trimmed === currentInUrl) return prev;

        if (trimmed) {
          next.set('beneficiary_name', trimmed);
        } else {
          next.delete('beneficiary_name');
        }
        next.delete('page');
        return next;
      }, { replace: true });
    }, 300);

    return () => clearTimeout(timer);
  }, [beneficiaryName, setSearchParams]);

  // 4. Debit Bank Account Type
  const debitBankAcType = searchParams.get('bank') || searchParams.get('debit_bank_ac_type') || '';
  const setDebitBankAcType = useCallback((val) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (val) next.set('bank', val);
      else next.delete('bank');
      next.delete('debit_bank_ac_type');
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // 5. Work Order Number
  const workOrderNo = searchParams.get('wo') || searchParams.get('work_order_no') || '';
  const setWorkOrderNo = useCallback((val) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (val) next.set('wo', val);
      else next.delete('wo');
      next.delete('work_order_no');
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // 6. Requisition Status
  const requisitionStatus = searchParams.get('status') || searchParams.get('requisition_status') || '';
  const setRequisitionStatus = useCallback((val) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (val) next.set('status', val);
      else next.delete('status');
      next.delete('requisition_status');
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // 7. Date Range
  const dateFrom = searchParams.get('from') || searchParams.get('date_from') || '';
  const setDateFrom = useCallback((val) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (val) next.set('from', val);
      else next.delete('from');
      next.delete('date_from');
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const dateTo = searchParams.get('to') || searchParams.get('date_to') || '';
  const setDateTo = useCallback((val) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (val) next.set('to', val);
      else next.delete('to');
      next.delete('date_to');
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setDateRange = useCallback((fromVal, toVal) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (fromVal) next.set('from', fromVal);
      else next.delete('from');
      if (toVal) next.set('to', toVal);
      else next.delete('to');
      next.delete('date_from');
      next.delete('date_to');
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // 8. Pagination
  const pageParam = parseInt(searchParams.get('page'), 10);
  const page = !isNaN(pageParam) && pageParam > 0 ? pageParam : 1;

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

  // 9. Reset all filters
  const resetFilters = useCallback(() => {
    setBeneficiaryAcNo('');
    setBeneficiaryName('');
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('sub_title');
      next.delete('account_sub_title');
      next.delete('beneficiary_ac');
      next.delete('beneficiary_ac_no');
      next.delete('beneficiary_name');
      next.delete('bank');
      next.delete('debit_bank_ac_type');
      next.delete('wo');
      next.delete('work_order_no');
      next.delete('status');
      next.delete('requisition_status');
      next.delete('from');
      next.delete('date_from');
      next.delete('to');
      next.delete('date_to');
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Helpers
  const hasFilters = Boolean(
    accountSubTitle || beneficiaryAcNo || beneficiaryName || debitBankAcType ||
    workOrderNo || requisitionStatus || dateFrom || dateTo
  );

  const buildParams = useCallback(() => {
    const params = {};
    if (accountSubTitle) params.account_sub_title = accountSubTitle;
    if (beneficiaryAcNo) params.beneficiary_ac_no = beneficiaryAcNo;
    if (beneficiaryName) params.beneficiary_name = beneficiaryName;
    if (debitBankAcType) params.debit_bank_ac_type = debitBankAcType;
    if (workOrderNo) params.work_order_no = workOrderNo;
    if (requisitionStatus) params.requisition_status = requisitionStatus;
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    return params;
  }, [accountSubTitle, beneficiaryAcNo, beneficiaryName, debitBankAcType, workOrderNo, requisitionStatus, dateFrom, dateTo]);

  return {
    accountSubTitle,
    setAccountSubTitle,
    beneficiaryAcNo,
    setBeneficiaryAcNo,
    beneficiaryName,
    setBeneficiaryName,
    debitBankAcType,
    setDebitBankAcType,
    workOrderNo,
    setWorkOrderNo,
    requisitionStatus,
    setRequisitionStatus,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    setDateRange,
    page,
    setPage,
    resetFilters,
    hasFilters,
    buildParams
  };
}
