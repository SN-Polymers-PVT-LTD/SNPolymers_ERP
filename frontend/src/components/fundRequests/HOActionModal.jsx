import React, { useState, useEffect } from 'react';

const HOActionModal = ({ user, request, onClose, onSave }) => {
  const [action, setAction] = useState('Approve'); // 'Approve' | 'Hold'
  const [amount, setAmount] = useState('');
  const [account, setAccount] = useState('');
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Default amount to requested amount for convenience
  useEffect(() => {
    if (request) {
      setAmount(request.zo_fr_amount);
    }
  }, [request]);

  const handleActionChange = (e) => {
    const act = e.target.value;
    setAction(act);
    if (act === 'Hold') {
      // Clear fields if switching to Hold path
      setAmount('');
      setAccount('');
    } else if (request) {
      setAmount(request.zo_fr_amount);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (action === 'Approve') {
      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        setError('Approved amount must be a positive number greater than zero.');
        return;
      }
      if (parsedAmount > parseFloat(request.zo_fr_amount)) {
        setError(`Approved amount cannot exceed requested amount of ₹${Number(request.zo_fr_amount).toLocaleString('en-IN')}.`);
        return;
      }
      if (!account) {
        setError('Please select a transfer account.');
        return;
      }
    }

    setSubmitting(true);
    try {
      await onSave({
        action,
        approve_ho_amount: action === 'Approve' ? parseFloat(amount) : null,
        transfer_from_account: action === 'Approve' ? account : null,
        ho_remarks: remarks.trim() || null
      });
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to submit action. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const todayFormatted = new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });

  const isHold = action === 'Hold';

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
      <div className="glass-panel p-6 rounded-3xl max-w-lg w-full shadow-[0_25px_60px_rgba(0,0,0,0.7)] border border-white/10 relative overflow-hidden">
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-emerald-500/5 blur-3xl pointer-events-none" />

        <div className="flex justify-between items-center mb-5 relative z-10">
          <div>
            <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-400 font-mono">
              Fund Requisition Module · HO Action
            </span>
            <h2 className="text-sm font-extrabold uppercase tracking-widest text-slate-100 mt-0.5">
              Review Fund Request
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

        {/* Request Overview */}
        <div className="mb-4 p-4 rounded-2xl bg-white/[0.02] border border-white/5 space-y-2.5 text-left text-xs">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="block text-[8px] font-bold uppercase tracking-widest text-slate-500">Request No.</span>
              <span className="font-mono font-bold text-slate-200">{request?.zo_fr_no}</span>
            </div>
            <div>
              <span className="block text-[8px] font-bold uppercase tracking-widest text-slate-500">Requested Amount</span>
              <span className="font-mono font-bold text-slate-200">₹ {Number(request?.zo_fr_amount).toLocaleString('en-IN')}</span>
            </div>
          </div>
          <div>
            <span className="block text-[8px] font-bold uppercase tracking-widest text-slate-500">ZO Remarks</span>
            <p className="text-slate-400 italic mt-0.5">{request?.zo_remarks || 'No remarks provided.'}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="relative z-10 space-y-4 text-left">
          {/* Read-Only HO User Context */}
          <div className="grid grid-cols-3 gap-2.5 p-3.5 rounded-2xl bg-white/[0.02] border border-white/5">
            <div>
              <span className="block text-[8px] font-bold uppercase tracking-widest text-slate-500">HO User ID</span>
              <span className="text-[11px] font-bold text-slate-300 truncate block mt-0.5">{user?.display_name || '—'}</span>
            </div>
            <div>
              <span className="block text-[8px] font-bold uppercase tracking-widest text-slate-500">Mobile Number</span>
              <span className="text-[11px] font-mono font-bold text-slate-300 truncate block mt-0.5">{user?.mobile_number || '—'}</span>
            </div>
            <div>
              <span className="block text-[8px] font-bold uppercase tracking-widest text-slate-500">HO Date</span>
              <span className="text-[11px] font-mono font-bold text-slate-300 truncate block mt-0.5">{todayFormatted}</span>
            </div>
          </div>

          {/* Action Choice */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
              Action <span className="text-red-400">*</span>
            </label>
            <select
              value={action}
              onChange={handleActionChange}
              disabled={submitting}
              className="w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-sm font-semibold text-slate-100 transition"
            >
              <option value="Approve">Approve</option>
              <option value="Hold">Hold</option>
            </select>
          </div>

          {/* Approved Amount */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
              Approved Amount (₹) {!isHold && <span className="text-red-400">*</span>}
            </label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={isHold ? "N/A — Hold" : "0.00"}
              step="0.01"
              min="0.01"
              disabled={isHold || submitting}
              required={!isHold}
              className={`w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-sm font-semibold text-slate-100 transition ${isHold ? 'opacity-40 cursor-not-allowed bg-slate-900/50' : ''}`}
            />
          </div>

          {/* Transfer Account */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
              Transfer From Account {!isHold && <span className="text-red-400">*</span>}
            </label>
            <select
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              disabled={isHold || submitting}
              required={!isHold}
              className={`w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-sm font-semibold text-slate-100 transition ${isHold ? 'opacity-40 cursor-not-allowed bg-slate-900/50' : ''}`}
            >
              <option value="">Select Account...</option>
              <option value="CC">CC</option>
              <option value="OD">OD</option>
              <option value="CR">CR</option>
            </select>
          </div>

          {/* HO Remarks */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
              HO Remarks
            </label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder={isHold ? "N/A — Hold" : "Optional notes or reason for approval..."}
              rows={3}
              disabled={isHold || submitting}
              className={`w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-sm font-semibold text-slate-100 transition resize-none ${isHold ? 'opacity-40 cursor-not-allowed bg-slate-900/50' : ''}`}
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
                  Saving…
                </>
              ) : (
                `Save as ${action}`
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default HOActionModal;
