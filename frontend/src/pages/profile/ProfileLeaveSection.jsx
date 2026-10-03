import React, { useState, useEffect } from 'react';
import { Badge, Button, Input, Select, TextArea } from '../../components/ui';
import {
  getMyLeaveContext,
  getMyLeaveRequests,
  submitSelfServiceLeave,
  updateSelfServiceLeave
} from '../../api/hrLeavesApi';

export default function ProfileLeaveSection() {
  const [context, setContext] = useState(null);
  const [loadingContext, setLoadingContext] = useState(true);
  const [requests, setRequests] = useState([]);
  const [actors, setActors] = useState({});
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [contextError, setContextError] = useState('');
  const [requestsError, setRequestsError] = useState('');
  const [success, setSuccess] = useState('');

  // Form state
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    from_date: '',
    to_date: '',
    leave_type: 'Other Leave',
    reason: ''
  });

  const loadContext = async () => {
    try {
      setLoadingContext(true);
      setContextError('');
      const res = await getMyLeaveContext();
      if (res.data?.success) {
        setContext(res.data);
      }
    } catch (err) {
      console.error('Failed to load leave context:', err);
      setContextError('Failed to load employee leave context.');
    } finally {
      setLoadingContext(false);
    }
  };

  const loadRequests = async () => {
    try {
      setLoadingRequests(true);
      setRequestsError('');
      const res = await getMyLeaveRequests();
      if (res.data?.success) {
        setRequests(res.data.requests || []);
        setActors(res.data.actors || {});
      }
    } catch (err) {
      console.error('Failed to load leave requests:', err);
      setRequestsError('Failed to load leave requests.');
    } finally {
      setLoadingRequests(false);
    }
  };

  useEffect(() => {
    loadContext();
  }, []);

  useEffect(() => {
    if (context?.eligible) {
      loadRequests();
    }
  }, [context?.eligible]);

  const handleEdit = (req) => {
    if (req.approval_status !== 'Pending') return;
    setEditingId(req.id);
    setFormData({
      from_date: req.from_date || '',
      to_date: req.to_date || '',
      leave_type: req.leave_type || 'Other Leave',
      reason: req.reason || ''
    });
    setError('');
    setSuccess('');
    window.scrollTo({ top: 300, behavior: 'smooth' });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setFormData({
      from_date: '',
      to_date: '',
      leave_type: 'Other Leave',
      reason: ''
    });
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!formData.from_date || !formData.to_date) {
      setError('Please select both From Date and To Date.');
      return;
    }
    if (formData.from_date > formData.to_date) {
      setError('From Date must be on or before To Date.');
      return;
    }
    if (!formData.reason || !formData.reason.trim()) {
      setError('Reason is required.');
      return;
    }

    try {
      setSubmitting(true);
      const payload = {
        from_date: formData.from_date,
        to_date: formData.to_date,
        leave_type: formData.leave_type,
        reason: formData.reason.trim()
      };

      if (editingId) {
        const res = await updateSelfServiceLeave(editingId, payload);
        if (res.data?.success) {
          setSuccess('Leave request updated successfully.');
          handleCancelEdit();
          loadRequests();
        }
      } else {
        const res = await submitSelfServiceLeave(payload);
        if (res.data?.success) {
          setSuccess('Leave request submitted successfully as Pending.');
          setFormData({
            from_date: '',
            to_date: '',
            leave_type: 'Other Leave',
            reason: ''
          });
          loadRequests();
        }
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.response?.data?.code || 'Failed to submit leave request.';
      setError(msg);
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

  if (loadingContext) {
    return (
      <div className="p-8 text-center text-slate-400 animate-pulse bg-white/5 rounded-2xl border border-white/5">
        <p className="text-sm font-medium">Loading leave profile context...</p>
      </div>
    );
  }

  if (contextError) {
    return <div role="alert" className="space-y-3 p-6">
      <p>{contextError}</p>
      <Button onClick={loadContext}>Retry Leave Context</Button>
    </div>;
  }

  if (!context?.eligible) {
    return (
      <div className="p-6 bg-slate-900/60 border border-amber-500/20 rounded-2xl backdrop-blur-sm">
        <div className="flex items-start gap-4">
          <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xl shrink-0">
            ℹ️
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-100">Self-Service Leave Not Eligible</h3>
            <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
              Self-service leave requests are restricted to active <strong>Head Office Staff</strong> and <strong>Projects Department Employees</strong> who have their employee record linked to their ERP account.
            </p>
            {context?.employee ? (
              <div className="mt-3 p-3 bg-white/5 rounded-xl border border-white/10 text-xs text-slate-300">
                <span className="font-semibold text-slate-200">Current Linked Record: </span>
                {context.employee.employee_name} ({context.employee.employee_code}) &bull; Category: <span className="text-amber-400 font-semibold">{context.employee.employee_category}</span>
                <p className="text-[11px] text-slate-400 mt-1">Factory department employees record attendance and leaves through their Factory Manager.</p>
              </div>
            ) : (
              <p className="text-[11px] text-slate-500 mt-2">
                No active employee record is currently mapped to this login account (<code>erp_user_id</code>). Please contact your administrator if this is an error.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const emp = context.employee;

  return (
    <div className="space-y-6">
      {/* Employee Linked Context Banner */}
      <div className="p-4 bg-gradient-to-r from-amber-500/10 via-slate-900/40 to-slate-900/40 border border-amber-500/20 rounded-2xl flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 font-extrabold text-sm">
            {emp.employee_name?.charAt(0) || 'E'}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-extrabold text-slate-100">{emp.employee_name}</h3>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-white/10 text-slate-300">{emp.employee_code}</span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {emp.employee_category} &bull; {emp.department} &bull; Joined: {emp.joining_date}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="emerald" showDot>Self-Service Active</Badge>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/25 text-red-400 text-xs font-semibold flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} className="text-red-400 hover:text-red-200">✕</button>
        </div>
      )}
      {success && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-xs font-semibold flex items-center justify-between">
          <span>{success}</span>
          <button type="button" onClick={() => setSuccess('')} className="text-emerald-400 hover:text-emerald-200">✕</button>
        </div>
      )}

      {/* Apply / Edit Leave Form */}
      <div className="p-6 bg-slate-900/60 border border-white/10 rounded-2xl backdrop-blur-sm">
        <div className="flex items-center justify-between pb-4 mb-5 border-b border-white/5">
          <div>
            <h3 className="text-base font-extrabold text-slate-100">
              {editingId ? 'Edit Pending Leave Request' : 'Apply for Leave'}
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Submit your dates and reason. All self-service leaves start as Pending with pay treatment determined upon review.
            </p>
          </div>
          {editingId && (
            <Badge variant="amber" showDot pulseDot>Editing Existing Request</Badge>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">From Date</label>
              <Input
                type="date"
                value={formData.from_date}
                onChange={(e) => setFormData(prev => ({ ...prev, from_date: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">To Date</label>
              <Input
                type="date"
                value={formData.to_date}
                onChange={(e) => setFormData(prev => ({ ...prev, to_date: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">Leave Type</label>
              <Select
                value={formData.leave_type}
                onChange={(e) => setFormData(prev => ({ ...prev, leave_type: e.target.value }))}
              >
                <option value="Medical Leave">Medical Leave</option>
                <option value="Other Leave">Other Leave</option>
              </Select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1.5">Reason for Leave</label>
            <TextArea
              rows={3}
              placeholder="State reason clearly (e.g. personal appointment, medical recovery, family event)..."
              value={formData.reason}
              onChange={(e) => setFormData(prev => ({ ...prev, reason: e.target.value }))}
              required
              maxLength={2000}
            />
          </div>

          <div className="flex items-center justify-between pt-2">
            <span className="text-[11px] text-slate-500">
              ⚡ Decided leaves are immutable. No documents or medical upload required.
            </span>
            <div className="flex items-center gap-2">
              {editingId && (
                <Button type="button" variant="secondary" onClick={handleCancelEdit} disabled={submitting}>
                  Cancel Edit
                </Button>
              )}
              <Button type="submit" variant="primary" disabled={submitting}>
                {submitting ? 'Submitting...' : editingId ? 'Update Leave Request' : 'Submit Leave Request'}
              </Button>
            </div>
          </div>
        </form>
      </div>

      {/* Leave History Table */}
      <div className="p-6 bg-slate-900/60 border border-white/10 rounded-2xl backdrop-blur-sm">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-white/5">
          <div>
            <h3 className="text-base font-extrabold text-slate-100">My Leave Requests</h3>
            <p className="text-xs text-slate-400 mt-1">Chronological history of your self-service applications.</p>
          </div>
          <Button type="button" variant="secondary" onClick={loadRequests} disabled={loadingRequests} className="text-xs">
            {loadingRequests ? 'Refreshing...' : '🔄 Refresh'}
          </Button>
        </div>

        {loadingRequests ? (
          <p role="status" className="py-8 text-center">Loading leave requests...</p>
        ) : requestsError ? (
          <div role="alert" className="space-y-3 py-6">
            <p>{requestsError}</p>
            <Button onClick={loadRequests}>Retry Leave Requests</Button>
          </div>
        ) : requests.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-xs">
            No self-service leave requests found. Use the form above to submit your first request.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-white/10 text-slate-400 uppercase text-[10px] tracking-wider">
                  <th className="py-2.5 px-3">Date Range</th>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3">Reason</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Pay Treatment</th>
                  <th className="py-2.5 px-3">Decision Remarks</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-slate-300">
                {requests.map(req => {
                  const isPending = req.approval_status === 'Pending';
                  const decidedByName = req.decided_by ? (actors[req.decided_by] || 'HO Reviewer') : null;

                  return (
                    <tr key={req.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-3 px-3 font-semibold text-slate-200 whitespace-nowrap">
                        {req.from_date} <span className="text-slate-500">&rarr;</span> {req.to_date}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap font-medium">{req.leave_type}</td>
                      <td className="py-3 px-3 max-w-xs truncate" title={req.reason}>{req.reason}</td>
                      <td className="py-3 px-3 whitespace-nowrap">{getStatusBadge(req.approval_status)}</td>
                      <td className="py-3 px-3 whitespace-nowrap">{getPayBadge(req.pay_treatment)}</td>
                      <td className="py-3 px-3 max-w-xs">
                        {req.decision_remarks ? (
                          <div>
                            <span className="text-slate-200">{req.decision_remarks}</span>
                            {decidedByName && (
                              <div className="text-[10px] text-slate-500 mt-0.5">by {decidedByName}</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-600">-</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        {isPending ? (
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => handleEdit(req)}
                            className="text-[11px] py-1 px-2.5"
                          >
                            ✏️ Edit
                          </Button>
                        ) : (
                          <span className="text-[11px] text-slate-500 flex items-center justify-end gap-1 font-mono">
                            🔒 Immutable
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
      </div>
    </div>
  );
}
