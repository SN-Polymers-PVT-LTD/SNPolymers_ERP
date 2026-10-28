import { useMemo, useCallback, useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * usePayrollRegisterUrlState
 *
 * Bi-directionally synchronizes Payroll Salary Register filter, pagination,
 * and diagnostic payslip modal state with URL search parameters:
 * - search / q: employee name or code search query
 * - department: department filter
 * - group_code / group: payroll group filter
 * - status: review status filter
 * - from: period start date
 * - to: period end date
 * - page: pagination page number (omitted when 1)
 * - modal: 'payslip'
 * - employee: row id for diagnostic payslip modal
 */
export function usePayrollRegisterUrlState() {
  const [searchParams, setSearchParams] = useSearchParams();

  // 1. Extract active filters from URL
  const filters = useMemo(() => {
    const f = {};
    const q = searchParams.get('q') || searchParams.get('search') || '';
    if (q) f.search = q;
    const dept = searchParams.get('department') || '';
    if (dept) f.department = dept;
    const grp = searchParams.get('group_code') || searchParams.get('group') || '';
    if (grp) f.group_code = grp;
    const st = searchParams.get('status') || '';
    if (st) f.status = st;
    const from = searchParams.get('from') || '';
    if (from) f.from = from;
    const to = searchParams.get('to') || '';
    if (to) f.to = to;
    return f;
  }, [searchParams]);

  // Local draft state initialized from active URL filters
  const [draft, setDraft] = useState(filters);

  useEffect(() => {
    setDraft(filters);
  }, [filters]);

  // 2. Pagination
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

  // 3. Apply Filters Updater
  const applyFilters = useCallback((newDraft) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const entries = Object.entries(newDraft || {});
      // Clear filter keys
      for (const key of ['q', 'search', 'department', 'group_code', 'group', 'status', 'from', 'to']) {
        next.delete(key);
      }
      for (const [k, v] of entries) {
        if (v) {
          if (k === 'search') next.set('q', v);
          else next.set(k, v);
        }
      }
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // 4. Modal / Diagnostic Payslip state
  const modal = searchParams.get('modal') || '';
  const employee = searchParams.get('employee') || '';

  const openPayslip = useCallback((employeeRowId) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('modal', 'payslip');
      if (employeeRowId) next.set('employee', employeeRowId);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const closePayslip = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('modal');
      next.delete('employee');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  return {
    filters,
    draft,
    setDraft,
    page,
    setPage,
    applyFilters,
    employee,
    isPayslipOpen: modal === 'payslip' && !!employee,
    openPayslip,
    closePayslip
  };
}

export default usePayrollRegisterUrlState;
