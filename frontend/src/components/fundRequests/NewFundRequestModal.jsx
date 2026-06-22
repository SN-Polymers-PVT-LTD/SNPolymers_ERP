import React, { useState } from 'react';

const NewFundRequestModal = ({ user, onClose, onSave }) => {
  const [form, setForm] = useState({ zo_fr_no: '', zo_fr_amount: '', zo_remarks: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.zo_fr_no.trim()) {
      setError('Fund Request Number is required.');
      return;
    }
    const amount = parseFloat(form.zo_fr_amount);
    if (isNaN(amount) || amount <= 0) {
      setError('Amount must be a positive number greater than zero.');
      return;
    }

    setError('');
    setSubmitting(true);
    try {
      await onSave({
        zo_fr_no: form.zo_fr_no.trim(),
        zo_fr_amount: amount,
        zo_remarks: form.zo_remarks.trim() || null
      });
      onClose();
    } catch (err) {
      if (err.response?.status === 409) {
        setError('Fund Request Number already exists. Please use a different number.');
      } else {
        setError(err.response?.data?.message || 'Failed to submit fund request. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const todayFormatted = new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
      <div className="glass-panel p-6 rounded-3xl max-w-lg w-full shadow-[0_25px_60px_rgba(0,0,0,0.7)] border border-white/10 relative overflow-hidden">
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-amber-500/5 blur-3xl pointer-events-none" />

        <div className="flex justify-between items-center mb-5 relative z-10">
          <div>
            <span className="text-[9px] font-bold uppercase tracking-widest text-amber-500 font-mono">
              Fund Requisition Module
            </span>
            <h2 className="text-sm font-extrabold uppercase tracking-widest text-slate-100 mt-0.5">
              Create Fund Request
            </h2>
          </div>
          <button onClick={onClose} disabled={submitting} className="text-slate-400 hover:text-slate-200 transition-colors p-1 disabled:opacity-40">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-950/20 border border-red-900/30 rounded-xl text-xs text-red-300 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="relative z-10 space-y-4">
          {/* Read-Only User Context */}
          <div className="grid grid-cols-3 gap-2.5 p-3.5 rounded-2xl bg-white/[0.02] border border-white/5 text-left">
            <div>
              <span className="block text-[8px] font-bold uppercase tracking-widest text-slate-500">Display Name</span>
              <span className="text-[11px] font-bold text-slate-300 truncate block mt-0.5">{user?.display_name || '—'}</span>
            </div>
            <div>
              <span className="block text-[8px] font-bold uppercase tracking-widest text-slate-500">Mobile Number</span>
              <span className="text-[11px] font-mono font-bold text-slate-300 truncate block mt-0.5">{user?.mobile_number || '—'}</span>
            </div>
            <div>
              <span className="block text-[8px] font-bold uppercase tracking-widest text-slate-500">Current Date</span>
              <span className="text-[11px] font-mono font-bold text-slate-300 truncate block mt-0.5">{todayFormatted}</span>
            </div>
          </div>

          {/* Request Number */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
              Fund Request No. <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              name="zo_fr_no"
              value={form.zo_fr_no}
              onChange={handleChange}
              placeholder="e.g. ZO/FR/2026/001"
              required
              disabled={submitting}
              className="w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-sm font-semibold text-slate-100 transition"
            />
          </div>

          {/* Amount */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
              Requested Amount (₹) <span className="text-red-400">*</span>
            </label>
            <input
              type="number"
              name="zo_fr_amount"
              value={form.zo_fr_amount}
              onChange={handleChange}
              placeholder="0.00"
              step="0.01"
              min="0.01"
              required
              disabled={submitting}
              className="w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-sm font-semibold text-slate-100 transition"
            />
          </div>

          {/* Remarks */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
              ZO Remarks
            </label>
            <textarea
              name="zo_remarks"
              value={form.zo_remarks}
              onChange={handleChange}
              placeholder="Provide context or explanation for the request..."
              rows={3}
              disabled={submitting}
              className="w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-sm font-semibold text-slate-100 transition resize-none"
            />
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-slate-400 hover:text-slate-200 font-extrabold text-xs uppercase tracking-wider transition disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="bg-white hover:bg-slate-100 text-slate-950 px-6 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300 shadow-md disabled:opacity-50 flex items-center gap-2"
            >
              {submitting ? (
                <>
                  <span className="animate-spin rounded-full h-3 w-3 border-t-2 border-b-2 border-slate-800" />
                  Creating…
                </>
              ) : 'Submit Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default NewFundRequestModal;
