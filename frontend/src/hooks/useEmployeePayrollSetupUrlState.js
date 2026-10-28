import { useMemo, useCallback, useState } from 'react';
import { useSearchParams, useInRouterContext } from 'react-router-dom';

const VALID_STATUSES = ['needs_setup', 'has_setup', 'all'];

function useSafeSearchParams() {
  const inRouter = useInRouterContext();
  const [localParams, setLocalParams] = useState(() => new URLSearchParams());

  const setParams = useCallback((updater) => {
    setLocalParams(prev => {
      const next = typeof updater === 'function' ? updater(prev) : new URLSearchParams(updater);
      return new URLSearchParams(next);
    });
  }, []);

  if (inRouter) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useSearchParams();
  }
  return [localParams, setParams];
}

/**
 * useEmployeePayrollSetupUrlState
 *
 * Bi-directionally synchronizes Employee Payroll Setup view state with URL parameters:
 * - status: 'needs_setup' (default) | 'has_setup' | 'all'
 * - search: text query (omitted when empty)
 * - department: selected department (omitted when empty)
 * - category: selected employee category (omitted when empty)
 * - page: pagination page number (omitted when 1)
 * - employeeId: employee ID for the slide-over history drawer (via ?employee=<id>)
 */
export function useEmployeePayrollSetupUrlState() {
  const [searchParams, setSearchParams] = useSafeSearchParams();

  // 1. Status Filter
  const statusParam = searchParams.get('status') || '';
  const status = VALID_STATUSES.includes(statusParam) ? statusParam : 'needs_setup';

  const setStatus = useCallback((newStatus) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newStatus && newStatus !== 'needs_setup' && VALID_STATUSES.includes(newStatus)) {
        next.set('status', newStatus);
      } else {
        next.delete('status');
      }
      next.delete('page'); // Reset to page 1 on status filter change
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // 2. Search Query
  const search = searchParams.get('search') || '';

  const setSearch = useCallback((newSearch) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const val = typeof newSearch === 'string' ? newSearch.trim() : '';
      if (val) {
        next.set('search', val);
      } else {
        next.delete('search');
      }
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // 3. Department Filter
  const department = searchParams.get('department') || '';

  const setDepartment = useCallback((newDept) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newDept) {
        next.set('department', newDept);
      } else {
        next.delete('department');
      }
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // 4. Employee Category Filter
  const category = searchParams.get('category') || '';

  const setCategory = useCallback((newCat) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newCat) {
        next.set('category', newCat);
      } else {
        next.delete('category');
      }
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // 5. Pagination
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

  // 6. Selected Employee (for Drawer)
  const employeeId = searchParams.get('employee') || '';

  const openEmployee = useCallback((id) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) {
        next.set('employee', id);
      } else {
        next.delete('employee');
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const closeEmployee = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('employee');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const resetFilters = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('search');
      next.delete('department');
      next.delete('category');
      next.delete('status');
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  return {
    status,
    setStatus,
    search,
    setSearch,
    department,
    setDepartment,
    category,
    setCategory,
    page,
    setPage,
    employeeId,
    openEmployee,
    closeEmployee,
    resetFilters,
  };
}

export default useEmployeePayrollSetupUrlState;
