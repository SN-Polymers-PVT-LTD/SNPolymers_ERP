import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Input,
  Select,
  Badge,
  Modal,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableCell,
  SkeletonTable,
  Pagination,
  SuccessPopup,
  ErrorPopup
} from '../../components/ui';
import {
  getEmployees,
  getErpUsers,
  createEmployee,
  updateEmployee,
  updateEmployeeStatus
} from '../../api/hrEmployeesApi';
import {
  CATEGORIES,
  PERMANENT_CATEGORIES,
  DEPARTMENTS,
  STATUS_OPTIONS,
  ERP_ROLES
} from './employeeConstants';
import { exportEmployeesToExcel } from '../../utils/exportHelpers';

const INITIAL_FORM = {
  employee_name: '',
  employee_category: CATEGORIES[0],
  department: DEPARTMENTS[0],
  contact_number: '',
  erp_role: '',
  erp_user_id: '',
  joining_date: new Date().toISOString().split('T')[0],
  active_status: 'Active'
};

export default function EmployeeMaster({ onNavigateToPayStructure }) {
  const queryClient = useQueryClient();

  // URL / Filter State
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const limit = 15;

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [inspectingEmployee, setInspectingEmployee] = useState(null);
  const [form, setForm] = useState(INITIAL_FORM);
  const [formErrors, setFormErrors] = useState({});


  // Status Action Modal
  const [statusModalEmployee, setStatusModalEmployee] = useState(null);
  const [targetStatus, setTargetStatus] = useState('Inactive');

  // Popups
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isExporting, setIsExporting] = useState(false);

  // Export full filtered/unfiltered employee directory to Excel
  const handleExportExcel = async () => {
    try {
      setIsExporting(true);
      const params = { page: 1, limit: 1000 };
      if (debouncedSearch) params.search = debouncedSearch;
      if (categoryFilter) params.employee_category = categoryFilter;
      if (statusFilter) params.active_status = statusFilter;

      const firstRes = await getEmployees(params);
      const allEmps = [...(firstRes.data?.employees || [])];
      const totalPages = firstRes.data?.pagination?.totalPages || 1;

      for (let p = 2; p <= totalPages; p++) {
        const nextRes = await getEmployees({ ...params, page: p });
        allEmps.push(...(nextRes.data?.employees || []));
      }

      await exportEmployeesToExcel(allEmps);
      setSuccessMsg('Employee Master exported to Excel successfully.');
    } catch (err) {
      console.error('Failed to export employee master:', err);
      setErrorMsg(err.message || 'Failed to export Employee Master.');
    } finally {
      setIsExporting(false);
    }
  };

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Fetch Directory
  const {
    data: directoryData,
    isLoading,
    isError,
    error: fetchError,
    refetch
  } = useQuery({
    queryKey: ['hr-employees', page, limit, debouncedSearch, categoryFilter, statusFilter],
    queryFn: async () => {
      const params = { page, limit };
      if (debouncedSearch) params.search = debouncedSearch;
      if (categoryFilter) params.employee_category = categoryFilter;
      if (statusFilter) params.active_status = statusFilter;
      const res = await getEmployees(params);
      return res.data;
    }
  });

  const employees = directoryData?.employees || [];
  const pagination = directoryData?.pagination || { page: 1, totalPages: 1, totalItems: 0 };

  const [erpUserPage, setErpUserPage] = useState(1);
  const [loadedErpUsersMap, setLoadedErpUsersMap] = useState({});

  useEffect(() => {
    setLoadedErpUsersMap({});
    setErpUserPage(1);
  }, [form.erp_role]);

  // Fetch ERP Users when role changes in modal
  const {
    data: erpUsersResp,
    isLoading: isLoadingUsers
  } = useQuery({
    queryKey: ['hr-erp-users', form.erp_role, erpUserPage],
    queryFn: async () => {
      const params = { page: erpUserPage, limit: 50 };
      if (form.erp_role) params.role = form.erp_role;
      const res = await getErpUsers(params);
      return res.data;
    },
    enabled: isModalOpen && Boolean(form.erp_role)
  });

  const erpUsersPagination = erpUsersResp?.pagination || { page: erpUserPage, totalPages: 1, totalItems: 0 };

  useEffect(() => {
    const raw = erpUsersResp?.users || [];
    if (raw.length > 0) {
      setLoadedErpUsersMap((prev) => {
        const next = { ...prev };
        raw.forEach((u) => {
          next[u.id] = u;
        });
        return next;
      });
    }
  }, [erpUsersResp]);

  const availableErpUsers = useMemo(() => {
    const map = new Map();
    // 1. Add all accumulated users from visited pages
    Object.values(loadedErpUsersMap).forEach((u) => map.set(u.id, u));
    // 2. Add current response immediately to avoid 1-render lag
    (erpUsersResp?.users || []).forEach((u) => map.set(u.id, u));
    // 3. Preserve editing employee's currently linked ERP user if available
    if (editingEmployee?.erp_user) {
      map.set(editingEmployee.erp_user.id, {
        id: editingEmployee.erp_user.id,
        display_name: editingEmployee.erp_user.display_name,
        role: editingEmployee.erp_user.role,
        mobile_number: editingEmployee.contact_number || ''
      });
    }
    return Array.from(map.values());
  }, [erpUsersResp, loadedErpUsersMap, editingEmployee]);

  // Open Add Modal
  const handleOpenAdd = () => {
    setEditingEmployee(null);
    setForm(INITIAL_FORM);
    setErpUserPage(1);
    setLoadedErpUsersMap({});
    setFormErrors({});
    setIsModalOpen(true);
  };

  // Open Edit Modal
  const handleOpenEdit = (emp) => {
    setEditingEmployee(emp);
    setForm({
      employee_name: emp.employee_name || '',
      employee_category: emp.employee_category || CATEGORIES[0],
      department: emp.department || DEPARTMENTS[0],
      contact_number: emp.contact_number || '',
      erp_role: emp.erp_user?.role || '',
      erp_user_id: emp.erp_user_id || '',
      joining_date: emp.joining_date || '',
      active_status: emp.active_status || 'Active'
    });
    setErpUserPage(1);
    setLoadedErpUsersMap({});
    setFormErrors({});
    setIsModalOpen(true);
  };

  // Save Mutation
  const saveMutation = useMutation({
    mutationFn: async (payload) => {
      if (editingEmployee) {
        return updateEmployee(editingEmployee.id, payload);
      }
      return createEmployee(payload);
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['hr-employees'] });
      setIsModalOpen(false);
      setSuccessMsg(
        editingEmployee
          ? `Employee ${res.data.employee.employee_code} updated successfully.`
          : `Employee ${res.data.employee.employee_code} created successfully.`
      );
    },
    onError: (err) => {
      const msg = err.response?.data?.message || err.message || 'Operation failed.';
      setErrorMsg(msg);
    }
  });

  // Status Change Mutation
  const statusMutation = useMutation({
    mutationFn: async ({ id, status }) => {
      return updateEmployeeStatus(id, status);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr-employees'] });
      setStatusModalEmployee(null);
      setSuccessMsg('Employee status updated successfully.');
    },
    onError: (err) => {
      const msg = err.response?.data?.message || err.message || 'Status update failed.';
      setErrorMsg(msg);
    }
  });

  const handleContactNumberChange = (e) => {
    let val = e.target.value;
    // Allow digits, leading '+', spaces, and hyphens
    val = val.replace(/[^\d+\s-]/g, '');
    // Ensure '+' can only be at the very start
    if (val.indexOf('+') > 0) {
      val = val[0] + val.slice(1).replace(/\+/g, '');
    }
    setForm((prev) => ({ ...prev, contact_number: val }));
    if (formErrors.contact_number) {
      setFormErrors((prev) => ({ ...prev, contact_number: '' }));
    }
  };

  // Validate and submit modal form
  const handleFormSubmit = (e) => {
    e.preventDefault();
    const errors = {};

    if (!form.employee_name.trim()) {
      errors.employee_name = 'Employee name is required.';
    }
    if (!form.employee_category) {
      errors.employee_category = 'Category is required.';
    }
    if (!form.department) {
      errors.department = 'Department is required.';
    }
    if (!form.joining_date) {
      errors.joining_date = 'Joining date is required.';
    }
    if (form.contact_number && form.contact_number.trim()) {
      const raw = form.contact_number.trim();
      const digits = raw.replace(/\D/g, '');
      const core10 = (digits.startsWith('91') && digits.length === 12)
        ? digits.slice(2)
        : (digits.startsWith('0') && digits.length === 11)
          ? digits.slice(1)
          : digits;

      if (core10.length !== 10 || !/^[6-9]\d{9}$/.test(core10)) {
        errors.contact_number = 'Please enter a valid 10-digit mobile number (e.g. +91 98765 43210 or 9876543210).';
      }
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    const payload = {
      employee_name: form.employee_name.trim(),
      employee_category: form.employee_category,
      department: form.department,
      contact_number: form.contact_number.trim() ? form.contact_number.trim() : null,
      erp_user_id: form.erp_user_id ? form.erp_user_id : null,
      joining_date: form.joining_date,
      active_status: form.active_status
    };

    saveMutation.mutate(payload);
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'Active':
        return <Badge variant="success">Active</Badge>;
      case 'Inactive':
        return <Badge variant="warning">Inactive</Badge>;
      case 'Exited':
        return <Badge variant="danger">Exited</Badge>;
      default:
        return <Badge variant="neutral">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Controls Card */}
      <div className="glass-card p-6 border border-white/10 rounded-2xl bg-slate-900/60 backdrop-blur-xl shadow-2xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-white/10">
          <div>
            <h2 className="text-xl font-extrabold text-white tracking-wide">
              Employee & Worker Master
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Company-wide employee identity, workforce classification, and ERP link directory.
            </p>
          </div>
          <div className="flex items-center gap-3 self-start md:self-auto">
            <Button
              variant="ghost"
              size="md"
              onClick={handleExportExcel}
              disabled={isExporting}
              className="flex items-center gap-2 border border-white/10 hover:border-white/20 text-slate-300 hover:text-white"
              title="Export Employee Master to Excel"
            >
              <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <span>{isExporting ? 'Exporting...' : 'Export Excel'}</span>
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={handleOpenAdd}
              className="flex items-center gap-2 shadow-lg shadow-emerald-500/20"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
              Add Employee
            </Button>
          </div>
        </div>

        {/* Filter Toolbar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-6">
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
              Search Directory
            </label>
            <div className="relative">
              <Input
                type="text"
                placeholder="Search by ID (EMP-1) or Name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                size="sm"
                className="pl-9"
              />
              <svg
                className="w-4 h-4 absolute left-3 top-2.5 text-slate-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
              Employee Category
            </label>
            <Select
              size="sm"
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All Categories</option>
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
              Active Status
            </label>
            <Select
              size="sm"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All Statuses</option>
              {STATUS_OPTIONS.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex items-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch('');
                setDebouncedSearch('');
                setCategoryFilter('');
                setStatusFilter('');
                setPage(1);
              }}
              className="w-full text-slate-400 hover:text-white"
            >
              Reset Filters
            </Button>
          </div>
        </div>
      </div>

      {/* Directory Table Card */}
      <div className="glass-card border border-white/10 rounded-2xl bg-slate-900/60 backdrop-blur-xl overflow-hidden shadow-2xl">
        {isLoading ? (
          <div className="p-6">
            <SkeletonTable rows={8} columns={9} />
          </div>
        ) : isError ? (
          <div className="p-12 text-center">
            <div className="inline-flex p-3 rounded-full bg-red-500/10 text-red-400 mb-3">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h3 className="text-base font-bold text-white">Failed to load employee directory</h3>
            <p className="text-xs text-slate-400 mt-1">{fetchError?.message || 'Server error occurred'}</p>
            <Button variant="glass" size="sm" onClick={() => refetch()} className="mt-4">
              Retry
            </Button>
          </div>
        ) : employees.length === 0 ? (
          <div className="p-16 text-center">
            <div className="inline-flex p-4 rounded-full bg-white/5 text-slate-400 mb-3">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <h3 className="text-base font-bold text-white">No employees found</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              {debouncedSearch || categoryFilter || statusFilter
                ? 'Try adjusting your search criteria or clearing filters.'
                : 'Get started by creating the first employee record.'}
            </p>
            {!debouncedSearch && !categoryFilter && !statusFilter && (
              <Button variant="primary" size="sm" onClick={handleOpenAdd} className="mt-4">
                Add First Employee
              </Button>
            )}
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableCell isHeader>Employee ID</TableCell>
                  <TableCell isHeader>Employee Name</TableCell>
                  <TableCell isHeader>Employee Category</TableCell>
                  <TableCell isHeader>Department / Function</TableCell>
                  <TableCell isHeader>Contact Number</TableCell>
                  <TableCell isHeader>Existing ERP Role</TableCell>
                  <TableCell isHeader>Existing ERP Account</TableCell>
                  <TableCell isHeader>Joining Date</TableCell>
                  <TableCell isHeader>Active Status</TableCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.map((emp) => {
                  const erpUser = emp.erp_user;
                  return (
                    <TableRow
                      key={emp.id}
                      hover
                      interactive
                      onClick={() => setInspectingEmployee(emp)}
                      className="cursor-pointer"
                      title="Click to view employee details and actions"
                    >
                      <TableCell className="font-mono font-bold text-emerald-400 whitespace-nowrap">
                        {emp.employee_code}
                      </TableCell>
                      <TableCell className="font-semibold text-white whitespace-nowrap">
                        {emp.employee_name}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-slate-300">
                        {emp.employee_category}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-slate-300">
                        {emp.department}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-slate-400">
                        {emp.contact_number || '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {erpUser?.role ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                            {erpUser.role}
                          </span>
                        ) : (
                          <span className="text-slate-500 text-[11px] italic">No ERP account</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {erpUser ? (
                          <span className="font-medium text-slate-200 text-xs">
                            {erpUser.display_name || 'ERP User'}
                          </span>
                        ) : (
                          <span className="text-slate-500 text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-slate-400 text-xs">
                        {emp.joining_date}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <div className="flex items-center justify-between gap-2">
                          {getStatusBadge(emp.active_status)}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setInspectingEmployee(emp);
                            }}
                            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                            title="Inspect & Actions"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                            </svg>
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            {/* Pagination */}
            {pagination.totalPages > 1 && (
              <div className="p-4 border-t border-white/5">
                <Pagination
                  currentPage={pagination.page}
                  totalPages={pagination.totalPages}
                  onPageChange={(newPage) => setPage(newPage)}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Add / Edit Employee Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingEmployee ? `Edit Employee (${editingEmployee.employee_code})` : 'Add New Employee'}
        size="lg"
      >
        <form onSubmit={handleFormSubmit} className="space-y-5">
          {editingEmployee && (
            <div className="p-3 bg-white/5 rounded-xl border border-white/10 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400">System Employee ID:</span>
              <span className="font-mono font-bold text-emerald-400 text-sm">{editingEmployee.employee_code}</span>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
              Employee Full Name *
            </label>
            <Input
              type="text"
              placeholder="e.g. Ramesh Chandra Sen"
              value={form.employee_name}
              onChange={(e) => setForm({ ...form, employee_name: e.target.value })}
              error={formErrors.employee_name}
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                Employee Category *
              </label>
              <Select
                value={form.employee_category}
                onChange={(e) => setForm({ ...form, employee_category: e.target.value })}
                error={formErrors.employee_category}
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                Department / Function *
              </label>
              <Select
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
                error={formErrors.department}
              >
                {DEPARTMENTS.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                Contact Number (Optional)
              </label>
              <Input
                type="tel"
                placeholder="+91 98765 43210"
                maxLength={16}
                value={form.contact_number}
                onChange={handleContactNumberChange}
                error={formErrors.contact_number}
                helperText={!formErrors.contact_number ? '10-digit Indian mobile number with optional +91 prefix' : undefined}
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                Joining Date *
              </label>
              <Input
                type="date"
                value={form.joining_date}
                onChange={(e) => setForm({ ...form, joining_date: e.target.value })}
                error={formErrors.joining_date}
                required
              />
            </div>
          </div>

          {/* ERP Account Link Section */}
          <div className="p-4 rounded-xl bg-slate-950/60 border border-white/10 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                  ERP Account Linking (Optional)
                </h4>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Link this employee record to an existing ERP user login.
                </p>
              </div>
              {form.erp_user_id && (
                <button
                  type="button"
                  onClick={() => setForm({ ...form, erp_user_id: '', erp_role: '' })}
                  className="text-[11px] text-red-400 hover:text-red-300 underline font-semibold"
                >
                  Unlink Account
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Select
                  label="Filter by ERP Role"
                  value={form.erp_role}
                  onChange={(e) => {
                    const nextRole = e.target.value;
                    setForm({ ...form, erp_role: nextRole, erp_user_id: '' });
                  }}
                >
                  <option value="">No ERP account / All Roles</option>
                  {ERP_ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                {isLoadingUsers ? (
                  <div className="h-10 rounded-xl bg-white/5 animate-pulse mt-6" />
                ) : (
                  <>
                    <Select
                      label="Select ERP Account"
                      value={form.erp_user_id}
                      onChange={(e) => setForm({ ...form, erp_user_id: e.target.value })}
                      disabled={!form.erp_role && availableErpUsers.length === 0}
                    >
                      <option value="">— Unlinked / None —</option>
                      {availableErpUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.display_name || 'User'} {u.mobile_number ? `(${u.mobile_number})` : ''} [{u.role?.toUpperCase() || ''}]
                        </option>
                      ))}
                    </Select>
                    {erpUsersPagination.totalPages > 1 && (
                      <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                        <span>
                          Page {erpUsersPagination.page} of {erpUsersPagination.totalPages} ({erpUsersPagination.totalItems} accounts)
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            aria-label="Previous ERP account page"
                            disabled={erpUserPage <= 1 || isLoadingUsers}
                            onClick={() => setErpUserPage((p) => Math.max(1, p - 1))}
                            className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed border border-white/10 text-xs"
                          >
                            Previous
                          </button>
                          <button
                            type="button"
                            aria-label="Next ERP account page"
                            disabled={erpUserPage >= erpUsersPagination.totalPages || isLoadingUsers}
                            onClick={() => setErpUserPage((p) => p + 1)}
                            className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed border border-white/10 text-xs"
                          >
                            Next
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
              Active Status *
            </label>
            <Select
              value={form.active_status}
              onChange={(e) => setForm({ ...form, active_status: e.target.value })}
            >
              {STATUS_OPTIONS.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10">
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={() => setIsModalOpen(false)}
              disabled={saveMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? 'Saving...' : editingEmployee ? 'Save Changes' : 'Create Employee'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Employee Details / Inspection Modal */}
      <Modal
        isOpen={Boolean(inspectingEmployee)}
        onClose={() => setInspectingEmployee(null)}
        title={`Employee Details — ${inspectingEmployee?.employee_code}`}
        size="md"
      >
        {inspectingEmployee && (
          <div className="space-y-5">
            <div className="p-4 rounded-xl bg-slate-950/60 border border-white/10 space-y-3">
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div>
                  <span className="font-mono font-bold text-emerald-400 text-sm">{inspectingEmployee.employee_code}</span>
                  <h3 className="text-base font-bold text-white">{inspectingEmployee.employee_name}</h3>
                </div>
                {getStatusBadge(inspectingEmployee.active_status)}
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Category</span>
                  <span className="text-slate-200 font-medium">{inspectingEmployee.employee_category}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Department / Function</span>
                  <span className="text-slate-200 font-medium">{inspectingEmployee.department}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Contact Number</span>
                  <span className="font-mono text-slate-300">{inspectingEmployee.contact_number || '—'}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Joining Date</span>
                  <span className="font-mono text-slate-300">{inspectingEmployee.joining_date}</span>
                </div>
              </div>

              <div className="pt-3 border-t border-white/10 text-xs">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                  Existing ERP Account
                </span>
                {inspectingEmployee.erp_user ? (
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white">{inspectingEmployee.erp_user.display_name}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                      {inspectingEmployee.erp_user.role}
                    </span>
                  </div>
                ) : (
                  <span className="text-slate-500 italic">No ERP account linked</span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-white/10">
              <div>
                {PERMANENT_CATEGORIES.has(inspectingEmployee.employee_category) && onNavigateToPayStructure && (
                  <Button
                    variant="glass"
                    size="sm"
                    onClick={() => {
                      const empId = inspectingEmployee.id;
                      setInspectingEmployee(null);
                      onNavigateToPayStructure(empId);
                    }}
                    className="text-amber-400 hover:text-amber-300 border-amber-500/20 text-xs"
                  >
                    Maintain Pay Structure
                  </Button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="glass"
                  size="sm"
                  onClick={() => {
                    const emp = inspectingEmployee;
                    setInspectingEmployee(null);
                    setStatusModalEmployee(emp);
                    setTargetStatus(emp.active_status === 'Active' ? 'Inactive' : 'Active');
                  }}
                  className="text-xs"
                >
                  Change Status
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    const emp = inspectingEmployee;
                    setInspectingEmployee(null);
                    handleOpenEdit(emp);
                  }}
                  className="text-xs"
                >
                  Edit Employee
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Quick Status Modal */}
      <Modal
        isOpen={Boolean(statusModalEmployee)}
        onClose={() => setStatusModalEmployee(null)}
        title={`Change Status — ${statusModalEmployee?.employee_code}`}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-300">
            Update status for <strong className="text-white">{statusModalEmployee?.employee_name}</strong>:
          </p>

          <Select
            value={targetStatus}
            onChange={(e) => setTargetStatus(e.target.value)}
          >
            {STATUS_OPTIONS.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </Select>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setStatusModalEmployee(null)}
              disabled={statusMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                if (statusModalEmployee) {
                  statusMutation.mutate({
                    id: statusModalEmployee.id,
                    status: targetStatus
                  });
                }
              }}
              disabled={statusMutation.isPending}
            >
              {statusMutation.isPending ? 'Updating...' : 'Update Status'}
            </Button>
          </div>
        </div>
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
