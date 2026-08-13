import { useState } from 'react';

/**
 * BreakActionModal — ZO Accept/Reject and HO Approve modal.
 * Follows HOActionModal.jsx pattern.
 *
 * Props:
 *   user       — current auth user
 *   breakRecord — the activity break being actioned
 *   onClose    — close handler
 *   onSave     — async (payload) => void
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

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
      <div className="glass-panel p-6 rounded-3xl max-w-lg w-full shadow-[0_25px_60px_rgba(0,0,0,0.7)] border border-white/10 relative overflow-hidden">
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-amber-500/5 blur-3xl pointer-events-none" />

        {/* Header */}
        <div className="flex justify-between items-center mb-5 relative z-10">
          <div>
            <span className="text-[9px] font-bold uppercase tracking-widest text-amber-400 font-mono">
              Activity Break Module · {isHO ? 'HO Action' : 'ZO Action'}
            </span>
            <h2 className="text-sm font-extrabold uppercase tracking-widest text-slate-100 mt-0.5">
              Review Break Request
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

        <form onSubmit={handleSubmit} className="relative z-10 space-y-4 text-left">
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
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
              Remarks {requiresRemarks && <span className="text-red-400">*</span>}
            </label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder={requiresRemarks ? 'Reason for rejection is required...' : 'Optional notes...'}
              rows={3}
              required={requiresRemarks}
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
                  Saving…
                </>
              ) : (
                `Submit — ${action}`
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default BreakActionModal;
