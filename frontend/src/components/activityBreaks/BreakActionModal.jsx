import React, { useState } from 'react';
import { Modal, TextArea, Button } from '../ui';

/**
 * BreakActionModal — ZO Accept/Reject and HO Approve modal.
 * Uses the global premium Modal component.
 */
const BreakActionModal = ({ user, breakRecord, onClose, onSave }) => {
  const isHO = user?.role === 'ho' || user?.role === 'admin';
  const isZO = user?.role === 'zo' || user?.role === 'admin';

  // Determine which actions are available for the current user / status
  const getAvailableActions = () => {
    const status = breakRecord?.status;
    if (isHO && status === 'Pending HO Review') return ['Approve'];
    if (isZO && status === 'Pending ZO Review') return ['Accept', 'Reject'];
    return [];
  };

  const availableActions = getAvailableActions();
  const [action, setAction] = useState(availableActions[0] || '');
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const requiresRemarks = action === 'Reject';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (requiresRemarks && !remarks.trim()) {
      setError('Remarks are required when rejecting a break request.');
      return;
    }

    setSubmitting(true);
    try {
      await onSave({ action, remarks: remarks.trim() || undefined });
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to submit action. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const todayFormatted = new Date().toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric'
  });

  const actionColor = {
    Approve: 'text-emerald-400',
    Accept:  'text-emerald-400',
    Reject:  'text-red-400'
  }[action] || 'text-slate-300';

  const footerButtons = (
    <>
      <Button variant="secondary" onClick={onClose} disabled={submitting} size="sm">
        Cancel
      </Button>
      <Button
        type="submit"
        form="break-action-form"
        loading={submitting}
        size="sm"
        variant={action === 'Reject' ? 'danger' : 'success'}
      >
        Submit — {action}
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Review Break Request"
      subtitle={`Activity Break Module · ${isHO ? 'HO Action' : 'ZO Action'}`}
      footer={footerButtons}
    >
      {error && (
        <div className="mb-4 p-3 bg-red-950/20 border border-red-900/30 rounded-xl text-xs text-red-300 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
          {error}
        </div>
      )}

      {/* Break Record Overview */}
      <div className="mb-4 p-4 rounded-2xl bg-white/[0.02] border border-white/5 space-y-2.5 text-left text-xs">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="block text-[8px] font-bold uppercase tracking-widest text-slate-500">Work Order</span>
            <span className="font-mono font-bold text-emerald-400">{breakRecord?.work_order_no}</span>
          </div>
          <div>
            <span className="block text-[8px] font-bold uppercase tracking-widest text-slate-500">Break Period</span>
            <span className="font-mono font-bold text-amber-300">{breakRecord?.start_date} → {breakRecord?.expected_end_date}</span>
          </div>
        </div>
        <div>
          <span className="block text-[8px] font-bold uppercase tracking-widest text-slate-500">JE Reason</span>
          <p className="text-slate-400 italic mt-0.5">{breakRecord?.je_remarks || 'No reason provided.'}</p>
        </div>
        {breakRecord?.zo_remarks && (
          <div>
            <span className="block text-[8px] font-bold uppercase tracking-widest text-slate-500">ZO Remarks</span>
            <p className="text-slate-400 italic mt-0.5">{breakRecord.zo_remarks}</p>
          </div>
        )}
      </div>

      <form id="break-action-form" onSubmit={handleSubmit} className="space-y-4 text-left">
        {/* Reviewer Context */}
        <div className="grid grid-cols-3 gap-2.5 p-3.5 rounded-2xl bg-white/[0.02] border border-white/5">
          <div>
            <span className="block text-[8px] font-bold uppercase tracking-widest text-slate-500">Reviewer</span>
            <span className="text-[11px] font-bold text-slate-300 truncate block mt-0.5">{user?.display_name || '—'}</span>
          </div>
          <div>
            <span className="block text-[8px] font-bold uppercase tracking-widest text-slate-500">Mobile</span>
            <span className="text-[11px] font-mono font-bold text-slate-300 truncate block mt-0.5">{user?.mobile_number || '—'}</span>
          </div>
          <div>
            <span className="block text-[8px] font-bold uppercase tracking-widest text-slate-500">Date</span>
            <span className="text-[11px] font-mono font-bold text-slate-300 truncate block mt-0.5">{todayFormatted}</span>
          </div>
        </div>

        {/* Action Selector */}
        {availableActions.length > 1 && (
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
              Action <span className="text-red-400">*</span>
            </label>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value)}
              disabled={submitting}
              className="w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-sm font-semibold text-slate-100 transition"
            >
              {availableActions.map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
        )}
        {availableActions.length === 1 && (
          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 text-xs text-slate-400">
            Action: <span className={`font-bold ${actionColor}`}>{action}</span>
          </div>
        )}

        {/* Remarks */}
        <TextArea
          label={`Remarks${requiresRemarks ? ' *' : ''}`}
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder={requiresRemarks ? 'Reason for rejection is required...' : 'Optional notes...'}
          rows={3}
          required={requiresRemarks}
          disabled={submitting}
        />
      </form>
    </Modal>
  );
};

export default BreakActionModal;
