import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Input,
  Select,
  Checkbox,
  Badge,
  Modal,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableCell,
  SkeletonCard,
  SuccessPopup,
  ErrorPopup
} from '../../components/ui';
import { getEmployees } from '../../api/hrEmployeesApi';
import {
  getEmployeePayStructures,
  createPayStructure,
  activatePayStructure,
  updateDraftPayStructure
} from '../../api/hrPayStructuresApi';
import { PERMANENT_CATEGORIES, PAY_BASES } from './employeeConstants';

const formatINR = (val) => {
  if (val === null || val === undefined || val === '') return '—';
  const num = parseFloat(val);
  if (isNaN(num)) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(num);
};

export default function PermanentPayStructure({ initialEmployeeId = '' }) {
  const queryClient = useQueryClient();

  const [selectedEmployeeId, setSelectedEmployeeId] = useState(initialEmployeeId);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [employeePage, setEmployeePage] = useState(1);
  const [loadedEmployeesMap, setLoadedEmployeesMap] = useState({});

  // Modal State for Create / Edit Form
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [isEditingDraft, setIsEditingDraft] = useState(false);
  const [editingStructureId, setEditingStructureId] = useState(null);

  const [form, setForm] = useState({
    pay_basis: 'Monthly salary',
    guaranteed_monthly_gross: '',
    basic_salary: '',
    staff_welfare: '',
    other_fixed_components: '',
    epf_enrolment: false,
    esi_enrolment: false,
    status: 'Draft'
  });

  const [formErrors, setFormErrors] = useState({});
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Sync initialEmployeeId prop if passed
  useEffect(() => {
    if (initialEmployeeId) {
      setSelectedEmployeeId(initialEmployeeId);
    }
  }, [initialEmployeeId]);

  // Reset page and loaded map when search changes
  useEffect(() => {
    setLoadedEmployeesMap({});
    setEmployeePage(1);
  }, [employeeSearch]);

  // Fetch permanent employees for the employee selector dropdown
  const {
    data: employeesResp,
    isLoading: isLoadingEmployees
  } = useQuery({
    queryKey: ['hr-permanent-employees-list', employeeSearch, employeePage],
    queryFn: async () => {
      const params = { page: employeePage, limit: 50 };
      if (employeeSearch) params.search = employeeSearch;
      const res = await getEmployees(params);
      return res.data;
    }
  });

  const employeePagination = employeesResp?.pagination || { page: employeePage, totalPages: 1, totalItems: 0 };

  useEffect(() => {
    const raw = employeesResp?.employees || [];
    if (raw.length > 0) {
      setLoadedEmployeesMap((prev) => {
        const next = { ...prev };
        raw.forEach((emp) => {
          if (PERMANENT_CATEGORIES.has(emp.employee_category)) {
            next[emp.id] = emp;
          }
        });
        return next;
      });
    }
  }, [employeesResp]);

  // Fetch pay structures for selected employee
  const {
    data: payData,
    isLoading: isLoadingPay,
    isError: isPayError,
    error: payFetchError,
    refetch: refetchPay
  } = useQuery({
    queryKey: ['hr-pay-structures', selectedEmployeeId],
    queryFn: async () => {
      const res = await getEmployeePayStructures(selectedEmployeeId);
      return res.data;
    },
    enabled: Boolean(selectedEmployeeId)
  });

  const selectedEmployee =
    payData?.employee ||
    loadedEmployeesMap[selectedEmployeeId] ||
    (employeesResp?.employees || []).find((e) => e.id === selectedEmployeeId) ||
    null;

  const eligibleEmployees = useMemo(() => {
    const map = new Map();
    // 1. Add all accumulated employees from all pages visited
    Object.values(loadedEmployeesMap).forEach((e) => map.set(e.id, e));
    // 2. Add current response immediately to avoid 1-render lag
    (employeesResp?.employees || []).forEach((e) => {
      if (PERMANENT_CATEGORIES.has(e.employee_category)) {
        map.set(e.id, e);
      }
    });
    // 3. Ensure selected employee is preserved if known
    if (selectedEmployee && PERMANENT_CATEGORIES.has(selectedEmployee.employee_category)) {
      map.set(selectedEmployee.id, selectedEmployee);
    }
    return Array.from(map.values());
  }, [employeesResp, loadedEmployeesMap, selectedEmployee]);

  const activeStructure = payData?.active_structure || null;
  const revisions = payData?.revisions || [];
  const draftStructure = revisions.find((r) => r.status === 'Draft') || null;
  const isEligibleCategory = selectedEmployee ? PERMANENT_CATEGORIES.has(selectedEmployee.employee_category) : false;

  // Component Reconciliation calculation
  const reconciliation = useMemo(() => {
    const gross = parseFloat(form.guaranteed_monthly_gross) || 0;
    const basic = parseFloat(form.basic_salary) || 0;
    const welfare = parseFloat(form.staff_welfare) || 0;
    const other = parseFloat(form.other_fixed_components) || 0;
    const totalComponents = Number((basic + welfare + other).toFixed(2));
    const isExceeded = gross > 0 && totalComponents > gross;
    const difference = Number((gross - totalComponents).toFixed(2));

    return {
      gross,
      totalComponents,
      isExceeded,
      difference
    };
  }, [form.guaranteed_monthly_gross, form.basic_salary, form.staff_welfare, form.other_fixed_components]);

  // Mutations
  const createMutation = useMutation({
    mutationFn: (payload) => createPayStructure(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr-pay-structures', selectedEmployeeId] });
      setIsFormModalOpen(false);
      setSuccessMsg('Pay structure saved successfully.');
    },
    onError: (err) => {
      setErrorMsg(err.response?.data?.message || err.message || 'Failed to save pay structure.');
    }
  });

  const updateDraftMutation = useMutation({
    mutationFn: ({ id, payload }) => updateDraftPayStructure(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr-pay-structures', selectedEmployeeId] });
      setIsFormModalOpen(false);
      setSuccessMsg('Draft pay structure updated successfully.');
    },
    onError: (err) => {
      setErrorMsg(err.response?.data?.message || err.message || 'Failed to update draft pay structure.');
    }
  });

  const activateMutation = useMutation({
    mutationFn: (id) => activatePayStructure(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr-pay-structures', selectedEmployeeId] });
      setSuccessMsg('Pay structure revision activated successfully.');
    },
    onError: (err) => {
      setErrorMsg(err.response?.data?.message || err.message || 'Failed to activate pay structure.');
    }
  });

  // Open Create Initial or New Revision Modal
  const handleOpenNewRevision = () => {
    setIsEditingDraft(false);
    setEditingStructureId(null);
    setForm({
      pay_basis: activeStructure?.pay_basis || 'Monthly salary',
      guaranteed_monthly_gross: activeStructure?.guaranteed_monthly_gross ? String(activeStructure.guaranteed_monthly_gross) : '',
      basic_salary: activeStructure?.basic_salary ? String(activeStructure.basic_salary) : '',
      staff_welfare: activeStructure?.staff_welfare ? String(activeStructure.staff_welfare) : '',
      other_fixed_components: activeStructure?.other_fixed_components ? String(activeStructure.other_fixed_components) : '',
      epf_enrolment: activeStructure ? Boolean(activeStructure.epf_enrolment) : false,
      esi_enrolment: activeStructure ? Boolean(activeStructure.esi_enrolment) : false,
      status: 'Draft'
    });
    setFormErrors({});
    setIsFormModalOpen(true);
  };

  // Open Edit Draft Modal
  const handleOpenEditDraft = (draft) => {
    setIsEditingDraft(true);
    setEditingStructureId(draft.id);
    setForm({
      pay_basis: draft.pay_basis || 'Monthly salary',
      guaranteed_monthly_gross: draft.guaranteed_monthly_gross ? String(draft.guaranteed_monthly_gross) : '',
      basic_salary: draft.basic_salary ? String(draft.basic_salary) : '',
      staff_welfare: draft.staff_welfare ? String(draft.staff_welfare) : '',
      other_fixed_components: draft.other_fixed_components ? String(draft.other_fixed_components) : '',
      epf_enrolment: Boolean(draft.epf_enrolment),
      esi_enrolment: Boolean(draft.esi_enrolment),
      status: draft.status || 'Draft'
    });
    setFormErrors({});
    setIsFormModalOpen(true);
  };

  // Form Submission
  const handleSubmitForm = (e) => {
    e.preventDefault();
    const errors = {};

    const grossNum = parseFloat(form.guaranteed_monthly_gross);
    if (isNaN(grossNum) || grossNum < 0) {
      errors.guaranteed_monthly_gross = 'Guaranteed monthly gross must be a valid non-negative number.';
    }

    if (reconciliation.isExceeded) {
      errors.guaranteed_monthly_gross = `Fixed components (${formatINR(reconciliation.totalComponents)}) cannot exceed Guaranteed Monthly Gross (${formatINR(grossNum)}).`;
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    const basePayload = {
      pay_basis: form.pay_basis,
      guaranteed_monthly_gross: grossNum,
      basic_salary: form.basic_salary ? parseFloat(form.basic_salary) : null,
      staff_welfare: form.staff_welfare ? parseFloat(form.staff_welfare) : null,
      other_fixed_components: form.other_fixed_components ? parseFloat(form.other_fixed_components) : null,
      epf_enrolment: Boolean(form.epf_enrolment),
      esi_enrolment: Boolean(form.esi_enrolment),
      status: form.status
    };

    if (isEditingDraft && editingStructureId) {
      updateDraftMutation.mutate({ id: editingStructureId, payload: basePayload });
    } else {
      createMutation.mutate({ ...basePayload, employee_id: selectedEmployeeId });
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Employee Selection Card */}
      <div className="glass-card p-6 border border-white/10 rounded-2xl bg-slate-900/60 backdrop-blur-xl shadow-2xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-white/10">
          <div>
            <h2 className="text-xl font-extrabold text-white tracking-wide">
              Permanent Employee Pay Structure
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Agreed monthly compensation and EPF/ESI enrolment selections for permanent workforce categories.
            </p>
          </div>
          {selectedEmployee && isEligibleCategory && !draftStructure && (
            <Button
              variant="primary"
              size="md"
              onClick={handleOpenNewRevision}
              className="flex items-center gap-2 self-start md:self-auto shadow-lg shadow-emerald-500/20"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
              {activeStructure ? 'Create New Revision' : 'Configure Pay Structure'}
            </Button>
          )}
        </div>

        {/* Permanent Employee Selector & Search */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-6">
          <div className="space-y-2">
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              Search & Select Permanent Employee *
            </label>
            <Input
              type="text"
              size="sm"
              placeholder="Search by Employee ID or Name..."
              value={employeeSearch}
              onChange={(e) => setEmployeeSearch(e.target.value)}
              className="text-xs"
            />
            <Select
              size="md"
              value={selectedEmployeeId}
              onChange={(e) => setSelectedEmployeeId(e.target.value)}
              disabled={isLoadingEmployees}
            >
              <option value="">— Choose a permanent employee ({eligibleEmployees.length} eligible) —</option>
              {eligibleEmployees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.employee_code} — {emp.employee_name} ({emp.employee_category})
                </option>
              ))}
            </Select>
            {employeePagination.totalPages > 1 && (
              <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                <span>
                  Page {employeePagination.page} of {employeePagination.totalPages} ({employeePagination.totalItems} total)
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    aria-label="Previous employee page"
                    disabled={employeePage <= 1 || isLoadingEmployees}
                    onClick={() => setEmployeePage((p) => Math.max(1, p - 1))}
                    className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed border border-white/10 text-xs"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    aria-label="Next employee page"
                    disabled={employeePage >= employeePagination.totalPages || isLoadingEmployees}
                    onClick={() => setEmployeePage((p) => p + 1)}
                    className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed border border-white/10 text-xs"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
            <p className="text-[10px] text-slate-500 italic">
              Casual and local daily-wage workers are excluded per company policy.
            </p>
          </div>

          {selectedEmployee && (
            <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10 flex flex-col justify-center space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  Active Directory Profile
                </span>
                <Badge variant={selectedEmployee.active_status === 'Active' ? 'success' : 'neutral'}>
                  {selectedEmployee.active_status}
                </Badge>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-mono font-bold text-emerald-400 text-sm">{selectedEmployee.employee_code}</span>
                <span className="font-semibold text-white text-sm">{selectedEmployee.employee_name}</span>
              </div>
              <div className="text-xs text-slate-300">
                Permanent Category: <strong className="text-amber-400">{selectedEmployee.employee_category}</strong>
              </div>
            </div>
          )}
        </div>

        {selectedEmployee && !PERMANENT_CATEGORIES.has(selectedEmployee.employee_category) && (
          <div className="mt-4 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-center gap-3">
            <svg className="w-5 h-5 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className="font-bold">Ineligible Category</p>
              <p className="text-slate-400">
                "{selectedEmployee.employee_category}" cannot have a permanent employee pay structure. Only permanent staff and permanent factory/project workers are eligible.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      {!selectedEmployeeId ? (
        <div className="glass-card p-16 text-center border border-white/10 rounded-2xl bg-slate-900/40 backdrop-blur-xl">
          <div className="inline-flex p-4 rounded-full bg-white/5 text-slate-400 mb-3">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-base font-bold text-white">Select a Permanent Employee</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            Choose an employee from the dropdown above to view approved compensation terms or configure a new pay structure revision.
          </p>
        </div>
      ) : selectedEmployee && !PERMANENT_CATEGORIES.has(selectedEmployee.employee_category) ? null : isLoadingPay ? (
        <div className="grid grid-cols-1 gap-6">
          <SkeletonCard />
        </div>
      ) : isPayError ? (
        <div className="glass-card p-12 text-center border border-red-500/20 rounded-2xl bg-slate-900/60">
          <h3 className="text-base font-bold text-red-400">Failed to load pay structure details</h3>
          <p className="text-xs text-slate-400 mt-1">{payFetchError?.response?.data?.message || payFetchError?.message}</p>
          <Button variant="glass" size="sm" onClick={() => refetchPay()} className="mt-4">
            Retry
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Active Pay Structure Card */}
          {activeStructure ? (
            <div className="glass-card p-6 border border-emerald-500/30 rounded-2xl bg-slate-900/60 backdrop-blur-xl shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/10">
                <div className="flex items-center gap-3">
                  <span className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-extrabold text-white">Current Active Pay Structure</h3>
                      <Badge variant="success">Active Revision #{activeStructure.revision_number}</Badge>
                    </div>
                    <p className="text-xs text-slate-400">Approved and authoritative monthly compensation terms.</p>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">
                    Guaranteed Monthly Gross
                  </span>
                  <span className="text-2xl font-black text-emerald-400 font-mono">
                    {formatINR(activeStructure.guaranteed_monthly_gross)}
                  </span>
                </div>
              </div>

              {/* 11 Fields Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 pt-4 text-xs">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    1. Employee ID
                  </span>
                  <span className="font-mono text-white font-bold">{selectedEmployee.employee_code}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    2. Employee Name
                  </span>
                  <span className="text-white font-medium">{selectedEmployee.employee_name}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    3. Permanent Employee Category
                  </span>
                  <span className="text-amber-400 font-medium">{selectedEmployee.employee_category}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    4. Pay Basis
                  </span>
                  <span className="text-indigo-300 font-semibold">{activeStructure.pay_basis}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    5. Guaranteed Monthly Gross (₹)
                  </span>
                  <span className="font-mono text-emerald-400 font-bold">{formatINR(activeStructure.guaranteed_monthly_gross)}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    6. Basic Salary (₹/month)
                  </span>
                  <span className="font-mono text-slate-200">{formatINR(activeStructure.basic_salary)}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    7. Staff Welfare (₹/month)
                  </span>
                  <span className="font-mono text-slate-200">{formatINR(activeStructure.staff_welfare)}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    8. Other Fixed Components (₹/month)
                  </span>
                  <span className="font-mono text-slate-200">{formatINR(activeStructure.other_fixed_components)}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    9. EPF Enrolment
                  </span>
                  <Badge variant={activeStructure.epf_enrolment ? 'primary' : 'neutral'}>
                    {activeStructure.epf_enrolment ? 'Enrolled' : 'Not Enrolled'}
                  </Badge>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    10. ESI Enrolment
                  </span>
                  <Badge variant={activeStructure.esi_enrolment ? 'primary' : 'neutral'}>
                    {activeStructure.esi_enrolment ? 'Enrolled' : 'Not Enrolled'}
                  </Badge>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    11. Pay Structure Status
                  </span>
                  <Badge variant="success">{activeStructure.status}</Badge>
                </div>
              </div>
            </div>
          ) : (
            <div className="glass-card p-8 text-center border border-white/10 rounded-2xl bg-slate-900/60">
              <h3 className="text-base font-bold text-white">No Active Pay Structure</h3>
              <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                This permanent employee does not currently have an approved active pay structure.
              </p>
              {!draftStructure && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleOpenNewRevision}
                  className="mt-4"
                >
                  Configure Initial Pay Structure
                </Button>
              )}
            </div>
          )}

          {/* Pending Draft Banner (if any) */}
          {draftStructure && (
            <div className="glass-card p-6 border border-amber-500/30 rounded-2xl bg-amber-950/20 backdrop-blur-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/25">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-bold text-white">Pending Draft Revision #{draftStructure.revision_number}</h4>
                    <Badge variant="warning">Draft</Badge>
                  </div>
                  <p className="text-xs text-slate-400">
                    Gross: <strong className="text-emerald-400 font-mono">{formatINR(draftStructure.guaranteed_monthly_gross)}</strong> ({draftStructure.pay_basis})
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <Button
                  variant="glass"
                  size="sm"
                  onClick={() => handleOpenEditDraft(draftStructure)}
                >
                  Edit Draft
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => activateMutation.mutate(draftStructure.id)}
                  disabled={activateMutation.isPending}
                  className="bg-emerald-600 hover:bg-emerald-500"
                >
                  {activateMutation.isPending ? 'Activating...' : 'Activate Revision'}
                </Button>
              </div>
            </div>
          )}

          {/* Historical Revisions Table */}
          {revisions.length > 0 && (
            <div className="glass-card border border-white/10 rounded-2xl bg-slate-900/60 backdrop-blur-xl overflow-hidden shadow-2xl">
              <div className="p-4 border-b border-white/10 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                    Revision History & Prior Agreements
                  </h4>
                  <p className="text-[11px] text-slate-400">Audit trail of all recorded compensation revisions.</p>
                </div>
                <span className="text-xs text-slate-400 font-mono">{revisions.length} total revision(s)</span>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableCell isHeader>Revision</TableCell>
                    <TableCell isHeader>Pay Basis</TableCell>
                    <TableCell isHeader>Guaranteed Gross</TableCell>
                    <TableCell isHeader>Basic Salary</TableCell>
                    <TableCell isHeader>Staff Welfare</TableCell>
                    <TableCell isHeader>Other Fixed</TableCell>
                    <TableCell isHeader>EPF / ESI</TableCell>
                    <TableCell isHeader>Status</TableCell>
                    <TableCell isHeader>Updated Date</TableCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {revisions.map((rev) => (
                    <TableRow key={rev.id} hover>
                      <TableCell className="font-mono font-bold text-white">
                        Rev #{rev.revision_number}
                      </TableCell>
                      <TableCell className="text-slate-300">
                        {rev.pay_basis}
                      </TableCell>
                      <TableCell className="font-mono font-bold text-emerald-400">
                        {formatINR(rev.guaranteed_monthly_gross)}
                      </TableCell>
                      <TableCell className="font-mono text-slate-300">
                        {formatINR(rev.basic_salary)}
                      </TableCell>
                      <TableCell className="font-mono text-slate-300">
                        {formatINR(rev.staff_welfare)}
                      </TableCell>
                      <TableCell className="font-mono text-slate-300">
                        {formatINR(rev.other_fixed_components)}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${rev.epf_enrolment ? 'bg-indigo-500/20 text-indigo-300' : 'bg-white/5 text-slate-500'}`}>
                            EPF
                          </span>
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${rev.esi_enrolment ? 'bg-indigo-500/20 text-indigo-300' : 'bg-white/5 text-slate-500'}`}>
                            ESI
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {rev.status === 'Active' ? (
                          <Badge variant="success">Active</Badge>
                        ) : rev.status === 'Draft' ? (
                          <Badge variant="warning">Draft</Badge>
                        ) : (
                          <Badge variant="neutral">Superseded</Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-slate-400 text-xs">
                        {new Date(rev.updated_at).toLocaleDateString('en-IN')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      {/* Pay Structure Form Modal */}
      <Modal
        isOpen={isFormModalOpen}
        onClose={() => setIsFormModalOpen(false)}
        title={isEditingDraft ? 'Edit Draft Pay Structure' : 'Configure Pay Structure Revision'}
        size="lg"
      >
        <form onSubmit={handleSubmitForm} className="space-y-5">
          {/* Read-only Employee Header */}
          {selectedEmployee && (
            <div className="p-3 bg-white/5 rounded-xl border border-white/10 grid grid-cols-3 gap-2 text-xs">
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">1. Employee ID</span>
                <span className="font-mono font-bold text-emerald-400">{selectedEmployee.employee_code}</span>
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">2. Employee Name</span>
                <span className="font-semibold text-white truncate block">{selectedEmployee.employee_name}</span>
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">3. Permanent Employee Category</span>
                <span className="font-medium text-amber-400 truncate block">{selectedEmployee.employee_category}</span>
              </div>
            </div>
          )}

          {/* Pay Basis & Gross */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                4. Pay Basis *
              </label>
              <Select
                value={form.pay_basis}
                onChange={(e) => setForm({ ...form, pay_basis: e.target.value })}
              >
                {PAY_BASES.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                5. Guaranteed Monthly Gross (₹) *
              </label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g. 45000"
                value={form.guaranteed_monthly_gross}
                onChange={(e) => setForm({ ...form, guaranteed_monthly_gross: e.target.value })}
                error={formErrors.guaranteed_monthly_gross}
                required
              />
            </div>
          </div>

          {/* Fixed Components Section */}
          <div className="p-4 rounded-xl bg-slate-950/60 border border-white/10 space-y-4">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">
              Fixed Component Breakdown (₹/month)
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Input
                  label="6. Basic Salary (₹/month)"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Optional"
                  value={form.basic_salary}
                  onChange={(e) => setForm({ ...form, basic_salary: e.target.value })}
                />
              </div>

              <div>
                <Input
                  label="7. Staff Welfare (₹/month)"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Optional"
                  value={form.staff_welfare}
                  onChange={(e) => setForm({ ...form, staff_welfare: e.target.value })}
                />
              </div>

              <div>
                <Input
                  label="8. Other Fixed Components (₹/month)"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Optional"
                  value={form.other_fixed_components}
                  onChange={(e) => setForm({ ...form, other_fixed_components: e.target.value })}
                />
              </div>
            </div>

            {/* Reconciliation summary indicator */}
            <div className={`p-3 rounded-lg border text-xs flex items-center justify-between ${
              reconciliation.isExceeded
                ? 'bg-red-500/10 border-red-500/30 text-red-400'
                : 'bg-white/5 border-white/10 text-slate-300'
            }`}>
              <span>Total Fixed Components: <strong className="font-mono">{formatINR(reconciliation.totalComponents)}</strong></span>
              {reconciliation.isExceeded ? (
                <span className="font-bold">Exceeds Gross by {formatINR(Math.abs(reconciliation.difference))}!</span>
              ) : (
                <span className="text-slate-400">Balance: <strong className="font-mono">{formatINR(reconciliation.difference)}</strong></span>
              )}
            </div>
          </div>

          {/* Statutory Enrolments */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-3.5 rounded-xl bg-white/5 border border-white/10 flex items-center gap-3">
              <Checkbox
                checked={form.epf_enrolment}
                onChange={(e) => setForm({ ...form, epf_enrolment: e.target.checked })}
                id="epf-check"
              />
              <label htmlFor="epf-check" className="cursor-pointer">
                <span className="block text-xs font-bold text-white">9. EPF Enrolment</span>
                <span className="block text-[11px] text-slate-400">Record Employee Provident Fund enrolment</span>
              </label>
            </div>

            <div className="p-3.5 rounded-xl bg-white/5 border border-white/10 flex items-center gap-3">
              <Checkbox
                checked={form.esi_enrolment}
                onChange={(e) => setForm({ ...form, esi_enrolment: e.target.checked })}
                id="esi-check"
              />
              <label htmlFor="esi-check" className="cursor-pointer">
                <span className="block text-xs font-bold text-white">10. ESI Enrolment</span>
                <span className="block text-[11px] text-slate-400">Record Employee State Insurance enrolment</span>
              </label>
            </div>
          </div>

          {/* Initial Status */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
              11. Pay Structure Status *
            </label>
            <Select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              <option value="Draft">Draft (Save for review, does not replace active)</option>
              <option value="Active">Active (Save and immediately activate revision)</option>
            </Select>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10">
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={() => setIsFormModalOpen(false)}
              disabled={createMutation.isPending || updateDraftMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={reconciliation.isExceeded || createMutation.isPending || updateDraftMutation.isPending}
            >
              {createMutation.isPending || updateDraftMutation.isPending
                ? 'Saving...'
                : isEditingDraft
                ? 'Update Draft'
                : 'Save Pay Structure'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Notifications */}
      {successMsg && (
        <SuccessPopup
          message={successMsg}
          onClose={() => setSuccessMsg('')}
        />
      )}
      {errorMsg && (
        <ErrorPopup
          message={errorMsg}
          onClose={() => setErrorMsg('')}
        />
      )}
    </div>
  );
}
