import React, { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../AuthContext';
import { Button, Input, Select, Pagination, Table, TableHeader, TableBody, TableRow, TableCell } from '../ui';
import { getStatutorySetupCandidates } from '../../api/payrollProfilesApi';
import definitions from '../../../../shared/hrEmployeeCategories.json';
import useEmployeePayrollSetupUrlState from '../../hooks/useEmployeePayrollSetupUrlState';
import EmployeeSetupDrawer from './EmployeeSetupDrawer';
import StatutoryAssignmentModal from './StatutoryAssignmentModal';

const departments = ['SNP Factory', 'Fabric Factory', 'Head Office', 'Projects'];
const categoryOptions = [
  ...definitions.map(d => d.category),
  'Projects Department Employees'
];

const message = e => e?.response?.data?.message || e?.message || 'Failed to load statutory candidates';

export default function EmployeeStatutorySetup({ initialEmployeeId = '', onEmployeeChange }) {
  const { user } = useAuth();
  const allowed = user?.role === 'accounts';

  const {
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
    employeeId: urlEmployeeId,
    openEmployee,
    closeEmployee,
    resetFilters
  } = useEmployeePayrollSetupUrlState();

  // Internal state fallback for non-router tests or direct props
  const [internalEmployeeId, setInternalEmployeeId] = useState(initialEmployeeId || '');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [selected, setSelected] = useState([]);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState([]);

  // Active drawer employee ID combines URL state and initial prop
  const activeDrawerId = urlEmployeeId || internalEmployeeId;

  // Sync initialEmployeeId prop when provided
  useEffect(() => {
    if (initialEmployeeId) {
      setInternalEmployeeId(initialEmployeeId);
    }
  }, [initialEmployeeId]);

  const handleOpenDrawer = (id) => {
    setInternalEmployeeId(id);
    openEmployee(id);
    onEmployeeChange?.(id);
  };

  const handleCloseDrawer = () => {
    setInternalEmployeeId('');
    closeEmployee();
    onEmployeeChange?.('');
  };

  // Candidates query with server-calculated totals
  const candidatesQuery = useQuery({
    queryKey: ['statutory-bulk-candidates', user?.id, search, department, category, status, page],
    enabled: allowed,
    queryFn: async () => (await getStatutorySetupCandidates({
      search: search || undefined,
      department: department || undefined,
      employee_category: category || undefined,
      status: status || undefined,
      page,
      limit: 20
    })).data.result
  });

  const candidatesData = candidatesQuery.data;
  const employees = useMemo(() => candidatesData?.employees || [], [candidatesData?.employees]);
  const total = candidatesData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 20));

  // Server counters across all matching employees
  const allTotal = candidatesData?.all_total ?? total;
  const needsSetupTotal = candidatesData?.needs_setup_total ?? candidatesData?.eligible_total ?? 0;
  const hasSetupTotal = candidatesData?.has_setup_total ?? 0;

  // Check eligibility for selection: unconfigured non-local employees
  const eligible = (e) => e.profile_version === 0 && e.employee_category !== 'Local Daily-Wage Workers';
  const pageEligible = useMemo(() => employees.filter(eligible), [employees]);

  // Open assignment modal for single employee or selected batch
  const handleOpenAssignModal = (targetList) => {
    setAssignTarget(targetList);
    setAssignModalOpen(true);
  };

  if (!allowed) {
    return <p role="alert">Employee payroll setup is maintained by Accounts only.</p>;
  }

  const activeFiltersCount = (search ? 1 : 0) + (department ? 1 : 0) + (category ? 1 : 0) + (status !== 'needs_setup' ? 1 : 0);

  return (
    <div className="space-y-6 w-full">
      {/* 1. Header & Policy Guidance Notice */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-white/5">
        <div>
          <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">
            Accounts Statutory Setup
          </span>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-100 mt-1">
            Employee Statutory Setup
          </h1>
          <p className="text-xs text-slate-400 font-medium mt-1">
            Assign company deduction setups to employees and inspect dated statutory history. Individual pay structures and EPF/ESI enrolment remain in Employee Management.
          </p>
        </div>
      </div>

      {/* 2. Top Interactive KPI Stats Strip (Clickable to switch Quick View) */}
      <div className="glass-panel p-4 sm:p-5 rounded-3xl border border-white/5 bg-gradient-to-r from-white/[0.02] to-amber-500/[0.02] grid grid-cols-1 sm:grid-cols-3 gap-4 sm:divide-x sm:divide-white/5 text-center">
        {/* KPI: All Active Employees */}
        <button
          type="button"
          onClick={() => setStatus('all')}
          className={`p-3 rounded-xl transition-all duration-200 text-center ${
            status === 'all'
              ? 'bg-white/10 ring-1 ring-white/20'
              : 'hover:bg-white/[0.03]'
          }`}
          title="Filter view to all active employees"
        >
          <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block mb-1">
            All Employees
          </span>
          <span className="text-2xl sm:text-3xl font-black text-slate-100 font-mono">
            {candidatesQuery.isPending ? '…' : allTotal}
          </span>
          <span className="text-[10px] text-slate-400 block mt-1">
            Total active employees in view
          </span>
        </button>

        {/* KPI: Needs Initial Setup */}
        <button
          type="button"
          onClick={() => setStatus('needs_setup')}
          className={`p-3 rounded-xl transition-all duration-200 text-center ${
            status === 'needs_setup'
              ? 'bg-amber-500/10 ring-1 ring-amber-500/30'
              : 'hover:bg-white/[0.03]'
          }`}
          title="Filter view to employees needing initial setup"
        >
          <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 block mb-1">
            Needs initial setup
          </span>
          <span className="text-2xl sm:text-3xl font-black text-amber-400 font-mono">
            {candidatesQuery.isPending ? '…' : needsSetupTotal}
          </span>
          <span className="text-[10px] text-amber-400/80 block mt-1">
            Awaiting statutory profile setup
          </span>
        </button>

        {/* KPI: Has Setup */}
        <button
          type="button"
          onClick={() => setStatus('has_setup')}
          className={`p-3 rounded-xl transition-all duration-200 text-center ${
            status === 'has_setup'
              ? 'bg-emerald-500/10 ring-1 ring-emerald-500/30'
              : 'hover:bg-white/[0.03]'
          }`}
          title="Filter view to configured employees"
        >
          <span className="text-[10px] uppercase font-bold tracking-widest text-emerald-400 block mb-1">
            Has setup
          </span>
          <span className="text-2xl sm:text-3xl font-black text-emerald-300 font-mono">
            {candidatesQuery.isPending ? '…' : hasSetupTotal}
          </span>
          <span className="text-[10px] text-emerald-400/80 block mt-1">
            Active configured profiles
          </span>
        </button>
      </div>

      {/* 3. Main Workspace: Left Control Rail & Right Unified Employee List */}
      <div className="flex flex-col md:flex-row gap-6 items-start">
        {/* Left Control Rail */}
        <div className="w-full md:w-64 lg:w-72 shrink-0 space-y-4">
          {/* Mobile Filter Toggle Button */}
          <div className="md:hidden flex items-center justify-between p-3 rounded-2xl bg-white/[0.02] border border-white/5">
            <span className="text-xs font-bold text-slate-300">
              Filters & Views {activeFiltersCount > 0 && `(${activeFiltersCount})`}
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setMobileFiltersOpen(prev => !prev)}
            >
              {mobileFiltersOpen ? 'Hide Filters' : 'Show Filters'}
            </Button>
          </div>

          <aside className={`glass-panel p-5 rounded-2xl border border-white/5 space-y-5 bg-white/[0.01] shadow-xl ${mobileFiltersOpen ? 'block' : 'hidden md:block'}`}>
            <div className="flex items-center justify-between pb-3 border-b border-white/5">
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                Filters & Quick Views
              </span>
              {activeFiltersCount > 0 && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="text-[10px] text-amber-400 hover:text-amber-300 transition underline underline-offset-2"
                >
                  Reset
                </button>
              )}
            </div>

            {/* Quick Views */}
            <div className="space-y-2">
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block">
                Quick Views
              </span>
              <div className="space-y-1.5">
                <Button
                  onClick={() => setStatus('needs_setup')}
                  variant={status === 'needs_setup' ? 'yellow' : 'ghost'}
                  size="sm"
                  className="w-full justify-between"
                >
                  <span>Needs initial setup</span>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${status === 'needs_setup' ? 'bg-black/20 text-slate-950 font-bold' : 'bg-black/30'}`}>
                    {needsSetupTotal}
                  </span>
                </Button>

                <Button
                  onClick={() => setStatus('has_setup')}
                  variant={status === 'has_setup' ? 'yellow' : 'ghost'}
                  size="sm"
                  className="w-full justify-between"
                >
                  <span>Has setup</span>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${status === 'has_setup' ? 'bg-black/20 text-slate-950 font-bold' : 'bg-black/30'}`}>
                    {hasSetupTotal}
                  </span>
                </Button>

                <Button
                  onClick={() => setStatus('all')}
                  variant={status === 'all' ? 'yellow' : 'ghost'}
                  size="sm"
                  className="w-full justify-between"
                >
                  <span>All</span>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${status === 'all' ? 'bg-black/20 text-slate-950 font-bold' : 'bg-black/30'}`}>
                    {allTotal}
                  </span>
                </Button>
              </div>
            </div>

            {/* Search Input */}
            <div className="pt-3 border-t border-white/5 space-y-1.5">
              <Input
                label="Find employee"
                placeholder="Name or employee code..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                size="sm"
              />
            </div>

            {/* Department Filter */}
            <div className="pt-3 border-t border-white/5 space-y-1.5">
              <Select
                label="Department"
                value={department}
                options={[
                  { value: '', label: 'All departments' },
                  ...departments.map(d => ({ value: d, label: d }))
                ]}
                onChange={e => setDepartment(e.target.value)}
                size="sm"
              />
            </div>

            {/* Employee Category Filter */}
            <div className="pt-3 border-t border-white/5 space-y-1.5">
              <Select
                label="Category"
                value={category}
                options={[
                  { value: '', label: 'All categories' },
                  ...categoryOptions.map(c => ({ value: c, label: c }))
                ]}
                onChange={e => setCategory(e.target.value)}
                size="sm"
              />
            </div>
          </aside>
        </div>

        {/* Right Unified Employee List */}
        <section
          aria-label="Payroll statutory profiles list"
          className="flex-1 w-full flex flex-col min-h-0 bg-white/[0.01] border border-white/5 rounded-3xl p-6 relative overflow-hidden shadow-xl min-w-0 space-y-5"
        >
          {/* Workspace Action & Count Header */}
          <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 pb-4 border-b border-white/5">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-100">
                  {status === 'needs_setup'
                    ? 'Employees Needing Initial Setup'
                    : status === 'has_setup'
                    ? 'Configured Employees'
                    : 'All Active Employees'}
                </h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/5 text-slate-400 border border-white/5">
                  {total} {total === 1 ? 'employee' : 'employees'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Select eligible candidates to batch assign a deduction setup or inspect dated revision history.
              </p>
            </div>

            {/* Quick Bulk Selection Helpers */}
            {pageEligible.length > 0 && (
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const combined = [...selected.filter(s => !pageEligible.some(p => p.id === s.id)), ...pageEligible];
                    if (combined.length > 100) {
                      alert('A maximum of 100 employees can be assigned in a single batch.');
                      setSelected(combined.slice(0, 100));
                    } else {
                      setSelected(combined);
                    }
                  }}
                  title="Select all eligible employees on this page"
                >
                  Select page ({pageEligible.length})
                </Button>

                {selected.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelected([])}
                  >
                    Clear ({selected.length})
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Candidates Query States */}
          {candidatesQuery.isPending ? (
            <div role="status" className="p-8 text-center text-xs text-slate-400 space-y-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse inline-block"></span>
              <p>Loading statutory candidates…</p>
            </div>
          ) : candidatesQuery.isError ? (
            <div role="alert" className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 flex items-center justify-between">
              <span>{message(candidatesQuery.error)}</span>
              <Button size="sm" onClick={() => candidatesQuery.refetch()}>Retry</Button>
            </div>
          ) : !employees.length ? (
            <div className="p-12 text-center text-slate-500 text-xs uppercase font-extrabold tracking-widest border border-dashed border-white/5 rounded-2xl space-y-2">
              <p>No employees match the selected filters.</p>
              {activeFiltersCount > 0 && (
                <Button size="sm" variant="ghost" onClick={resetFilters}>
                  Clear all filters
                </Button>
              )}
            </div>
          ) : (
            <>
              {/* Employee Table */}
              <div className="glass-panel rounded-2xl border border-white/5 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableCell isHeader className="w-10">
                        <input
                          type="checkbox"
                          aria-label="Select eligible employees on current page"
                          disabled={!pageEligible.length}
                          checked={pageEligible.length > 0 && pageEligible.every(p => selected.some(s => s.id === p.id))}
                          onChange={e => {
                            if (e.target.checked) {
                              const combined = [...selected.filter(s => !pageEligible.some(p => p.id === s.id)), ...pageEligible];
                              setSelected(combined.slice(0, 100));
                            } else {
                              setSelected(prev => prev.filter(s => !pageEligible.some(p => p.id === s.id)));
                            }
                          }}
                          className="rounded border-slate-700 text-amber-500 focus:ring-amber-500 focus:ring-offset-0 bg-slate-900"
                        />
                      </TableCell>
                      <TableCell isHeader>Employee</TableCell>
                      <TableCell isHeader>Department & Category</TableCell>
                      <TableCell isHeader>Joined</TableCell>
                      <TableCell isHeader>Pay Enrolment</TableCell>
                      <TableCell isHeader>Status</TableCell>
                      <TableCell isHeader className="text-right">Action</TableCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {employees.map(emp => {
                      const isLocal = emp.employee_category === 'Local Daily-Wage Workers';
                      const isConfigured = emp.profile_version > 0;
                      const isSelected = selected.some(s => s.id === emp.id);
                      const isEligibleForSelection = eligible(emp);

                      return (
                        <TableRow key={emp.id} className="hover:bg-white/[0.02] transition-colors">
                          {/* Checkbox Column */}
                          <TableCell>
                            <input
                              type="checkbox"
                              aria-label={`Select ${emp.employee_code}`}
                              disabled={!isEligibleForSelection && !isSelected}
                              checked={isSelected}
                              onChange={e => {
                                if (e.target.checked) {
                                  if (selected.length >= 100) {
                                    alert('A maximum of 100 employees can be selected at once.');
                                    return;
                                  }
                                  setSelected(prev => [...prev, emp]);
                                } else {
                                  setSelected(prev => prev.filter(s => s.id !== emp.id));
                                }
                              }}
                              className="rounded border-slate-700 text-amber-500 focus:ring-amber-500 focus:ring-offset-0 bg-slate-900"
                            />
                          </TableCell>

                          {/* Employee Name & Code */}
                          <TableCell>
                            <div className="font-semibold text-slate-100">{emp.employee_name}</div>
                            <div className="text-xs text-slate-400 font-mono">{emp.employee_code}</div>
                          </TableCell>

                          {/* Department & Category */}
                          <TableCell>
                            <div className="text-xs text-slate-200">{emp.department || '—'}</div>
                            <div className="text-[11px] text-slate-400">{emp.employee_category}</div>
                          </TableCell>

                          {/* Joining Date */}
                          <TableCell>
                            <span className="font-mono text-xs text-slate-300">{emp.joining_date || '—'}</span>
                          </TableCell>

                          {/* Enrolment Snapshot */}
                          <TableCell>
                            <div className="text-xs space-y-0.5">
                              <span className="block text-slate-300">
                                EPF: {emp.epf_enrolment == null ? 'Not recorded' : emp.epf_enrolment ? 'Enrolled' : 'Not enrolled'}
                              </span>
                              <span className="block text-slate-300">
                                ESI: {emp.esi_enrolment == null ? 'Not recorded' : emp.esi_enrolment ? 'Enrolled' : 'Not enrolled'}
                              </span>
                            </div>
                          </TableCell>

                          {/* Status Badge */}
                          <TableCell>
                            {isLocal ? (
                              <span className="px-2 py-0.5 text-[10px] font-semibold rounded bg-slate-800 text-slate-300 border border-slate-700">
                                Local Worker (Exempt)
                              </span>
                            ) : isConfigured ? (
                              <span className="px-2 py-0.5 text-[10px] font-semibold rounded bg-emerald-950/40 text-emerald-400 border border-emerald-800/40 font-mono">
                                Has setup (v{emp.profile_version})
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 text-[10px] font-semibold rounded bg-amber-950/40 text-amber-400 border border-amber-800/40">
                                Needs initial setup
                              </span>
                            )}
                          </TableCell>

                          {/* Row Actions */}
                          <TableCell className="text-right whitespace-nowrap">
                            {!isConfigured && !isLocal ? (
                              <Button
                                size="sm"
                                variant="yellow"
                                onClick={() => handleOpenAssignModal([emp])}
                                className="normal-case font-bold px-3.5 py-1.5 rounded-xl shadow-md shadow-yellow-500/20"
                                icon={
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                  </svg>
                                }
                              >
                                Assign setup
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="yellow"
                                className="normal-case font-bold px-3.5 py-1.5 rounded-xl shadow-md shadow-yellow-500/20"
                                onClick={() => handleOpenDrawer(emp.id)}
                                icon={
                                  <svg className="w-3.5 h-3.5 text-current" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                  </svg>
                                }
                              >
                                {isConfigured ? 'View / change setup' : 'View history'}
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <Pagination
                currentPage={page}
                totalPages={totalPages}
                onPageChange={setPage}
              />
            </>
          )}
        </section>
      </div>

      {/* 4. Sticky Selection Dock (Appears when 1+ employees are selected) */}
      {selected.length > 0 && (
        <div className="fixed bottom-6 inset-x-0 z-40 flex justify-center px-4 pointer-events-none">
          <div className="pointer-events-auto bg-slate-900/95 border border-amber-500/30 rounded-2xl p-3 px-5 shadow-2xl backdrop-blur-md flex items-center gap-4 text-xs animate-in fade-in slide-in-from-bottom-3 duration-200">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
              <span className="font-bold text-white font-mono">{selected.length}</span>
              <span className="text-slate-300">
                {selected.length === 1 ? 'employee selected' : 'employees selected'}
              </span>
            </div>
            <div className="h-4 w-px bg-white/10" />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="yellow"
                onClick={() => handleOpenAssignModal(selected)}
              >
                Assign setup
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelected([])}
              >
                Clear selection
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 5. Shared Assignment Confirmation Modal */}
      <StatutoryAssignmentModal
        isOpen={assignModalOpen}
        onClose={() => {
          setAssignModalOpen(false);
          setAssignTarget([]);
        }}
        selectedEmployees={assignTarget}
        user={user}
        onSuccess={(results) => {
          const succeededIds = new Set((results || []).filter(r => r.success).map(r => r.employee_id));
          setSelected(prev => prev.filter(e => !succeededIds.has(e.id)));
          candidatesQuery.refetch();
        }}
      />

      {/* 6. Employee Setup History & Dated Editor Drawer */}
      {activeDrawerId && (
        <EmployeeSetupDrawer
          employeeId={activeDrawerId}
          onClose={handleCloseDrawer}
          user={user}
          employeeSummary={employees.find(e => e.id === activeDrawerId)}
        />
      )}
    </div>
  );
}
