import React, { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Input, Select, Button, Badge, Modal, TextArea, Pagination } from '../../components/ui';
import { getSelfServiceLeaveQueue, decideSelfServiceLeave } from '../../api/hrLeavesApi';

const categories = ['HO Staff', 'Projects Department Employees'];
const statuses = ['Pending', 'Approved', 'Rejected'];

export default function SelfServiceLeaveQueue() {
  const [search, setSearch] = useSearchParams();

  const page = Math.max(1, Number(search.get('page')) || 1);
  const statusFilter = search.get('status') || 'Pending';
  const categoryFilter = search.get('employee_category') || '';
  const fromDateFilter = search.get('from_date') || '';
  const toDateFilter = search.get('to_date') || '';

  const [decisionModal, setDecisionModal] = useState(null); // active leave being decided
  const [decisionType, setDecisionType] = useState('Approved'); // 'Approved' | 'Rejected'
  const [payTreatment, setPayTreatment] = useState(''); // '' | 'Paid' | 'Unpaid'
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  const params = useMemo(() => {
    const p = { page, limit: 20 };
    if (statusFilter && statusFilter !== 'All') p.status = statusFilter;
    if (categoryFilter) p.employee_category = categoryFilter;
    if (fromDateFilter) p.from_date = fromDateFilter;
    if (toDateFilter) p.to_date = toDateFilter;
    return p;
  }, [page, statusFilter, categoryFilter, fromDateFilter, toDateFilter]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['hr-self-service-leave-queue', params],
    queryFn: () => getSelfServiceLeaveQueue(params).then(r => r.data),
    staleTime: 30000
  });

  const updateFilters = (k, v) => {
    const next = new URLSearchParams(search);
    if (v) next.set(k, v);
    else next.delete(k);
    next.delete('page'); // reset to page 1 on filter change
    setSearch(next);
  };

  const setPage = (p) => {
    const next = new URLSearchParams(search);
    next.set('page', String(p));
    setSearch(next);
  };

  const openDecisionModal = (leave, type) => {
    setDecisionModal(leave);
    setDecisionType(type);
    setPayTreatment(type === 'Rejected' ? 'Unpaid' : '');
    setRemarks('');
    setActionError('');
  };

  const closeDecisionModal = () => {
    setDecisionModal(null);
    setRemarks('');
    setPayTreatment('');
    setActionError('');
  };

  const handleDecisionSubmit = async (e) => {
    e.preventDefault();
    if (!decisionModal) return;
    setActionError('');

    if (decisionType === 'Approved' && !payTreatment) {
      setActionError('Please select whether this approved leave is Paid or Unpaid.');
      return;
    }
    if (decisionType === 'Rejected' && (!remarks || !remarks.trim())) {
      setActionError('Rejection remarks are required.');
      return;
    }

    try {
      setSubmitting(true);
      const payload = {
        decision: decisionType,
        pay_treatment: decisionType === 'Rejected' ? 'Unpaid' : payTreatment,
        remarks: remarks.trim() || undefined
      };

      const res = await decideSelfServiceLeave(decisionModal.id, payload);
      if (res.data?.success) {
        setActionSuccess(`Leave request for ${decisionModal.employee?.employee_name || 'employee'} marked as ${decisionType}.`);
        closeDecisionModal();
        refetch();
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.response?.data?.code || 'Failed to submit decision.';
      setActionError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status) => {
    if (status === 'Approved') return <Badge variant="emerald" showDot>Approved</Badge>;
    if (status === 'Rejected') return <Badge variant="red" showDot>Rejected</Badge>;
    return <Badge variant="amber" showDot pulseDot>Pending</Badge>;
  };

  const getPayBadge = (treatment) => {
    if (treatment === 'Paid') return <Badge variant="emerald" showDot={false}>Paid</Badge>;
    if (treatment === 'Unpaid') return <Badge variant="red" showDot={false}>Unpaid</Badge>;
    return <Badge variant="slate" showDot={false}>Pending</Badge>;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-5">
        <div>
          <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500">HO Administration</span>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-100 mt-1">
            HO & Projects Self-Service Leave Queue
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Review and decide leave requests submitted directly by eligible Head Office Staff and Projects employees.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => refetch()} className="text-xs">
            🔄 Refresh Queue
          </Button>
        </div>
      </div>

      {/* Global Action Messages */}
      {actionSuccess && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-xs font-semibold flex items-center justify-between">
          <span>{actionSuccess}</span>
          <button type="button" onClick={() => setActionSuccess('')} className="text-emerald-400 hover:text-emerald-200">✕</button>
        </div>
      )}

      {/* Filter Controls Bar */}
      <div className="p-4 bg-slate-900/60 border border-white/10 rounded-2xl backdrop-blur-sm grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 items-end">
        <div>
          <label className="block text-xs font-bold text-slate-300 mb-1.5">Review Status</label>
          <Select
            value={statusFilter}
            onChange={(e) => updateFilters('status', e.target.value)}
          >
            <option value="All">All Statuses</option>
            {statuses.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-300 mb-1.5">Employee Category</label>
          <Select
            value={categoryFilter}
            onChange={(e) => updateFilters('employee_category', e.target.value)}
          >
            <option value="">All Eligible Categories</option>
            {categories.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-300 mb-1.5">From Date (On or After)</label>
          <Input
            type="date"
            value={fromDateFilter}
            onChange={(e) => updateFilters('from_date', e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-300 mb-1.5">To Date (On or Before)</label>
          <Input
            type="date"
            value={toDateFilter}
            onChange={(e) => updateFilters('to_date', e.target.value)}
          />
        </div>
      </div>

      {/* Queue Content Table */}
      <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden backdrop-blur-sm">
        {isLoading ? (
          <div className="p-16 text-center text-slate-400 animate-pulse">
            <p className="text-sm font-medium">Loading self-service leave requests...</p>
          </div>
        ) : error ? (
          <div className="p-12 text-center text-red-400">
            <p className="text-sm font-bold">Failed to load leave queue.</p>
            <p className="text-xs text-slate-400 mt-1">{error.message || 'Check network connection or permissions.'}</p>
          </div>
        ) : (data?.requests || []).length === 0 ? (
          <div className="p-16 text-center text-slate-500 text-xs">
            No self-service leave requests found matching the current filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-white/5 border-b border-white/10 text-slate-400 text-[10px] tracking-wider uppercase">
                  <th className="py-3 px-3">Employee</th>
                  <th className="py-3 px-3">Category</th>
                  <th className="py-3 px-3">Date Range</th>
                  <th className="py-3 px-3">Leave Type</th>
                  <th className="py-3 px-3">Reason</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Pay Treatment</th>
                  <th className="py-3 px-3">Audit Details</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-slate-300">
                {data.requests.map(req => {
                  const isPending = req.approval_status === 'Pending';
                  const emp = req.employee;
                  const decidedByName = req.decided_by ? (data.actors[req.decided_by] || 'HO Reviewer') : null;

                  return (
                    <tr key={req.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-3 px-3">
                        <div className="font-semibold text-slate-100">{emp?.employee_name || 'Unknown'}</div>
                        <div className="font-mono text-[10px] text-amber-400/90">{emp?.employee_code || '-'}</div>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span className="font-medium text-slate-300">{req.employee_category}</span>
                        <div className="text-[10px] text-slate-500">{emp?.department}</div>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap font-medium text-slate-200">
                        {req.from_date} <span className="text-slate-500">&rarr;</span> {req.to_date}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">{req.leave_type}</td>
                      <td className="py-3 px-3 max-w-xs truncate" title={req.reason}>
                        {req.reason}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">{getStatusBadge(req.approval_status)}</td>
                      <td className="py-3 px-3 whitespace-nowrap">{getPayBadge(req.pay_treatment)}</td>
                      <td className="py-3 px-3 max-w-xs">
                        {req.approval_status !== 'Pending' ? (
                          <div className="text-[11px]">
                            {req.decision_remarks && (
                              <div className="text-slate-300 font-medium">"{req.decision_remarks}"</div>
                            )}
                            <div className="text-[10px] text-slate-500 mt-0.5">
                              Decided by {decidedByName} on {req.decided_at ? new Date(req.decided_at).toLocaleDateString() : '-'}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-600">-</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        {isPending ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              type="button"
                              variant="primary"
                              onClick={() => openDecisionModal(req, 'Approved')}
                              className="text-[11px] py-1 px-2.5 bg-emerald-600 hover:bg-emerald-500 text-white"
                            >
                              Approve
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => openDecisionModal(req, 'Rejected')}
                              className="text-[11px] py-1 px-2.5 text-red-400 hover:text-red-300"
                            >
                              Reject
                            </Button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-500 font-mono">
                            Decided
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        {data?.pagination && data.pagination.totalPages > 1 && (
          <div className="p-4 border-t border-white/5 flex items-center justify-between">
            <span className="text-xs text-slate-400">
              Showing page {data.pagination.page} of {data.pagination.totalPages} ({data.pagination.totalItems} total requests)
            </span>
            <Pagination
              currentPage={data.pagination.page}
              totalPages={data.pagination.totalPages}
              onPageChange={setPage}
            />
          </div>
        )}
      </div>

      {/* Decision Modal */}
      {decisionModal && (
        <Modal
          isOpen={true}
          onClose={closeDecisionModal}
          title={`${decisionType === 'Approved' ? 'Approve' : 'Reject'} Leave Request`}
          subtitle={`${decisionModal.employee?.employee_name} (${decisionModal.employee?.employee_code}) &bull; ${decisionModal.from_date} to ${decisionModal.to_date}`}
        >
          <form onSubmit={handleDecisionSubmit} className="space-y-4 text-xs">
            {actionError && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 font-semibold">
                {actionError}
              </div>
            )}

            <div className="p-3 bg-white/5 rounded-xl border border-white/10 space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-400">Category:</span>
                <span className="font-semibold text-slate-200">{decisionModal.employee_category}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Leave Type:</span>
                <span className="font-semibold text-slate-200">{decisionModal.leave_type}</span>
              </div>
              <div className="pt-1 text-slate-400">
                Reason: <span className="text-slate-200">{decisionModal.reason}</span>
              </div>
            </div>

            {decisionType === 'Approved' ? (
              <div>
                <label htmlFor="pay-treatment-select" className="block text-xs font-bold text-slate-300 mb-1.5">
                  Select Pay Treatment <span className="text-red-400">*</span>
                </label>
                <Select
                  id="pay-treatment-select"
                  value={payTreatment}
                  onChange={(e) => setPayTreatment(e.target.value)}
                  required
                >
                  <option value="">-- Choose Treatment --</option>
                  <option value="Paid">Paid Leave</option>
                  <option value="Unpaid">Unpaid Leave</option>
                </Select>
                <p className="text-[11px] text-slate-500 mt-1">
                  HO must explicitly determine whether this leave period is Paid or Unpaid.
                </p>
              </div>
            ) : (
              <div className="p-3 bg-red-500/10 rounded-xl border border-red-500/20 text-red-400 text-xs">
                <strong>Pay Treatment: Unpaid</strong>
                <p className="mt-0.5 text-[11px] text-red-400/80">
                  Rejected self-service leaves are deterministically recorded as Unpaid.
                </p>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">
                {decisionType === 'Rejected' ? 'Rejection Remarks (Required)' : 'Decision Remarks (Optional)'}
                {decisionType === 'Rejected' && <span className="text-red-400">*</span>}
              </label>
              <TextArea
                rows={3}
                placeholder={decisionType === 'Rejected' ? 'Provide mandatory explanation for rejection...' : 'Optional approval notes or conditions...'}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                required={decisionType === 'Rejected'}
                maxLength={2000}
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-white/10">
              <Button type="button" variant="secondary" onClick={closeDecisionModal} disabled={submitting}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={submitting || (decisionType === 'Approved' && !payTreatment)}
                className={decisionType === 'Rejected' ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-emerald-600 hover:bg-emerald-500 text-white'}
              >
                {submitting ? 'Submitting...' : `Confirm ${decisionType}`}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
