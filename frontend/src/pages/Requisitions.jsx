import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../components/AuthContext';
import BackgroundShapes from '../components/BackgroundShapes';
import Sidebar, { MobileHeader } from '../components/Sidebar';
import { getProjects } from '../api/projectsApi';
import { getEstimates } from '../api/estimatesApi';
import { getMaterialCategories } from '../api/materialsApi';
import {
  getRequisitions,
  getRequisitionById,
  createRequisition,
  actOnRequisition,
  cancelRequisition,
  uploadRequisitionPdf,
  uploadGstBillPdf
} from '../api/requisitionsApi';

// Helper for currency formatting
const formatCurrency = (val) =>
  val != null ? `₹ ${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';

// Helper for date formatting
const formatDate = (d) =>
  d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

// Colored status badge component
const StatusBadge = ({ status }) => {
  const cfg = {
    Pending: { dot: 'bg-amber-400', pill: 'bg-amber-500/10 border-amber-500/25 text-amber-400', label: 'Pending' },
    Approved: { dot: 'bg-emerald-400', pill: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400', label: 'Approved' },
    Hold: { dot: 'bg-orange-400', pill: 'bg-orange-500/10 border-orange-500/25 text-orange-400', label: 'Hold' },
    Cancelled: { dot: 'bg-slate-400', pill: 'bg-slate-500/10 border-slate-500/25 text-slate-400', label: 'Cancelled' },
  };
  const s = cfg[status] ?? cfg['Pending'];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider border ${s.pill}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
};

// Modal for confirming cancellation
const CancelConfirmModal = ({ requisitionNo, isCancelling, onConfirm, onClose }) => (
  <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
    <div className="glass-panel p-6 rounded-3xl max-w-sm w-full border border-white/10 shadow-[0_25px_60px_rgba(0,0,0,0.7)]">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-red-500/10">
          <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </div>
        <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-100">
          Confirm Cancel
        </h2>
      </div>
      <p className="text-xs text-slate-400 mb-6">
        Are you sure you want to cancel requisition <span className="font-mono font-bold text-slate-200">{requisitionNo}</span>? This action is permanent.
      </p>
      <div className="flex gap-3 justify-end">
        <button onClick={onClose} disabled={isCancelling} className="px-4 py-2 text-slate-400 hover:text-slate-200 font-bold text-xs uppercase tracking-wider transition">
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={isCancelling}
          className="px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300 shadow-md bg-red-500/90 hover:bg-red-500 text-white flex items-center gap-1.5"
        >
          {isCancelling ? (
            <>
              <span className="animate-spin rounded-full h-3 w-3 border-t-2 border-b-2 border-slate-800" />
              Cancelling…
            </>
          ) : 'Yes, Cancel'}
        </button>
      </div>
    </div>
  </div>
);

// Detail Modal for viewing requisition metadata and PDF previews
const RequisitionDetailModal = ({ reqId, onClose, user, onCancelClick }) => {
  const [requisition, setRequisition] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchDetail = async () => {
      try {
        const res = await getRequisitionById(reqId);
        setRequisition(res.data?.requisition);
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to retrieve details.');
      } finally {
        setLoading(false);
      }
    };
    fetchDetail();
  }, [reqId]);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
        <div className="glass-panel p-10 rounded-3xl flex flex-col items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500" />
          <span className="text-xs text-slate-400 mt-4 uppercase tracking-widest font-bold">Loading Details…</span>
        </div>
      </div>
    );
  }

  if (error || !requisition) {
    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
        <div className="glass-panel p-6 rounded-3xl max-w-sm w-full border border-white/10">
          <h2 className="text-sm font-extrabold text-red-400 uppercase mb-3">Error</h2>
          <p className="text-xs text-slate-400 mb-6">{error || 'Requisition not found.'}</p>
          <button onClick={onClose} className="w-full py-2 bg-white/10 hover:bg-white/20 text-slate-200 text-xs font-bold uppercase rounded-xl transition">
            Close
          </button>
        </div>
      </div>
    );
  }

  const isPending = requisition.requisition_status === 'Pending';
  const isOwner = requisition.requester_user_id === user?.mobile_number;
  const isAdmin = user?.role === 'admin';
  const showCancel = isPending && (isOwner || isAdmin);

  const detailRows = [
    { label: 'Work Order No.', value: requisition.work_order_no, mono: true },
    { label: 'Estimate No.', value: requisition.estimate_no, mono: true },
    { label: 'Estimate Amount', value: formatCurrency(requisition.estimate_amount) },
    { label: 'Material Head', value: requisition.material_main_head },
    { label: 'Requisition Amount', value: formatCurrency(requisition.requisition_amount), accent: 'text-amber-400 font-bold' },
    { label: 'State', value: requisition.state },
    { label: 'District', value: requisition.district },
    { label: 'Zone / Area', value: requisition.area_code },
    { label: 'Department', value: requisition.department },
    { label: 'Site Details', value: requisition.site_details },
    { label: 'Bank Details', value: requisition.bank_details },
    { label: 'Expenditure Remarks', value: requisition.expen_head_remarks || '—' },
    { label: 'Created By', value: requisition.requester_name || requisition.requester_user_id, mono: true },
    { label: 'Created At', value: formatDate(requisition.created_at) },
  ];

  if (requisition.requisition_status === 'Approved') {
    detailRows.push(
      { label: 'Approved By', value: requisition.approved_name || requisition.approved_user_id, mono: true },
      { label: 'Approved Amount', value: formatCurrency(requisition.approved_amount), accent: 'text-emerald-400 font-bold' },
      { label: 'Approved Balance', value: formatCurrency(requisition.approved_balance_amount) },
      { label: 'Payment Date', value: formatDate(requisition.payment_date) },
      { label: 'Authority Remarks', value: requisition.remarks_approved_authority || '—' }
    );
  } else if (requisition.requisition_status === 'Hold') {
    detailRows.push(
      { label: 'Placed on Hold By', value: requisition.approved_name || requisition.approved_user_id, mono: true },
      { label: 'Hold Date', value: formatDate(requisition.payment_date) },
      { label: 'Hold Remarks', value: requisition.remarks_approved_authority || '—' }
    );
  } else if (requisition.requisition_status === 'Cancelled') {
    detailRows.push(
      { label: 'Cancelled By', value: requisition.cancelled_name || requisition.cancelled_by, mono: true },
      { label: 'Cancelled At', value: formatDate(requisition.cancelled_at) }
    );
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="glass-panel p-6 rounded-3xl max-w-4xl w-full shadow-[0_25px_60px_rgba(0,0,0,0.7)] border border-white/10 my-8 relative flex flex-col md:flex-row gap-6">
        
        {/* Left Side: Metadata */}
        <div className="flex-1 space-y-4">
          <div className="flex justify-between items-start">
            <div>
              <span className="text-[9px] font-bold uppercase tracking-widest text-amber-500 font-mono">
                Requisition ID: {requisition.requisition_no}
              </span>
              <h2 className="text-sm font-extrabold uppercase tracking-widest text-slate-100 mt-0.5">
                Requisition Details
              </h2>
            </div>
            <StatusBadge status={requisition.requisition_status} />
          </div>

          <div className="grid grid-cols-2 gap-3.5 bg-white/[0.01] border border-white/5 p-4 rounded-2xl max-h-[420px] overflow-y-auto">
            {detailRows.map((row) => (
              <div key={row.label} className={row.label === 'Bank Details' || row.label === 'Expenditure Remarks' || row.label === 'Site Details' || row.label === 'Authority Remarks' ? 'col-span-2' : ''}>
                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">{row.label}</p>
                <p className={`text-xs font-semibold mt-0.5 whitespace-pre-line ${row.accent || 'text-slate-300'} ${row.mono ? 'font-mono' : ''}`}>
                  {row.value}
                </p>
              </div>
            ))}
          </div>

          <div className="flex justify-between items-center pt-2">
            {showCancel ? (
              <button
                onClick={() => onCancelClick(requisition.requisition_id, requisition.requisition_no)}
                className="px-4 py-2 rounded-xl text-xs font-bold uppercase bg-red-950/40 hover:bg-red-950/60 border border-red-900/30 text-red-400 transition"
              >
                Cancel Requisition
              </button>
            ) : <div />}
            
            <button
              onClick={onClose}
              className="bg-white hover:bg-slate-100 text-slate-950 px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition"
            >
              Close Details
            </button>
          </div>
        </div>

        {/* Right Side: Document Previews */}
        <div className="w-full md:w-96 flex flex-col gap-4 border-t md:border-t-0 md:border-l border-white/5 pt-4 md:pt-0 md:pl-6">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Attached Documents</h3>
          
          {/* Requisition PDF Card */}
          <div className="glass-panel p-4 rounded-2xl border border-white/5 flex flex-col justify-between min-h-[120px]">
            <div>
              <p className="text-[9px] font-bold uppercase text-slate-500 tracking-wider">Purchase Requisition PDF</p>
              <p className="text-xs font-semibold text-slate-300 mt-1 truncate" title={requisition.original_filename || requisition.requisition_pdf_url}>
                {requisition.original_filename || 'requisition_document.pdf'}
              </p>
            </div>
            {requisition.requisition_pdf_signed_url ? (
              <a
                href={requisition.requisition_pdf_signed_url}
                target="_blank"
                rel="noreferrer"
                className="mt-3 py-2 bg-white/5 hover:bg-white/10 text-center rounded-xl text-[10px] uppercase tracking-wider font-extrabold border border-white/5 transition block"
              >
                Open Requisition PDF
              </a>
            ) : (
              <span className="text-[10px] text-red-400 mt-2">Expired or unavailable</span>
            )}
          </div>

          {/* GST Bill Card */}
          {requisition.gst_bill === 'Yes' && (
            <div className="glass-panel p-4 rounded-2xl border border-white/5 flex flex-col justify-between min-h-[120px]">
              <div>
                <p className="text-[9px] font-bold uppercase text-slate-500 tracking-wider">GST Bill Invoice</p>
                <p className="text-xs font-semibold text-slate-300 mt-1 truncate">
                  {requisition.requisition_no}_gst.pdf
                </p>
              </div>
              {requisition.gst_bill_pdf_signed_url ? (
                <a
                  href={requisition.gst_bill_pdf_signed_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 py-2 bg-white/5 hover:bg-white/10 text-center rounded-xl text-[10px] uppercase tracking-wider font-extrabold border border-white/5 transition block"
                >
                  Open GST Bill PDF
                </a>
              ) : (
                <span className="text-[10px] text-red-400 mt-2">No PDF invoice uploaded</span>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

// Action Modal for Approvers (ZO/HO/Admin)
const ActionModal = ({ requisition, onClose, onSave }) => {
  const { user } = useAuth();
  const approverName = user?.display_name || user?.mobile_number;
  const systemDateStr = new Date().toLocaleDateString('en-IN', { dateStyle: 'medium' });

  const [approveType, setApproveType] = useState('Approve');
  const [approvedAmount, setApprovedAmount] = useState('');
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const requisitionAmount = Number(requisition.requisition_amount);
  const liveApprovedBalance = approveType === 'Approve' && approvedAmount !== ''
    ? requisitionAmount - Number(approvedAmount)
    : null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Remarks is mandatory for both Approve and Hold
    if (!remarks.trim()) {
      setError('Remarks are required.');
      return;
    }

    if (approveType === 'Approve') {
      const amt = Number(approvedAmount);
      if (isNaN(amt) || amt <= 0) {
        setError('Approved amount must be a positive number greater than zero.');
        return;
      }
      if (amt > requisitionAmount) {
        setError('Approved amount cannot exceed requisition amount.');
        return;
      }
    }

    setSubmitting(true);
    try {
      const payload = {
        action: approveType,
        remarks_approved_authority: remarks.trim(),
        approved_amount: approveType === 'Approve' ? Number(approvedAmount) : null
      };
      await onSave(requisition.requisition_id, payload);
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to submit action.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="glass-panel p-6 rounded-3xl max-w-md w-full shadow-[0_25px_60px_rgba(0,0,0,0.7)] border border-white/10 relative overflow-hidden my-8">
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-amber-500/5 blur-3xl pointer-events-none" />

        <div className="flex justify-between items-center mb-6 relative z-10">
          <div>
            <span className="text-[9px] font-bold uppercase tracking-widest text-amber-500 font-mono">
              Requisition NO: {requisition.requisition_no}
            </span>
            <h2 className="text-sm font-extrabold uppercase tracking-widest text-slate-100 mt-0.5">
              Take Workflow Action
            </h2>
          </div>
          <button onClick={onClose} disabled={submitting} className="text-slate-400 hover:text-slate-200 transition-colors p-1">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-950/20 border border-red-900/30 rounded-xl text-xs text-red-300 flex items-center gap-2.5">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 relative z-10">
          {/* Read-Only Info */}
          <div className="grid grid-cols-2 gap-3.5 bg-white/[0.01] border border-white/5 p-4 rounded-2xl">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Requested Amount</p>
              <p className="text-xs font-mono font-bold text-amber-400 mt-0.5">{formatCurrency(requisition.requisition_amount)}</p>
            </div>
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Material Head</p>
              <p className="text-xs font-semibold text-slate-300 mt-0.5">{requisition.material_main_head}</p>
            </div>
            <div className="col-span-2 border-t border-white/5 pt-2 flex justify-between text-[11px] text-slate-400 font-semibold">
              <span>Approver: {approverName}</span>
              <span>Date: {systemDateStr}</span>
            </div>
          </div>

          {/* Action Choice */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
              Action <span className="text-red-400">*</span>
            </label>
            <select
              value={approveType}
              onChange={(e) => setApproveType(e.target.value)}
              required
              disabled={submitting}
              className="w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-xs font-semibold text-slate-200 transition"
            >
              <option value="Approve">Approve</option>
              <option value="Hold">Hold</option>
            </select>
          </div>

          {/* Approved Amount (Approve Only) */}
          {approveType === 'Approve' && (
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                  Approved Amount (₹) <span className="text-red-400">*</span>
                </label>
                <input
                  type="number"
                  value={approvedAmount}
                  onChange={(e) => setApprovedAmount(e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  min="0.01"
                  required
                  disabled={submitting}
                  className="w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-xs font-semibold text-slate-100 transition"
                />
              </div>

              {/* Live Computed Approved Balance */}
              {approvedAmount !== '' && (
                <div className="p-3 bg-indigo-500/5 border border-indigo-500/10 rounded-2xl flex justify-between items-center text-xs">
                  <span className="text-slate-400 font-medium">Approved Balance:</span>
                  <span className="font-mono font-bold text-slate-200">{formatCurrency(liveApprovedBalance)}</span>
                </div>
              )}
            </div>
          )}

          {/* Remarks (Required for both Approve and Hold) */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
              Remarks / Comments <span className="text-red-400">*</span>
            </label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder={`Enter the reason for placing on ${approveType === 'Approve' ? 'approval' : 'hold'}…`}
              rows={3}
              required
              disabled={submitting}
              className="w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-xs font-semibold text-slate-100 transition resize-none"
            />
          </div>

          {/* Buttons */}
          <div className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-slate-400 hover:text-slate-200 font-extrabold text-xs uppercase tracking-wider transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className={`px-6 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300 shadow-md flex items-center gap-1.5 ${
                approveType === 'Approve'
                  ? 'bg-white hover:bg-slate-100 text-slate-950'
                  : 'bg-orange-500 hover:bg-orange-600 text-white'
              }`}
            >
              {submitting ? (
                <>
                  <span className="animate-spin rounded-full h-3 w-3 border-t-2 border-b-2 border-slate-800" />
                  Saving…
                </>
              ) : `Save Approval (${approveType})`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Main Requisition Creation Form Modal
const RequisitionFormModal = ({ projects, estimates, mainHeads, onClose, onSave, requisitions }) => {
  const { user } = useAuth();

  // Filter projects (work orders) to only those that have a 'Final Approved' estimate
  const filteredProjects = projects.map(p => {
    const approvedEst = estimates.find(e => e.work_order_no === p.work_order_no && e.estimate_status === 'Final Approved');
    return {
      ...p,
      approvedEst
    };
  }).filter(p => p.approvedEst);
  
  // Step 1 read-only values
  const systemDateStr = new Date().toLocaleDateString('en-IN', { dateStyle: 'medium' });
  const username = user?.display_name || user?.mobile_number;

  // Form State
  const [step, setStep] = useState(1);
  const [selectedWO, setSelectedWO] = useState('');
  
  // Step 3 state fields
  const [requisitionNo, setRequisitionNo] = useState('');
  const [materialHead, setMaterialHead] = useState('');
  const [reqAmount, setReqAmount] = useState('');
  const [gstBill, setGstBill] = useState('No');
  const [bankDetails, setBankDetails] = useState('');
  const [remarks, setRemarks] = useState('');

  // Upload state
  const [requisitionPdf, setRequisitionPdf] = useState(null); // original file
  const [requisitionPdfUrl, setRequisitionPdfUrl] = useState(''); // storage path
  const [requisitionPdfPreview, setRequisitionPdfPreview] = useState(''); // signed url
  const [isUploadingReq, setIsUploadingReq] = useState(false);
  const [reqUploadProgress, setReqUploadProgress] = useState(0);

  const [gstPdf, setGstPdf] = useState(null); // original file
  const [gstPdfUrl, setGstPdfUrl] = useState(''); // storage path
  const [gstPdfPreview, setGstPdfPreview] = useState(''); // signed url
  const [isUploadingGst, setIsUploadingGst] = useState(false);
  const [gstUploadProgress, setGstUploadProgress] = useState(0);

  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Auto-lookup project geographical and estimate data during render
  const projectMetadata = (() => {
    if (!selectedWO) return null;
    const proj = projects.find(p => p.work_order_no === selectedWO);
    if (!proj) return null;
    // Find approved estimate
    const projEstimates = estimates.filter(
      e => e.work_order_no === selectedWO && e.estimate_status === 'Final Approved'
    );
    const approvedEstimate = projEstimates[0]; // Get latest update
    const estimateAmount = approvedEstimate ? Number(approvedEstimate.estimate_amount) : null;
    return {
      ...proj,
      estimateAmount
    };
  })();

  // Compute Advisory Remaining Balance
  const getAdvisoryBalance = () => {
    if (!projectMetadata || projectMetadata.estimateAmount === null) return null;
    const committed = requisitions
      .filter(r => r.work_order_no === selectedWO && r.requisition_status !== 'Cancelled')
      .reduce((sum, r) => sum + Number(r.requisition_amount), 0);
    return projectMetadata.estimateAmount - committed;
  };

  const advisoryRemaining = getAdvisoryBalance();

  // Reset GST Upload state if toggled to No
  const handleGstToggle = (val) => {
    setGstBill(val);
    if (val === 'No') {
      setGstPdf(null);
      setGstPdfUrl('');
      setGstPdfPreview('');
    }
  };

  // Immediate upload handler for Requisition PDF
  const handleRequisitionPdfSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError('');

    // Client-side validations
    if (file.type !== 'application/pdf') {
      setError('Only PDF files are accepted.');
      e.target.value = null;
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('File size must not exceed 5MB.');
      e.target.value = null;
      return;
    }

    const expectedName = `${requisitionNo}.pdf`.toLowerCase();
    if (file.name.toLowerCase() !== expectedName) {
      setError(`File name must match Requisition Number exactly (expected: ${requisitionNo}.pdf).`);
      e.target.value = null;
      return;
    }

    setIsUploadingReq(true);
    setReqUploadProgress(20);
    try {
      setReqUploadProgress(50);
      const res = await uploadRequisitionPdf(file, requisitionNo);
      setReqUploadProgress(100);
      setRequisitionPdf(file);
      setRequisitionPdfUrl(res.data.storagePath);
      setRequisitionPdfPreview(res.data.signedUrl);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to upload Requisition PDF.');
      e.target.value = null;
    } finally {
      setIsUploadingReq(false);
    }
  };

  // Clear PDF handler to reset upload state and unlock requisition number
  const handleClearRequisitionPdf = () => {
    setRequisitionPdf(null);
    setRequisitionPdfUrl('');
    setRequisitionPdfPreview('');
    setReqUploadProgress(0);
  };

  // Immediate upload handler for GST Bill PDF
  const handleGstPdfSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError('');

    // Client-side validations
    if (file.type !== 'application/pdf') {
      setError('Only PDF files are accepted.');
      e.target.value = null;
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('File size must not exceed 5MB.');
      e.target.value = null;
      return;
    }

    setIsUploadingGst(true);
    setGstUploadProgress(20);
    try {
      setGstUploadProgress(50);
      const res = await uploadGstBillPdf(file, requisitionNo);
      setGstUploadProgress(100);
      setGstPdf(file);
      setGstPdfUrl(res.data.storagePath);
      setGstPdfPreview(res.data.signedUrl);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to upload GST Bill PDF.');
      e.target.value = null;
    } finally {
      setIsUploadingGst(false);
    }
  };

  const handleClearGstPdf = () => {
    setGstPdf(null);
    setGstPdfUrl('');
    setGstPdfPreview('');
    setGstUploadProgress(0);
  };

  // Final submit save
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Fields checks
    if (!selectedWO) {
      setError('Please select a Work Order.');
      return;
    }
    if (!requisitionNo.trim()) {
      setError('Requisition Number is required.');
      return;
    }
    if (!materialHead) {
      setError('Please select a Material Main Head.');
      return;
    }
    if (!requisitionPdfUrl) {
      setError('Please upload the Requisition PDF.');
      return;
    }
    if (isNaN(Number(reqAmount)) || Number(reqAmount) <= 0) {
      setError('Requisition Amount must be a positive number greater than zero.');
      return;
    }
    if (gstBill === 'Yes' && !gstPdfUrl) {
      setError('GST Bill is toggled to Yes but no GST Invoice PDF has been uploaded.');
      return;
    }
    if (!bankDetails.trim()) {
      setError('Bank details are required.');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        work_order_no: selectedWO.trim(),
        requisition_no: requisitionNo.trim(),
        material_main_head: materialHead.trim(),
        requisition_pdf_url: requisitionPdfUrl.trim(),
        original_filename: requisitionPdf?.name || null,
        requisition_amount: Number(reqAmount),
        gst_bill: gstBill,
        gst_bill_pdf_url: gstBill === 'Yes' ? gstPdfUrl.trim() : null,
        bank_details: bankDetails.trim(),
        expen_head_remarks: remarks.trim() || null
      };
      await onSave(payload);
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to submit requisition.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="glass-panel p-6 rounded-3xl max-w-lg w-full shadow-[0_25px_60px_rgba(0,0,0,0.7)] border border-white/10 relative overflow-hidden my-8">
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-amber-500/5 blur-3xl pointer-events-none" />

        <div className="flex justify-between items-center mb-6 relative z-10">
          <div>
            <span className="text-[9px] font-bold uppercase tracking-widest text-amber-500 font-mono">
              Step {step} of 3
            </span>
            <h2 className="text-sm font-extrabold uppercase tracking-widest text-slate-100 mt-0.5">
              Create Requisition
            </h2>
          </div>
          <button onClick={onClose} disabled={submitting} className="text-slate-400 hover:text-slate-200 transition-colors p-1">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-950/20 border border-red-900/30 rounded-xl text-xs text-red-300 flex items-center gap-2.5">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
            {error}
          </div>
        )}

        {/* ──────── STEP 1: USER DETAILS (AUTO-FILLED) ──────── */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="bg-white/[0.01] border border-white/5 p-5 rounded-2xl space-y-3.5">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Logged In User</p>
                <p className="text-xs font-semibold text-slate-200 mt-0.5">{username}</p>
              </div>
              <div className="border-t border-white/5 pt-3.5">
                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Creation Date (System Timestamp)</p>
                <p className="text-xs font-semibold text-slate-200 mt-0.5">{systemDateStr}</p>
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="bg-white hover:bg-slate-100 text-slate-950 px-6 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300 shadow-md flex items-center gap-1.5"
              >
                Next Step &rarr;
              </button>
            </div>
          </div>
        )}

        {/* ──────── STEP 2: MASTER DATA SELECTION ──────── */}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                Work Order No. <span className="text-red-400">*</span>
              </label>
              <select
                value={selectedWO}
                onChange={(e) => setSelectedWO(e.target.value)}
                className="w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-xs font-semibold text-slate-200 transition"
              >
                <option value="">-- Choose Work Order --</option>
                {filteredProjects.map((p) => (
                  <option key={p.work_order_no} value={p.work_order_no}>
                    {p.work_order_no} ({p.approvedEst.estimate_no})
                  </option>
                ))}
              </select>
            </div>

            {projectMetadata && (
              <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-4 space-y-3">
                <p className="text-[9px] font-bold uppercase tracking-widest text-indigo-400 mb-1">
                  &darr; Auto-populated geographic and estimate snapshots
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Estimate No.</p>
                    <p className="text-xs font-semibold text-slate-300 mt-0.5 truncate">{projectMetadata.estimate_no}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Estimate Amount</p>
                    <p className="text-xs font-mono font-bold text-emerald-400 mt-0.5">
                      {projectMetadata.estimateAmount !== null ? formatCurrency(projectMetadata.estimateAmount) : 'No Approved Estimate'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">State / District</p>
                    <p className="text-xs font-semibold text-slate-300 mt-0.5 truncate">{projectMetadata.state} / {projectMetadata.district}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Zone / Dept.</p>
                    <p className="text-xs font-semibold text-slate-300 mt-0.5 truncate">{projectMetadata.zone} / {projectMetadata.department}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Site Details</p>
                    <p className="text-xs font-semibold text-slate-300 mt-0.5">{projectMetadata.site_details}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-between items-center pt-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="px-4 py-2 text-slate-400 hover:text-slate-200 font-extrabold text-xs uppercase tracking-wider transition"
              >
                &larr; Back
              </button>
              <button
                type="button"
                disabled={!selectedWO}
                onClick={() => setStep(3)}
                className="bg-white hover:bg-slate-100 text-slate-950 px-6 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300 shadow-md flex items-center gap-1.5 disabled:opacity-40"
              >
                Next Step &rarr;
              </button>
            </div>
          </div>
        )}

        {/* ──────── STEP 3: CREATOR INPUT FORM ──────── */}
        {step === 3 && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="max-h-[380px] overflow-y-auto pr-1 space-y-4 scroll-smooth">
              
              {/* Requisition NO. */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                  Requisition Number <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={requisitionNo}
                  onChange={(e) => setRequisitionNo(e.target.value.replace(/[^A-Za-z0-9_\-.]/g, ''))}
                  placeholder="e.g. REQ-WO-001"
                  required
                  disabled={requisitionPdfUrl !== '' || submitting}
                  className={`w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-xs font-semibold text-slate-100 transition ${requisitionPdfUrl !== '' ? 'opacity-50 cursor-not-allowed' : ''}`}
                />
                {requisitionPdfUrl && (
                  <p className="text-[9px] text-amber-500 font-semibold mt-1">Requisition number is locked while PDF is uploaded.</p>
                )}
              </div>

              {/* Material Main Head */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                  Material Main Head <span className="text-red-400">*</span>
                </label>
                <select
                  value={materialHead}
                  onChange={(e) => setMaterialHead(e.target.value)}
                  required
                  disabled={submitting}
                  className="w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-xs font-semibold text-slate-200 transition"
                >
                  <option value="">-- Select Material Head --</option>
                  {mainHeads.map((head) => (
                    <option key={head} value={head}>
                      {head}
                    </option>
                  ))}
                </select>
              </div>

              {/* Requisition PDF Upload */}
              <div className="p-4 border border-white/5 rounded-2xl bg-white/[0.01]">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                  Upload Requisition PDF <span className="text-red-400">*</span>
                </label>
                {!requisitionPdfUrl ? (
                  <div className="space-y-2">
                    <input
                      type="file"
                      accept=".pdf"
                      disabled={!requisitionNo.trim() || isUploadingReq || submitting}
                      onChange={handleRequisitionPdfSelect}
                      className="block w-full text-xs text-slate-500 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-[10px] file:font-bold file:uppercase file:bg-white/10 file:text-slate-300 file:cursor-pointer hover:file:bg-white/20 transition file:disabled:opacity-40"
                    />
                    {!requisitionNo.trim() && (
                      <p className="text-[9px] text-slate-500 font-semibold">Enter a Requisition Number first to enable upload.</p>
                    )}
                    {isUploadingReq && (
                      <div className="flex items-center gap-2 mt-2">
                        <span className="animate-spin rounded-full h-3 w-3 border-t-2 border-b-2 border-amber-500" />
                        <span className="text-[9px] uppercase tracking-widest text-slate-500 font-bold">Uploading ({reqUploadProgress}%)…</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-between bg-white/5 px-3 py-2 rounded-xl">
                    <div className="flex items-center gap-2 truncate">
                      <span className="text-emerald-400 text-xs">✓</span>
                      <span className="text-[11px] font-semibold text-slate-200 truncate">{requisitionPdf?.name || 'Requisition PDF Uploaded'}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {requisitionPdfPreview && (
                        <a
                          href={requisitionPdfPreview}
                          target="_blank"
                          rel="noreferrer"
                          className="px-2.5 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-[9px] uppercase font-bold tracking-wider rounded-lg transition"
                        >
                          Preview
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={handleClearRequisitionPdf}
                        className="p-1.5 bg-red-950/20 hover:bg-red-950/40 text-red-400 border border-red-900/20 rounded-lg text-[9px] uppercase font-bold transition"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Requisition Amount */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                  Requisition Amount (₹) <span className="text-red-400">*</span>
                </label>
                <input
                  type="number"
                  value={reqAmount}
                  onChange={(e) => setReqAmount(e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  min="0.01"
                  required
                  disabled={submitting}
                  className="w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-xs font-semibold text-slate-100 transition"
                />

                {/* Advisory Balance Display */}
                {projectMetadata && projectMetadata.estimateAmount !== null && (
                  <div className="mt-3 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-2">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-amber-400">
                      Advisory Estimate Balance indicator
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div className="text-slate-400">Estimate Limit:</div>
                      <div className="text-slate-200 font-mono text-right">{formatCurrency(projectMetadata.estimateAmount)}</div>
                      <div className="text-slate-400">Advisory Remaining:</div>
                      <div className="text-amber-400 font-mono font-semibold text-right">{formatCurrency(advisoryRemaining)}</div>
                    </div>
                    <p className="text-[9px] text-slate-500 font-semibold border-t border-amber-500/10 pt-1.5 leading-relaxed">
                      * Values are advisory and computed based on currently loaded requisitions in state. The backend remains the source of truth.
                    </p>
                  </div>
                )}
              </div>

              {/* GST Bill Toggle */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                  GST Bill Included? <span className="text-red-400">*</span>
                </label>
                <select
                  value={gstBill}
                  onChange={(e) => handleGstToggle(e.target.value)}
                  required
                  disabled={submitting}
                  className="w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-xs font-semibold text-slate-200 transition"
                >
                  <option value="No">No</option>
                  <option value="Yes">Yes</option>
                </select>
              </div>

              {/* GST Bill PDF Upload */}
              {gstBill === 'Yes' && (
                <div className="p-4 border border-white/5 rounded-2xl bg-white/[0.01]">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                    Upload GST Invoice PDF <span className="text-red-400">*</span>
                  </label>
                  {!gstPdfUrl ? (
                    <div className="space-y-2">
                      <input
                        type="file"
                        accept=".pdf"
                        disabled={!requisitionNo.trim() || isUploadingGst || submitting}
                        onChange={handleGstPdfSelect}
                        className="block w-full text-xs text-slate-500 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-[10px] file:font-bold file:uppercase file:bg-white/10 file:text-slate-300 file:cursor-pointer hover:file:bg-white/20 transition file:disabled:opacity-40"
                      />
                      {!requisitionNo.trim() && (
                        <p className="text-[9px] text-slate-500 font-semibold">Enter a Requisition Number first to enable upload.</p>
                      )}
                      {isUploadingGst && (
                        <div className="flex items-center gap-2 mt-2">
                          <span className="animate-spin rounded-full h-3 w-3 border-t-2 border-b-2 border-amber-500" />
                          <span className="text-[9px] uppercase tracking-widest text-slate-500 font-bold">Uploading ({gstUploadProgress}%)…</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-between bg-white/5 px-3 py-2 rounded-xl">
                      <div className="flex items-center gap-2 truncate">
                        <span className="text-emerald-400 text-xs">✓</span>
                        <span className="text-[11px] font-semibold text-slate-200 truncate">{gstPdf?.name || 'GST PDF Uploaded'}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {gstPdfPreview && (
                          <a
                            href={gstPdfPreview}
                            target="_blank"
                            rel="noreferrer"
                            className="px-2.5 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-[9px] uppercase font-bold tracking-wider rounded-lg transition"
                          >
                            Preview
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={handleClearGstPdf}
                          className="p-1.5 bg-red-950/20 hover:bg-red-950/40 text-red-400 border border-red-900/20 rounded-lg text-[9px] uppercase font-bold transition"
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Bank Details */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                  Bank Details <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={bankDetails}
                  onChange={(e) => setBankDetails(e.target.value)}
                  placeholder="Enter payee bank name, branch, account number, and IFSC code…"
                  rows={2}
                  required
                  disabled={submitting}
                  className="w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-xs font-semibold text-slate-100 transition resize-none"
                />
              </div>

              {/* Remarks */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                  Expenditure Head Remarks (Optional)
                </label>
                <textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Optional notes or head of expenditure remarks…"
                  rows={2}
                  disabled={submitting}
                  className="w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-xs font-semibold text-slate-100 transition resize-none"
                />
              </div>

            </div>

            <div className="flex justify-between items-center pt-2">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="px-4 py-2 text-slate-400 hover:text-slate-200 font-extrabold text-xs uppercase tracking-wider transition"
              >
                &larr; Back
              </button>
              <button
                type="submit"
                disabled={submitting || isUploadingReq || isUploadingGst}
                className="bg-white hover:bg-slate-100 text-slate-950 px-6 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300 shadow-md disabled:opacity-50 flex items-center gap-1.5"
              >
                {submitting ? (
                  <>
                    <span className="animate-spin rounded-full h-3 w-3 border-t-2 border-b-2 border-slate-800" />
                    Saving…
                  </>
                ) : 'Save Requisition'}
              </button>
            </div>
          </form>
        )}

      </div>
    </div>
  );
};

// Main Requisitions Page Component
const Requisitions = () => {
  const { user } = useAuth();
  const isCreator = ['je', 'admin'].includes(user?.role);

  const [requisitions, setRequisitions] = useState([]);
  const [projects, setProjects] = useState([]);
  const [estimates, setEstimates] = useState([]);
  const [mainHeads, setMainHeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // UI state
  const [search, setSearch] = useState('');
  const [activeReqId, setActiveReqId] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [cancelTarget, setCancelTarget] = useState(null); // { id, no }
  const [isCancelling, setIsCancelling] = useState(false);

  // M6b Approver tab and action states
  const [currentTab, setCurrentTab] = useState(user?.role === 'je' ? 'all' : 'pending');
  const [actionTargetReq, setActionTargetReq] = useState(null);

  // Fetch all core datasets
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [reqRes, projRes, estRes, categoriesRes] = await Promise.all([
        getRequisitions(),
        getProjects(),
        getEstimates(),
        getMaterialCategories()
      ]);
      setRequisitions(reqRes.data?.requisitions ?? []);
      setProjects(projRes.data?.projects ?? []);
      setEstimates(estRes.data?.estimates ?? []);
      setMainHeads(categoriesRes.data?.mainHeads ?? []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load requisitions data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAll();
  }, [fetchAll]);

  // Success auto-dismiss
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(''), 4500);
    return () => clearTimeout(timer);
  }, [success]);

  // Create requisition save callback
  const handleCreate = async (payload) => {
    await createRequisition(payload);
    setSuccess(`Requisition ${payload.requisition_no} submitted successfully.`);
    fetchAll();
  };

  // M6b Approve/Hold action callback
  const handleAct = async (id, actionPayload) => {
    await actOnRequisition(id, actionPayload);
    setSuccess(`Requisition successfully ${actionPayload.action === 'Approve' ? 'approved' : 'placed on hold'}.`);
    fetchAll();
  };

  // Cancel requisition confirm callback
  const handleCancelConfirm = async () => {
    if (!cancelTarget) return;
    setIsCancelling(true);
    setError('');
    try {
      await cancelRequisition(cancelTarget.id);
      setSuccess(`Requisition ${cancelTarget.no} cancelled successfully.`);
      setCancelTarget(null);
      // Close detail view if open
      setActiveReqId(null);
      fetchAll();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to cancel requisition.');
    } finally {
      setIsCancelling(false);
    }
  };

  // Filter requisitions list based on search bar and currentTab
  const getFilteredRequisitions = () => {
    let list = [...requisitions];
    
    // Filter by tab if role is zo, ho, admin
    if (['zo', 'ho', 'admin'].includes(user?.role)) {
      if (currentTab === 'pending') {
        list = list.filter(r => r.requisition_status === 'Pending');
      }
    }

    const q = search.toLowerCase();
    if (q) {
      list = list.filter(
        r =>
          r.requisition_no?.toLowerCase().includes(q) ||
          r.work_order_no?.toLowerCase().includes(q) ||
          r.material_main_head?.toLowerCase().includes(q) ||
          r.requisition_status?.toLowerCase().includes(q)
      );
    }
    return list;
  };

  const filteredRequisitions = getFilteredRequisitions();

  // Stats computation
  const totalCount = requisitions.length;
  const pendingCount = requisitions.filter(r => r.requisition_status === 'Pending').length;
  const approvedCount = requisitions.filter(r => r.requisition_status === 'Approved').length;
  const holdOrCancelCount = requisitions.filter(r => r.requisition_status === 'Hold' || r.requisition_status === 'Cancelled').length;

  return (
    <div className="h-screen bg-black text-slate-100 flex flex-col md:flex-row font-sans relative overflow-hidden">
      <BackgroundShapes />
      <Sidebar />
      <MobileHeader />

      <main className="flex-grow p-6 md:p-10 overflow-y-auto w-full relative z-10">
        
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-8 pb-6 border-b border-white/5">
          <div className="text-left">
            <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">
              Government Division · Requisition
            </span>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Requisition Management</h1>
            <p className="text-xs text-slate-400 font-medium mt-1.5">
              Submit and manage payment requisitions against estimate work orders.
            </p>
          </div>
          {isCreator && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="bg-white hover:bg-slate-100 text-slate-950 px-5 py-3 rounded-xl text-xs font-bold uppercase tracking-wider shadow-lg hover:shadow-xl transition-all duration-300 flex items-center gap-2 shrink-0 transform hover:-translate-y-0.5"
            >
              <svg className="w-4 h-4 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Requisition
            </button>
          )}
        </div>

        {/* Stat Cards Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Total Requisitions', value: totalCount, accent: 'from-indigo-500/20 to-indigo-500/5', border: 'border-indigo-500/20' },
            { label: 'Pending Authority', value: pendingCount, accent: 'from-amber-500/20 to-amber-500/5', border: 'border-amber-500/20' },
            { label: 'Approved Requests', value: approvedCount, accent: 'from-emerald-500/20 to-emerald-500/5', border: 'border-emerald-500/20' },
            { label: 'Hold / Cancelled', value: holdOrCancelCount, accent: 'from-red-500/20 to-red-500/5', border: 'border-red-500/20' },
          ].map(({ label, value, accent, border }) => (
            <div key={label} className={`glass-panel rounded-2xl p-5 border ${border} bg-gradient-to-br ${accent}`}>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{label}</p>
              <p className="font-black text-slate-100 mt-1.5 text-3xl tabular-nums">{value}</p>
            </div>
          ))}
        </div>

        {/* Notifications */}
        {error && (
          <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 mb-5 flex items-center gap-2.5 animate-pulse">
            <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
            {error}
          </div>
        )}
        {success && (
          <div className="p-4 bg-emerald-950/20 border border-emerald-900/30 rounded-2xl text-xs text-emerald-300 mb-5 flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            {success}
          </div>
        )}

        {/* Search Bar, Tabs & Refresh */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-5">
          {['zo', 'ho', 'admin'].includes(user?.role) ? (
            <div className="flex items-center gap-1 glass-panel p-1 rounded-xl border border-white/5">
              {[
                { id: 'pending', label: 'Pending Queue' },
                { id: 'all', label: 'All Requisitions' }
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setCurrentTab(t.id)}
                  className={`px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all duration-200 ${
                    currentTab === t.id
                      ? 'bg-white/10 text-slate-100 border border-white/10'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t.label} ({t.id === 'pending' ? requisitions.filter(r => r.requisition_status === 'Pending').length : requisitions.length})
                </button>
              ))}
            </div>
          ) : (
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Requisitions List</span>
          )}
          <div className="flex items-center gap-3">
            <div className="relative">
              <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search requisitions…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="glass-input focus:ring-0 outline-none rounded-xl pl-10 pr-4 py-2.5 text-xs text-slate-200 transition w-48 sm:w-60 font-semibold"
              />
            </div>
            <button
              onClick={fetchAll}
              title="Refresh"
              className="p-2.5 rounded-xl glass-input hover:border-white/20 transition text-slate-400 hover:text-slate-200"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>

        {/* Requisitions List Table */}
        <div className="glass-panel rounded-3xl overflow-hidden shadow-2xl border border-white/5">
          {loading ? (
            <div className="flex items-center justify-center p-24">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500" />
            </div>
          ) : filteredRequisitions.length === 0 ? (
            <div className="text-center p-24 text-slate-500 text-xs uppercase font-extrabold tracking-widest">
              No requisitions matching parameters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/5 bg-white/[0.02] text-[9px] uppercase tracking-widest text-slate-500">
                    {['Requisition No.', 'Work Order', 'Material Head', 'Amount', 'Status', 'Submitted Date', 'Actions'].map((h) => (
                      <th key={h} className="py-4 px-5 font-extrabold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-xs text-slate-300">
                  {filteredRequisitions.map((req) => {
                    const isPending = req.requisition_status === 'Pending';
                    const isOwner = req.requester_user_id === user?.mobile_number;
                    const isAdmin = user?.role === 'admin';
                    const canCancel = isPending && (isOwner || isAdmin);
                    return (
                      <tr key={req.requisition_id} className="hover:bg-white/[0.025] transition-colors duration-200 group">
                        <td className="py-4 px-5 font-mono font-semibold text-slate-100 whitespace-nowrap">
                          {req.requisition_no}
                        </td>
                        <td className="py-4 px-5 font-mono text-slate-400 whitespace-nowrap">
                          {req.work_order_no}
                        </td>
                        <td className="py-4 px-5 text-slate-300 font-semibold whitespace-nowrap">
                          {req.material_main_head}
                        </td>
                        <td className="py-4 px-5 font-mono font-bold text-amber-500 whitespace-nowrap">
                          {formatCurrency(req.requisition_amount)}
                        </td>
                        <td className="py-4 px-5 whitespace-nowrap">
                          <StatusBadge status={req.requisition_status} />
                        </td>
                        <td className="py-4 px-5 text-[11px] text-slate-500 whitespace-nowrap">
                          {formatDate(req.created_at)}
                        </td>
                        <td className="py-4 px-5 whitespace-nowrap">
                          <div className="flex items-center gap-2 opacity-60 group-hover:opacity-100 transition-opacity duration-200">
                            {/* View details */}
                            <button
                              onClick={() => setActiveReqId(req.requisition_id)}
                              className="px-3 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 hover:bg-indigo-500/20 transition-all font-bold text-[10px] uppercase tracking-wider"
                            >
                              View Details
                            </button>

                            {/* Take Action Button (ZO/HO/Admin for Pending rows only) */}
                            {isPending && ['zo', 'ho', 'admin'].includes(user?.role) && (
                              <button
                                onClick={() => setActionTargetReq(req)}
                                className="px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 transition-all font-bold text-[10px] uppercase tracking-wider"
                              >
                                Take Action
                              </button>
                            )}
                            
                            {/* Cancel Button */}
                            {canCancel && (
                              <button
                                onClick={() => setCancelTarget({ id: req.requisition_id, no: req.requisition_no })}
                                className="px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all font-bold text-[10px] uppercase tracking-wider"
                              >
                                Cancel
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="px-5 py-3 border-t border-white/5 bg-white/[0.01] text-[10px] text-slate-600 font-mono">
                Showing {filteredRequisitions.length} of {requisitions.length} records
              </div>
            </div>
          )}
        </div>

      </main>

      {/* Creation Modal */}
      {showCreateModal && (
        <RequisitionFormModal
          projects={projects}
          estimates={estimates}
          mainHeads={mainHeads}
          requisitions={requisitions}
          onClose={() => setShowCreateModal(false)}
          onSave={handleCreate}
        />
      )}

      {/* Detail Modal */}
      {activeReqId && (
        <RequisitionDetailModal
          reqId={activeReqId}
          user={user}
          onClose={() => setActiveReqId(null)}
          onCancelClick={(id, no) => setCancelTarget({ id, no })}
        />
      )}

      {/* Confirm Cancel Modal */}
      {cancelTarget && (
        <CancelConfirmModal
          requisitionNo={cancelTarget.no}
          isCancelling={isCancelling}
          onConfirm={handleCancelConfirm}
          onClose={() => setCancelTarget(null)}
        />
      )}

      {/* Action Approve/Hold Modal */}
      {actionTargetReq && (
        <ActionModal
          requisition={actionTargetReq}
          onClose={() => setActionTargetReq(null)}
          onSave={handleAct}
        />
      )}

    </div>
  );
};

export default Requisitions;
