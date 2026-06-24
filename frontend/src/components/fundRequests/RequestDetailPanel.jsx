import React, { useState, useEffect } from 'react';
import TimelineProgress from './TimelineProgress';

const formatCurrency = (val) =>
  val != null ? `₹ ${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';

const formatDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

const formatDateTime = (d) => {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
};

const RequestDetailPanel = ({
  user,
  request,        // null if creating new
  onClose,
  onSave,         // ZO submit function
  onAct,          // HO approve/hold action function
  onCancel        // ZO cancel action function
}) => {
  const isCreate = !request;
  const isPending = request?.request_status === 'Pending';
  const isHoOrAdmin = user?.role === 'ho' || user?.role === 'admin';
  const isZoOrAdmin = user?.role === 'zo' || user?.role === 'staff' || user?.role === 'admin';

  // State values
  const [selectedProject, setSelectedProject] = useState(null);
  const [zoFrNo, setZoFrNo] = useState('');
  const [zoFrAmount, setZoFrAmount] = useState('');
  const [zoRemarks, setZoRemarks] = useState('');

  // HO action states
  const [hoAction, setHoAction] = useState('Approve');
  const [hoAmount, setHoAmount] = useState('');
  const [hoAccount, setHoAccount] = useState('');
  const [hoRemarks, setHoRemarks] = useState('');
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionError, setActionError] = useState('');

  // General comments/discussion feed
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');

  // Load request details if viewing
  useEffect(() => {
    if (request) {
      setZoFrNo(request.zo_fr_no);
      setZoFrAmount(request.zo_fr_amount);
      setZoRemarks(request.zo_remarks || '');
      setHoRemarks(request.ho_remarks || '');
      
      // Load comments
      const feed = [];
      if (request.zo_remarks) {
        const author = request.zo_name ? `${request.zo_name} (ZO)` : 'ZO User';
        feed.push({ author, text: request.zo_remarks, type: 'zo' });
      }
      if (request.ho_remarks) {
        const author = request.approve_ho_name ? `${request.approve_ho_name} (HO)` : 'HO User';
        feed.push({ author, text: request.ho_remarks, type: 'ho' });
      }
      setComments(feed);
    } else {
      // Clear forms
      setZoFrNo('');
      setZoFrAmount('');
      setZoRemarks('');
      setComments([]);
    }
  }, [request]);

  // Set default HO approved amount matching requested amount
  useEffect(() => {
    if (request && isPending) {
      setHoAmount(request.zo_fr_amount);
    }
  }, [request, isPending]);

  // Clear HO inputs when action changes to Hold (per process flow specs)
  useEffect(() => {
    if (hoAction === 'Hold') {
      setHoRemarks('');
      setHoAmount('');
      setHoAccount('');
    }
  }, [hoAction]);

  // Handle project selection in creation mode
  const handleProjectSelect = (e) => {
    const pNo = e.target.value;
    const proj = projects.find(p => p.work_order_no === pNo);
    setSelectedProject(proj);
  };

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    if (!zoFrNo.trim()) {
      setActionError('Fund Request Number is required.');
      return;
    }
    const parsedAmount = parseFloat(zoFrAmount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setActionError('Amount must be a positive number.');
      return;
    }

    setActionError('');
    setActionSubmitting(true);
    try {
      await onSave({
        zo_fr_no: zoFrNo.trim(),
        zo_fr_amount: parsedAmount,
        zo_remarks: zoRemarks.trim() || null
      });
      onClose();
    } catch (err) {
      if (err.response?.status === 409) {
        setActionError('Fund Request Number already exists. Please use a different number.');
      } else {
        setActionError(err.response?.data?.message || 'Failed to create request.');
      }
    } finally {
      setActionSubmitting(false);
    }
  };

  const handleHoActionSubmit = async (e) => {
    e.preventDefault();
    setActionError('');

    if (hoAction === 'Approve') {
      const parsedAmount = parseFloat(hoAmount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        setActionError('Approved amount must be positive.');
        return;
      }
      if (parsedAmount > parseFloat(request.zo_fr_amount)) {
        setActionError(`Approved amount cannot exceed requested amount of ${formatCurrency(request.zo_fr_amount)}`);
        return;
      }
      if (!hoAccount) {
        setActionError('Please select a transfer account.');
        return;
      }
    }

    setActionSubmitting(true);
    try {
      await onAct(request.fund_request_id, {
        action: hoAction,
        approve_ho_amount: hoAction === 'Approve' ? parseFloat(hoAmount) : null,
        transfer_from_account: hoAction === 'Approve' ? hoAccount : null,
        ho_remarks: hoRemarks.trim() || null
      });
      onClose();
    } catch (err) {
      setActionError(err.response?.data?.message || 'Failed to submit review action.');
    } finally {
      setActionSubmitting(false);
    }
  };

  const handleAddComment = (e) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    const author = user?.display_name || user?.mobile_number || 'User';
    setComments(prev => [...prev, { author, text: newComment.trim(), type: 'user' }]);
    setNewComment('');
  };

  const todayFormatted = new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });

  return (
    <div className="flex flex-col text-slate-100 font-sans">
      
      {/* 1. Header ribbon actions */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 pb-4 border-b border-white/5">
        <div className="text-left">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-black tracking-tight">
              {isCreate ? 'Fund Request Management' : `Fund Request ${request.zo_fr_no}`}
            </h2>
            {!isCreate && (
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-[9px] font-bold uppercase tracking-wider border ${
                request.request_status === 'Pending' ? 'bg-amber-500/10 border-amber-500/25 text-amber-400' :
                request.request_status === 'Approved' ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400' :
                request.request_status === 'Hold' ? 'bg-red-500/10 border-red-500/25 text-red-400' :
                'bg-slate-500/10 border-slate-500/25 text-slate-400'
              }`}>
                {request.request_status}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 font-medium mt-1">Create and manage fund requests against approved project estimates.</p>
        </div>
        <div className="flex items-center gap-3 self-end">
          {isCreate && (
            <>
              <button 
                onClick={onClose} 
                className="px-4 py-2 hover:bg-white/5 border border-white/5 rounded-xl text-xs font-bold uppercase tracking-wider text-slate-400 hover:text-slate-200 transition"
              >
                Cancel
              </button>
              <button 
                onClick={handleCreateSubmit}
                disabled={actionSubmitting}
                className="bg-white hover:bg-slate-100 text-slate-950 px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition duration-300 shadow-md flex items-center gap-2"
              >
                {actionSubmitting ? 'Submitting...' : 'Submit Request'}
              </button>
            </>
          )}
          {!isCreate && (
            <>
              {isPending && isZoOrAdmin && (
                <button
                  onClick={() => onCancel(request.fund_request_id)}
                  disabled={actionSubmitting}
                  className="bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-400 px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition"
                >
                  Cancel Request
                </button>
              )}
              <button 
                onClick={onClose}
                className="bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition"
              >
                Close View
              </button>
            </>
          )}
        </div>
      </div>

      {actionError && (
        <div className="mb-5 p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
          {actionError}
        </div>
      )}

      {/* 2. Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left and center column details */}
        <div className="lg:col-span-2 space-y-6 text-left">
          


          {/* Card C: Amount Card and Remarks form inputs */}
          <div className="glass-panel p-6 rounded-3xl border border-white/5 bg-gradient-to-br from-white/[0.01] to-transparent">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
              
              {/* Requested amount indicator box */}
              <div className="md:col-span-1 border border-emerald-500/25 bg-emerald-500/[0.02] p-5 rounded-2xl flex flex-col justify-center items-center min-h-[120px]">
                <span className="text-[8px] font-bold uppercase tracking-widest text-emerald-400">Requested Amount</span>
                {isCreate ? (
                  <input
                    type="number"
                    value={zoFrAmount}
                    onChange={(e) => setZoFrAmount(e.target.value)}
                    placeholder="0.00"
                    step="0.01"
                    disabled={actionSubmitting}
                    className="w-full text-center bg-transparent outline-none border-b border-slate-700 focus:border-amber-500 text-lg font-black text-slate-100 font-mono mt-2"
                  />
                ) : (
                  <span className="text-xl font-black text-emerald-400 font-mono mt-3">
                    {formatCurrency(request.zo_fr_amount)}
                  </span>
                )}
              </div>

              {/* Form/Request Metadata & remarks */}
              <div className="md:col-span-2 space-y-4">
                <div className="grid grid-cols-2 gap-4 text-xs">
                  {isCreate ? (
                    <div>
                      <label className="block text-[8px] font-bold uppercase tracking-widest text-slate-500 mb-1">Request Number</label>
                      <input
                        type="text"
                        value={zoFrNo}
                        onChange={(e) => setZoFrNo(e.target.value)}
                        placeholder="ZO/FR/2026/001"
                        disabled={actionSubmitting}
                        className="w-full glass-input rounded-lg px-3 py-1.5 font-semibold text-xs"
                      />
                    </div>
                  ) : (
                    <div>
                      <span className="text-slate-500 block">Requested By</span>
                      <span className="font-bold text-slate-300">{request.zo_name || 'ZO User'}</span>
                    </div>
                  )}
                  <div>
                    <span className="text-slate-500 block">Request Date</span>
                    <span className="font-bold text-slate-300">{isCreate ? todayFormatted : formatDate(request.zo_date)}</span>
                  </div>
                </div>

                <div>
                  <label className="block text-[8px] font-bold uppercase tracking-widest text-slate-500 mb-1">Remarks</label>
                  {isCreate ? (
                    <textarea
                      value={zoRemarks}
                      onChange={(e) => setZoRemarks(e.target.value)}
                      placeholder="Add request remarks..."
                      rows={2}
                      disabled={actionSubmitting}
                      className="w-full glass-input rounded-xl px-3 py-2 text-xs transition resize-none outline-none focus:ring-0"
                    />
                  ) : (
                    <p className="text-xs text-slate-400 italic bg-white/[0.01] border border-white/5 p-3 rounded-xl">
                      {request.zo_remarks || 'No remarks added by Zonal Office.'}
                    </p>
                  )}
                </div>
              </div>

            </div>
          </div>

          {/* Card D: Approval Timeline bar component */}
          {!isCreate && <TimelineProgress status={request.request_status} />}

        </div>

        {/* Right column sidebar panels */}
        <div className="space-y-6 text-left">
          
          {/* Panel 1: APPROVAL INFORMATION */}
          {!isCreate && (
            <div className="glass-panel p-5 rounded-3xl border border-white/5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-4">Approval Information</span>
              
              {isPending && isHoOrAdmin ? (
                <form onSubmit={handleHoActionSubmit} className="space-y-4">
                  <div>
                    <label className="block text-[8px] font-bold uppercase tracking-widest text-slate-500 mb-1">Action Type</label>
                    <select
                      value={hoAction}
                      onChange={(e) => setHoAction(e.target.value)}
                      disabled={actionSubmitting}
                      className="w-full glass-input rounded-lg px-3 py-2 text-xs outline-none"
                    >
                      <option value="Approve">Approve</option>
                      <option value="Hold">Hold</option>
                    </select>
                  </div>
                  
                  {hoAction === 'Approve' && (
                    <>
                      <div>
                        <label className="block text-[8px] font-bold uppercase tracking-widest text-slate-500 mb-1">Approved Amount (₹)</label>
                        <input
                          type="number"
                          value={hoAmount}
                          onChange={(e) => setHoAmount(e.target.value)}
                          placeholder="Approved amount..."
                          step="0.01"
                          required
                          disabled={actionSubmitting}
                          className="w-full glass-input rounded-lg px-3 py-2 text-xs font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[8px] font-bold uppercase tracking-widest text-slate-500 mb-1">Transfer From Account</label>
                        <select
                          value={hoAccount}
                          onChange={(e) => setHoAccount(e.target.value)}
                          required
                          disabled={actionSubmitting}
                          className="w-full glass-input rounded-lg px-3 py-2 text-xs"
                        >
                          <option value="">Select Account...</option>
                          <option value="CC">CC</option>
                          <option value="OD">OD</option>
                          <option value="CR">CR</option>
                        </select>
                      </div>
                    </>
                  )}

                  <div>
                    <label className="block text-[8px] font-bold uppercase tracking-widest text-slate-500 mb-1">HO Remarks</label>
                    <textarea
                      value={hoRemarks}
                      onChange={(e) => setHoRemarks(e.target.value)}
                      placeholder={hoAction === 'Hold' ? "Remarks disabled for Hold status" : "Review notes..."}
                      rows={2}
                      disabled={actionSubmitting || hoAction === 'Hold'}
                      className="w-full glass-input rounded-xl px-3 py-2 text-xs resize-none outline-none disabled:opacity-40"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={actionSubmitting}
                    className="w-full bg-white hover:bg-slate-100 text-slate-950 py-2.5 rounded-xl text-xs font-extrabold uppercase tracking-wider transition shadow-md flex items-center justify-center gap-1.5"
                  >
                    {actionSubmitting ? 'Saving...' : `Save as ${hoAction}`}
                  </button>
                </form>
              ) : (
                <div className="space-y-3.5 text-xs">
                  <div className="flex justify-between items-center pb-2 border-b border-white/5">
                    <span className="text-slate-500 font-semibold">Approved By</span>
                    <span className="font-bold text-slate-300">{request.approve_ho_name || (request.approve_ho_user_id ? 'HO User' : '—')}</span>
                  </div>
                  <div className="flex justify-between items-center pb-2 border-b border-white/5">
                    <span className="text-slate-500 font-semibold">Approved Amount</span>
                    <span className="font-mono font-bold text-emerald-400">{request.approve_ho_amount ? formatCurrency(request.approve_ho_amount) : '—'}</span>
                  </div>
                  <div className="flex justify-between items-center pb-2 border-b border-white/5">
                    <span className="text-slate-500 font-semibold">Transfer Account</span>
                    <span className="px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/25 text-blue-400 font-mono text-[10px] font-bold">
                      {request.transfer_from_account || '—'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 font-semibold">Action Date</span>
                    <span className="font-semibold text-slate-300">{formatDate(request.approve_ho_date)}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Panel 3: DISCUSSION FEED */}
          {!isCreate && (
            <div className="glass-panel p-5 rounded-3xl border border-white/5 flex flex-col justify-between min-h-[220px]">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-4">Discussion</span>
                <div className="space-y-3.5 max-h-[160px] overflow-y-auto pr-1">
                  {comments.map((c, idx) => (
                    <div key={idx} className={`p-2.5 rounded-xl text-xs ${c.type === 'ho' ? 'bg-indigo-500/5 border border-indigo-500/10' : 'bg-white/5 border border-white/5'}`}>
                      <span className="block text-[8px] font-extrabold uppercase tracking-wider text-slate-500">{c.author}</span>
                      <p className="text-slate-300 mt-1 font-medium leading-relaxed">{c.text}</p>
                    </div>
                  ))}
                  {comments.length === 0 && (
                    <span className="text-slate-500 text-xs">No discussion logs found.</span>
                  )}
                </div>
              </div>
              <form onSubmit={handleAddComment} className="mt-4 pt-3 border-t border-white/5 flex gap-2">
                <input
                  type="text"
                  placeholder="Add comment..."
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  className="flex-grow glass-input rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-0 focus:ring-offset-0"
                />
                <button type="submit" className="px-3.5 py-1.5 bg-white text-slate-950 font-bold uppercase text-[9px] tracking-wider rounded-lg shadow hover:bg-slate-100 transition">
                  Send
                </button>
              </form>
            </div>
          )}

          {/* Panel 4: ACTIVITY LOG */}
          {!isCreate && (
            <div className="glass-panel p-5 rounded-3xl border border-white/5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-4">Activity Log</span>
              <div className="space-y-4">
                <div className="flex gap-2.5 text-xs items-start">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                  <div className="flex flex-col text-[11px]">
                    <span className="text-slate-300 font-bold">Created</span>
                    <span className="text-[9px] text-slate-500 mt-0.5">{formatDateTime(request.created_at || request.zo_date)}</span>
                  </div>
                </div>
                <div className="flex gap-2.5 text-xs items-start">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                  <div className="flex flex-col text-[11px]">
                    <span className="text-slate-300 font-bold">Submitted</span>
                    <span className="text-[9px] text-slate-500 mt-0.5">{formatDateTime(request.zo_date)}</span>
                  </div>
                </div>
                {request.request_status !== 'Pending' && (
                  <div className="flex gap-2.5 text-xs items-start">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                    <div className="flex flex-col text-[11px]">
                      <span className="text-slate-300 font-bold">Status Action: {request.request_status}</span>
                      <span className="text-[9px] text-slate-500 mt-0.5">
                        {request.request_status === 'Cancelled'
                          ? formatDateTime(request.cancelled_at)
                          : formatDateTime(request.approve_ho_date)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

        </div>

      </div>

    </div>
  );
};

export default RequestDetailPanel;
