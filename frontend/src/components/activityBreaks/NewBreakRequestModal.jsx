import React, { useState } from 'react';
import { Modal, TextArea, Button } from '../ui';

const NewBreakRequestModal = ({ user, workOrderNo, onClose, onSave }) => {
  const today = new Date().toISOString().slice(0, 10);

  const [form, setForm] = useState({
    start_date: today,
    expected_end_date: today,
    je_remarks: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!form.start_date) {
      setError('Start date is required.');
      return;
    }
    if (!form.expected_end_date) {
      setError('Expected end date is required.');
      return;
    }
    // UX-level date guard — backend Zod .refine() + DB CHECK are the enforcement layers
    if (form.expected_end_date < form.start_date) {
      setError('Expected end date must be on or after start date.');
      return;
    }
    if (!form.je_remarks.trim()) {
      setError('Reason for the break is required.');
      return;
    }

    setSubmitting(true);
    try {
      await onSave({
        work_order_no: workOrderNo,
        start_date: form.start_date,
        expected_end_date: form.expected_end_date,
        je_remarks: form.je_remarks.trim()
      });
      onClose();
    } catch (err) {
      if (err.response?.status === 409) {
        setError('A non-terminal activity break already exists for this work order.');
      } else {
        setError(err.response?.data?.message || 'Failed to submit break request. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const todayFormatted = new Date().toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric'
  });

  const footerButtons = (
    <>
      <Button variant="secondary" onClick={onClose} disabled={submitting} size="sm">
        Cancel
      </Button>
      <Button type="submit" form="new-break-request-form" loading={submitting} size="sm">
        Submit Request
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Request Activity Break"
      subtitle="Activity Break Module"
      footer={footerButtons}
    >
      {error && (
        <div className="mb-4 p-3 bg-red-950/20 border border-red-900/30 rounded-xl text-xs text-red-300 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
          {error}
        </div>
      )}

      <form id="new-break-request-form" onSubmit={handleSubmit} className="space-y-4">
        {/* Read-Only User Context */}
        <div className="grid grid-cols-3 gap-2.5 p-3.5 rounded-2xl bg-white/[0.02] border border-white/5 text-left">
          <div>
            <span className="block text-[8px] font-bold uppercase tracking-widest text-slate-500">Display Name</span>
            <span className="text-[11px] font-bold text-slate-300 truncate block mt-0.5">{user?.display_name || '—'}</span>
          </div>
          <div>
            <span className="block text-[8px] font-bold uppercase tracking-widest text-slate-500">Work Order</span>
            <span className="text-[11px] font-mono font-bold text-emerald-400 truncate block mt-0.5">{workOrderNo || '—'}</span>
          </div>
          <div>
            <span className="block text-[8px] font-bold uppercase tracking-widest text-slate-500">Request Date</span>
            <span className="text-[11px] font-mono font-bold text-slate-300 truncate block mt-0.5">{todayFormatted}</span>
          </div>
        </div>

        {/* Date Pickers with min/max binding — UX-only first defense, backend Zod + DB CHECK enforce */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
              Break Start Date <span className="text-red-400">*</span>
            </label>
            <input
              type="date"
              name="start_date"
              value={form.start_date}
              onChange={(e) => {
                const value = e.target.value;
                // Keep expected_end_date >= start_date at the UX level.
                // No max here — a start_date in the future (requesting a
                // break in advance) is a normal, expected use case, not a
                // bound to guard against.
                setForm(prev => ({
                  ...prev,
                  start_date: value,
                  expected_end_date: prev.expected_end_date < value ? value : prev.expected_end_date
                }));
              }}
              required
              disabled={submitting}
              className="w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-sm font-semibold text-slate-100 transition"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
              Expected End Date <span className="text-red-400">*</span>
            </label>
            <input
              type="date"
              name="expected_end_date"
              value={form.expected_end_date}
              min={form.start_date || undefined}
              onChange={handleChange}
              required
              disabled={submitting}
              className="w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-sm font-semibold text-slate-100 transition"
            />
          </div>
        </div>

        <TextArea
          label="Reason for Break"
          name="je_remarks"
          value={form.je_remarks}
          onChange={handleChange}
          placeholder="e.g. Monsoon season — site inaccessible until further notice..."
          rows={3}
          required
          disabled={submitting}
        />

        <div className="p-3 rounded-xl bg-amber-500/[0.04] border border-amber-500/20 text-[10px] text-amber-300/80">
          ⚠️ Once approved by HO, daily progress submissions will be blocked for this work order until the break is formally reopened.
        </div>
      </form>
    </Modal>
  );
};

export default NewBreakRequestModal;
