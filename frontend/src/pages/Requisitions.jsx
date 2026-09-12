import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../components/AuthContext';
import { getProjects } from '../api/projectsApi';
import { getEstimates, getEstimateById } from '../api/estimatesApi';
import { getMaterialCategories } from '../api/materialsApi';
import {
  getRequisitions,
  getRequisitionById,
  createRequisition,
  actOnRequisition,
  payFromZoBalance,
  sendRequisitionToAccounts,
  cancelRequisition,
  uploadRequisitionPdf,
  uploadGstBillPdf,
  deleteRequisitionPdf,
  deleteGstBillPdf,
  getMainHeadCapacity,
  getSubcontractorCapacity,
  getIndianBanks
} from '../api/requisitionsApi';
import { computeRequisitionAdvisoryRemaining } from '../utils/businessRules/requisitions';
import { formatPaymentOffice, getRequisitionFinancialState } from '../utils/requisitionUtils';
import { getZonalBalances } from '../api/zoBalancesApi';
import { getFundRequests } from '../api/fundRequests';
import { getReturnRequests } from '../api/fundReturnsApi';
import { exportCombinedExpenditureSheet } from '../utils/exportHelpers';
import ProjectBeneficiarySuggestions from '../components/requisitions/ProjectBeneficiarySuggestions';
import ExportExpenditureModal from '../components/requisitions/ExportExpenditureModal';
import { Button, Input, FormattedCurrencyInput, TextArea, Select, Badge, Modal, Table, TableHeader, TableBody, TableRow, TableCell, SkeletonTable, SkeletonCard, Pagination } from '../components/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';

// Helper for currency formatting
const formatCurrency = (val) =>
  val != null ? `₹ ${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';

// Helper for date formatting
const formatDate = (d) =>
  d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

// Colored status badge component
const StatusBadge = ({ status }) => {
  const cfg = {
    Pending: { variant: 'amber', label: 'Pending' },
    Approved: { variant: 'emerald', label: 'Approved' },
    Hold: { variant: 'orange', label: 'Hold' },
    Cancelled: { variant: 'slate', label: 'Cancelled' },
  };
  const s = cfg[status] ?? { variant: 'indigo', label: status || 'Pending' };
  return (
    <Badge variant={s.variant} showDot={true}>
      {s.label}
    </Badge>
  );
};

const PAYMENT_STATUS_LABELS = {
  AWAITING_PAYMENT_ROUTE: 'Awaiting Payment Route',
  PENDING_ACCOUNTS_IMPORT: 'Pending Accounts Import',
  ACCOUNTS_DRAFT: 'Accounts Draft',
  PENDING_HO_REVIEW: 'Pending HO Review',
  PENDING_REVIEW: 'Pending Review',
  ON_HOLD: 'On Hold',
  RETURNED_FOR_CORRECTION: 'Returned for Correction',
  REJECTED: 'Rejected',
  PARTIALLY_PAID: 'Partially Paid',
  PAID: 'Paid'
};

const getRequisitionDisplayStatus = (req) => (
  req.requisition_status === 'Approved' && req.payment_status
    ? PAYMENT_STATUS_LABELS[req.payment_status] || req.payment_status
    : req.requisition_status
);

// Modal for confirming cancellation
const CancelConfirmModal = ({ requisitionNo, isCancelling, onConfirm, onClose }) => (
  <Modal
    isOpen={true}
    onClose={onClose}
    title="Cancel Requisition"
    subtitle="Permanent Action Warning"
    size="sm"
    footer={
      <>
        <Button variant="secondary" onClick={onClose} disabled={isCancelling} size="sm">
          Keep Requisition
        </Button>
        <Button variant="danger" onClick={onConfirm} loading={isCancelling} size="sm" className="shadow-lg shadow-red-500/20">
          Confirm Cancellation
        </Button>
      </>
    }
  >
    <div className="p-4 rounded-2xl bg-red-950/20 border border-red-500/20 text-left space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-red-500/10 border border-red-500/20 shrink-0">
          <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-red-400">Irreversible Deletion Guard</h4>
          <p className="text-[10px] text-slate-400 mt-0.5">This requisition will be permanently archived and marked as Cancelled.</p>
        </div>
      </div>
      <div className="pt-2 border-t border-white/5 text-xs text-slate-300">
        Requisition Reference: <span className="font-mono font-extrabold text-amber-400">{requisitionNo}</span>
      </div>
    </div>
  </Modal>
);

// Detail Modal for viewing requisition metadata and PDF previews
const RequisitionDetailModal = ({ reqId, onClose, user, onCancelClick }) => {
  const queryClient = useQueryClient();
  const [showRouteModal, setShowRouteModal] = useState(false);

  const { data: requisition, isLoading: loading, error: queryError } = useQuery({
    queryKey: ['requisition', reqId],
    queryFn: async () => {
      const res = await getRequisitionById(reqId);
      return res.data?.requisition;
    }
  });

  const handleChooseRoute = async (id, route) => {
    if (route === 'ZO_BALANCE') {
      await payFromZoBalance(id);
    } else {
      await sendRequisitionToAccounts(id);
    }
    queryClient.invalidateQueries({ queryKey: ['requisition', reqId] });
    queryClient.invalidateQueries({ queryKey: ['requisitions'] });
  };

  if (loading) {
    return (
      <Modal isOpen={true} onClose={null} size="sm">
        <SkeletonCard />
      </Modal>
    );
  }

  const error = queryError?.response?.data?.message || queryError?.message;

  if (error || !requisition) {
    return (
      <Modal
        isOpen={true}
        onClose={onClose}
        title="Error"
        size="sm"
        footer={
          <Button variant="glass" size="sm" onClick={onClose} className="w-full">
            Close
          </Button>
        }
      >
        <p className="text-xs text-slate-400 mb-2">{error || 'Requisition not found.'}</p>
      </Modal>
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
    ...(requisition.material_main_head === 'Sub Contractor' ? [
      { label: 'Sub Head', value: requisition.material_sub_head },
      { label: 'Subcontractor', value: requisition.material_details }
    ] : []),
    { label: 'Requisition Amount', value: formatCurrency(requisition.requisition_amount), accent: 'text-amber-400 font-bold' },
    { label: 'Payment Office', value: formatPaymentOffice(requisition.payment_destination) },
    { label: 'State', value: requisition.state },
    { label: 'District', value: requisition.district },
    { label: 'Zone / Area', value: requisition.area_code },
    { label: 'Department', value: requisition.department },
    { label: 'Site Details', value: requisition.site_details },
    ...(requisition.beneficiary_ac_no || requisition.beneficiary_name ? [
      { label: 'Beneficiary Name', value: requisition.beneficiary_name || '—' },
      { label: 'Beneficiary A/C No.', value: requisition.beneficiary_ac_no || '—', mono: true },
      { label: 'Beneficiary IFSC', value: requisition.beneficiary_ifsc || '—', mono: true },
      { label: 'Beneficiary Bank', value: requisition.beneficiary_bank?.bank_name || requisition.beneficiary_bank_name || '—' }
    ] : []),
    { label: 'Bank Details', value: requisition.bank_details },
    { label: 'Expenditure Remarks', value: requisition.expen_head_remarks || '—' },
    { label: 'Created By', value: requisition.requester_name || requisition.requester_user_id, mono: true },
    { label: 'Created At', value: formatDate(requisition.created_at) },
  ];

  const canChooseRoute = requisition.requisition_status === 'Approved'
    && !requisition.payment_destination
    && ['zo', 'admin'].includes(user?.role);

  if (requisition.requisition_status === 'Approved') {
    detailRows.push(
      { label: 'ZO Approved By', value: requisition.approved_name || requisition.approved_user_id, mono: true },
      { label: 'ZO Approved Amount', value: formatCurrency(requisition.approved_amount), accent: 'text-emerald-400 font-bold' },
      { label: 'Approved Balance', value: formatCurrency(requisition.approved_balance_amount) },
      { label: 'ZO Actioned On', value: formatDate(requisition.zo_actioned_at) },
      { label: 'Payment Status', value: PAYMENT_STATUS_LABELS[requisition.payment_status] || requisition.payment_status || '—' },
      { label: 'Paid Amount', value: formatCurrency(requisition.paid_amount) },
      { label: 'Payment Date', value: formatDate(requisition.payment_date) },
      { label: 'Authority Remarks', value: requisition.remarks_approved_authority || '—' }
    );
  } else if (requisition.requisition_status === 'Hold') {
    detailRows.push(
      { label: 'Placed on Hold By', value: requisition.approved_name || requisition.approved_user_id, mono: true },
      { label: 'Hold Date', value: formatDate(requisition.zo_actioned_at || requisition.payment_date) },
      { label: 'Hold Remarks', value: requisition.remarks_approved_authority || '—' }
    );
  } else if (requisition.requisition_status === 'Cancelled') {
    detailRows.push(
      { label: 'Cancelled By', value: requisition.cancelled_name || requisition.cancelled_by, mono: true },
      { label: 'Cancelled At', value: formatDate(requisition.cancelled_at) }
    );
  }

  return (
    <>
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Requisition Details"
      subtitle={`Requisition ID: ${requisition.requisition_no}`}
      size="xl"
      footer={
        <>
          {showCancel && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => onCancelClick(requisition.requisition_id, requisition.requisition_no)}
            >
              Cancel Requisition
            </Button>
          )}
          {canChooseRoute && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowRouteModal(true)}
            >
              Choose Payment Route
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={onClose}
          >
            Close Details
          </Button>
        </>
      }
    >
      <div className="flex flex-col md:flex-row gap-6">
        {/* Left Side: Metadata */}
        <div className="flex-1 space-y-4 text-left">
          <div className="flex justify-between items-center gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Metadata</h3>
            <div className="flex items-center gap-2">
              <PaymentRouteBadge requisition={requisition} />
              {requisition.payment_destination === 'ACCOUNTS' && requisition.accounts_sheet && (
                <a
                  href={`/acct-requisitions/sheets/${requisition.accounts_sheet.sheet_id}`}
                  className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 hover:text-indigo-300 underline"
                >
                  Open Sheet {requisition.accounts_sheet.sheet_number}
                </a>
              )}
              <StatusBadge status={getRequisitionDisplayStatus(requisition)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3.5 bg-white/[0.01] border border-white/5 p-4 rounded-2xl max-h-[420px] overflow-y-auto no-scrollbar">
            {detailRows.map((row) => (
              <div key={row.label} className={row.label === 'Bank Details' || row.label === 'Expenditure Remarks' || row.label === 'Site Details' || row.label === 'Authority Remarks' ? 'col-span-2' : ''}>
                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">{row.label}</p>
                <p className={`text-xs font-semibold mt-0.5 whitespace-pre-line ${row.accent || 'text-slate-300'} ${row.mono ? 'font-mono' : ''}`}>
                  {row.value}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Right Side: Document Previews */}
        <div className="w-full md:w-96 flex flex-col gap-4 border-t md:border-t-0 md:border-l border-white/5 pt-4 md:pt-0 md:pl-6 text-left">
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
                className="mt-3 py-2 bg-white/5 hover:bg-white/10 text-center rounded-xl text-[10px] uppercase tracking-wider font-extrabold border border-white/5 transition block text-slate-300 hover:text-slate-100"
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
                  className="mt-3 py-2 bg-white/5 hover:bg-white/10 text-center rounded-xl text-[10px] uppercase tracking-wider font-extrabold border border-white/5 transition block text-slate-300 hover:text-slate-100"
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
    </Modal>
    {showRouteModal && (
      <PaymentRouteModal
        requisition={requisition}
        onClose={() => setShowRouteModal(false)}
        onChooseRoute={handleChooseRoute}
      />
    )}
    </>
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

  const [zoBalance, setZoBalance] = useState(null);
  const [capacityMetrics, setCapacityMetrics] = useState(null);
  const [loadingMetrics, setLoadingMetrics] = useState(true);

  const requisitionAmount = Number(requisition.requisition_amount);
  const liveApprovedBalance = approveType === 'Approve' && approvedAmount !== ''
    ? requisitionAmount - Number(approvedAmount)
    : null;

  const [requisitionDetail, setRequisitionDetail] = useState(requisition);

  useEffect(() => {
    const loadMetrics = async () => {
      setLoadingMetrics(true);
      setError('');
      try {
        const [balanceRes, capacityRes, detailRes] = await Promise.all([
          getZonalBalances().catch(() => ({ data: { balances: [] } })),
          getMainHeadCapacity(requisition.work_order_no, requisition.material_main_head).catch(() => ({ data: null })),
          getRequisitionById(requisition.requisition_id).catch(() => ({ data: null }))
        ]);

        const balanceList = balanceRes.data?.balances || [];
        if (balanceList.length > 0) {
          setZoBalance(Number(balanceList[0].available_balance));
        }

        if (capacityRes.data) {
          setCapacityMetrics({
            mainHeadEstimate: Number(capacityRes.data.mainHeadEstimate),
            cumulativeApproved: Number(capacityRes.data.cumulativeApproved),
            remainingCapacity: Number(capacityRes.data.remainingCapacity),
            estimateLifecycle: capacityRes.data.estimateLifecycle || null
          });
        }

        if (detailRes.data?.requisition) {
          setRequisitionDetail(detailRes.data.requisition);
        }
      } catch (err) {
        console.error('Failed to load metrics for action validation:', err);
      } finally {
        setLoadingMetrics(false);
      }
    };
    loadMetrics();
  }, [requisition]);

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
      if (capacityMetrics !== null && amt > capacityMetrics.remainingCapacity) {
        setError(`Approved amount cannot exceed Remaining Main Head Capacity (₹${capacityMetrics.remainingCapacity.toLocaleString('en-IN')}).`);
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

  const footerButtons = (
    <>
      <Button
        variant="secondary"
        onClick={onClose}
        disabled={submitting}
        size="sm"
      >
        Cancel
      </Button>
      <Button
        type="submit"
        form="workflow-action-form"
        variant={approveType === 'Approve' ? 'primary' : 'danger'}
        loading={submitting || loadingMetrics}
        size="sm"
      >
        Save Approval ({approveType})
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Take Workflow Action"
      subtitle={`Requisition NO: ${requisition.requisition_no}`}
      footer={footerButtons}
      size="md"
    >
      {error && (
        <div className="mb-4 p-4 bg-red-950/40 border border-red-500/30 rounded-2xl text-xs text-red-300 flex items-start gap-3 shadow-lg shadow-red-950/50 animate-fadeIn">
          <div className="w-6 h-6 rounded-lg bg-red-500/20 flex items-center justify-center shrink-0 mt-0.5 border border-red-500/30">
            <svg className="w-3.5 h-3.5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="space-y-0.5">
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-red-400 block">Financial Validation Alert</span>
            <span className="font-semibold text-red-200 leading-relaxed">{error}</span>
          </div>
        </div>
      )}

      <form id="workflow-action-form" onSubmit={handleSubmit} className="space-y-4 text-left">
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
          {requisition.material_main_head === 'Sub Contractor' && (
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Subcontractor</p>
              <p className="text-xs font-semibold text-slate-300 mt-0.5">{requisition.material_sub_head} — {requisition.material_details}</p>
            </div>
          )}
          <div className="col-span-2 border-t border-white/5 pt-2 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 text-[11px] text-slate-400 font-semibold">
            <span>Approver: {approverName}</span>
            <span>Date: {systemDateStr}</span>
          </div>
          {((requisitionDetail.requisition_pdf_signed_url || requisition.requisition_pdf_signed_url || requisition.requisition_pdf_url) || 
            (requisitionDetail.gst_bill_pdf_signed_url || requisition.gst_bill_pdf_signed_url || requisition.gst_bill_pdf_url)) && (
            <div className="col-span-2 border-t border-white/5 pt-2 flex flex-wrap gap-2">
              {(requisitionDetail.requisition_pdf_signed_url || requisition.requisition_pdf_signed_url) ? (
                <a
                  href={requisitionDetail.requisition_pdf_signed_url || requisition.requisition_pdf_signed_url}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded-xl text-[10px] uppercase tracking-wider font-extrabold border border-amber-500/30 transition inline-flex items-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  View Requisition PDF
                </a>
              ) : requisition.requisition_pdf_url && (
                <span className="text-[10px] text-slate-500 italic py-1">Loading Requisition PDF...</span>
              )}

              {(requisitionDetail.gst_bill === 'Yes' || requisition.gst_bill === 'Yes') && (
                (requisitionDetail.gst_bill_pdf_signed_url || requisition.gst_bill_pdf_signed_url) ? (
                  <a
                    href={requisitionDetail.gst_bill_pdf_signed_url || requisition.gst_bill_pdf_signed_url}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-1.5 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded-xl text-[10px] uppercase tracking-wider font-extrabold border border-indigo-500/30 transition inline-flex items-center gap-1.5"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    View GST Bill PDF
                  </a>
                ) : (requisitionDetail.gst_bill_pdf_url || requisition.gst_bill_pdf_url) && (
                  <span className="text-[10px] text-slate-500 italic py-1">Loading GST Bill PDF...</span>
                )
              )}
            </div>
          )}
        </div>

        {/* Action Choice */}
        <Select
          label="Action"
          value={approveType}
          onChange={(e) => setApproveType(e.target.value)}
          required
          disabled={submitting}
        >
          <option value="Approve">Approve</option>
          <option value="Hold">Hold</option>
        </Select>

        {/* Financial constraints & Approved Amount (Approve Only) */}
        {approveType === 'Approve' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-4 space-y-2">
              <p className="text-[9px] font-bold uppercase tracking-widest text-indigo-400">
                Approver Financial Constraints
              </p>
              {loadingMetrics ? (
                <div className="flex items-center gap-2 py-2">
                  <span className="animate-spin rounded-full h-3 w-3 border-t-2 border-b-2 border-indigo-500" />
                  <span className="text-[9px] uppercase tracking-widest text-slate-500 font-bold">Loading Financial Data…</span>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="text-slate-400">Zonal Office Available Balance:</div>
                  <div className={zoBalance !== null && zoBalance <= 0 ? "text-red-400 font-mono font-bold text-right" : "text-slate-200 font-mono text-right"}>
                    {zoBalance !== null ? formatCurrency(zoBalance) : '—'}
                  </div>
                  <div className="text-slate-400">Main Head Estimate:</div>
                  <div className="text-slate-200 font-mono text-right">
                    {capacityMetrics ? formatCurrency(capacityMetrics.mainHeadEstimate) : '—'}
                  </div>
                  <div className="text-slate-400">Remaining Main Head Capacity:</div>
                  <div className="text-emerald-400 font-mono font-bold text-right">
                    {capacityMetrics ? formatCurrency(capacityMetrics.remainingCapacity) : '—'}
                  </div>
                </div>
              )}
            </div>

            <FormattedCurrencyInput
              label="Approved Amount (₹)"
              value={approvedAmount}
              onValueChange={(val) => setApprovedAmount(val)}
              placeholder="0.00"
              required
              disabled={submitting}
            />

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
        <TextArea
          label="Remarks / Comments"
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder={`Enter the reason for placing on ${approveType === 'Approve' ? 'approval' : 'hold'}…`}
          rows={3}
          required
          disabled={submitting}
        />
      </form>
    </Modal>
  );
};

// Small badge showing the resolved payment route for an Approved requisition
const PaymentRouteBadge = ({ requisition }) => {
  if (requisition.payment_destination === 'ZO_BALANCE') {
    return <Badge variant="blue" showDot={true}>Paid via ZO Balance</Badge>;
  }
  if (requisition.payment_destination === 'ACCOUNTS') {
    return <Badge variant="indigo" showDot={true}>Sent to Accounts</Badge>;
  }
  return null;
};

// Modal for the ZO to choose how an Approved requisition gets paid:
// out of the ZO's own balance, or handed to Accounts for central execution.
const PaymentRouteModal = ({ requisition, onClose, onChooseRoute }) => {
  const [pendingRoute, setPendingRoute] = useState(null); // 'ZO_BALANCE' | 'ACCOUNTS' while confirming
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleConfirm = async () => {
    setSubmitting(true);
    setError('');
    try {
      await onChooseRoute(requisition.requisition_id, pendingRoute);
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to select payment route.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={submitting ? null : onClose}
      title="Choose Payment Route"
      subtitle={`Requisition No: ${requisition.requisition_no}`}
      size="sm"
      footer={
        pendingRoute ? (
          <>
            <Button variant="secondary" size="sm" onClick={() => setPendingRoute(null)} disabled={submitting}>
              Back
            </Button>
            <Button variant="primary" size="sm" onClick={handleConfirm} loading={submitting}>
              Confirm
            </Button>
          </>
        ) : (
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      {error && (
        <div className="mb-4 p-3 bg-red-950/40 border border-red-500/30 rounded-2xl text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 bg-white/[0.01] border border-white/5 p-4 rounded-2xl mb-4 text-left">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Approved Amount</p>
          <p className="text-xs font-mono font-bold text-emerald-400 mt-0.5">{formatCurrency(requisition.approved_amount)}</p>
        </div>
        <div>
          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Beneficiary</p>
          <p className="text-xs font-semibold text-slate-300 mt-0.5">{requisition.beneficiary_name || '—'}</p>
        </div>
        <div>
          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Work Order</p>
          <p className="text-xs font-mono text-slate-300 mt-0.5">{requisition.work_order_no}</p>
        </div>
      </div>

      {!pendingRoute && (
        <div className="space-y-2">
          <Button variant="primary" className="w-full" onClick={() => setPendingRoute('ZO_BALANCE')}>
            Pay from ZO Balance
          </Button>
          <Button variant="secondary" className="w-full" onClick={() => setPendingRoute('ACCOUNTS')}>
            Send to Accounts
          </Button>
        </div>
      )}

      {pendingRoute === 'ZO_BALANCE' && (
        <p className="text-xs text-slate-400 text-left">
          This will debit <span className="font-mono font-bold text-slate-200">{formatCurrency(requisition.approved_amount)}</span> from
          your Zonal Office balance. This cannot be switched to Accounts afterward.
        </p>
      )}

      {pendingRoute === 'ACCOUNTS' && (
        <p className="text-xs text-slate-400 text-left">
          Send this approved requisition to Accounts? It will be saved to the Accounts import list so Accounts can
          import it into a sheet when processing payments. This cannot be switched to ZO Balance afterward.
        </p>
      )}
    </Modal>
  );
};

// Main Requisition Creation Form Modal
const RequisitionFormModal = ({ projects, estimates, onClose, onSave, requisitions }) => {
  const { user } = useAuth();

  // Map projects to their latest estimate (whether Final Approved or under revision)
  const filteredProjects = useMemo(() => {
    return projects.map(p => {
      const projectEstimates = estimates.filter(e => e.work_order_no === p.work_order_no);
      const latestEst = projectEstimates.sort((a, b) => {
        const revDiff = (Number(b.estimate_revision) || 0) - (Number(a.estimate_revision) || 0);
        if (revDiff !== 0) return revDiff;
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      })[0] || null;
      return {
        ...p,
        approvedEst: latestEst?.estimate_status === 'Final Approved' ? latestEst : null,
        latestEst
      };
    }).filter(p => p.latestEst);
  }, [projects, estimates]);

  // Form State
  const [step, setStep] = useState(1);
  const [selectedWO, setSelectedWO] = useState('');

  const selectedProject = filteredProjects.find(p => p.work_order_no === selectedWO);
  const isSelectedWoUnderRevision = Boolean(
    selectedProject?.latestEst && selectedProject.latestEst.estimate_status !== 'Final Approved'
  );

  // Step 1 read-only values
  const systemDateStr = new Date().toLocaleDateString('en-IN', { dateStyle: 'medium' });
  const username = user?.display_name || user?.mobile_number;

  // Step 3 state fields
  const [requisitionNo, setRequisitionNo] = useState('');
  const [materialHead, setMaterialHead] = useState('');
  const [materialSubHead, setMaterialSubHead] = useState('');
  const [materialDetails, setMaterialDetails] = useState('');
  const [reqAmount, setReqAmount] = useState('');
  const [gstBill, setGstBill] = useState('No');
  const [bankDetails, setBankDetails] = useState('');
  const [beneficiaryName, setBeneficiaryName] = useState('');
  const [beneficiaryAcNo, setBeneficiaryAcNo] = useState('');
  const [beneficiaryIfsc, setBeneficiaryIfsc] = useState('');
  const [beneficiaryBankId, setBeneficiaryBankId] = useState('');
  const [beneficiaryBankName, setBeneficiaryBankName] = useState('');
  const [beneficiaryId, setBeneficiaryId] = useState(null);
  const [remarks, setRemarks] = useState('');

  const { data: indianBanksRaw = [] } = useQuery({
    queryKey: ['indianBanks'],
    queryFn: async () => (await getIndianBanks()).data?.indianBanks ?? [],
  });
  const indianBanks = useMemo(
    () => indianBanksRaw.filter(b => b.is_active),
    [indianBanksRaw]
  );

  // Upload state
  const [requisitionPdf, setRequisitionPdf] = useState(null); // original file
  const [requisitionPdfUrl, setRequisitionPdfUrl] = useState(''); // storage path (opaque; used only as an "uploaded?" flag)
  const [requisitionPdfAttachmentId, setRequisitionPdfAttachmentId] = useState('');
  const [requisitionPdfPreview, setRequisitionPdfPreview] = useState(''); // signed url
  const [isUploadingReq, setIsUploadingReq] = useState(false);
  const [reqUploadProgress, setReqUploadProgress] = useState(0);

  const [gstPdf, setGstPdf] = useState(null); // original file
  const [gstPdfUrl, setGstPdfUrl] = useState(''); // storage path (opaque; used only as an "uploaded?" flag)
  const [gstPdfAttachmentId, setGstPdfAttachmentId] = useState('');
  const [gstPdfPreview, setGstPdfPreview] = useState(''); // signed url
  const [isUploadingGst, setIsUploadingGst] = useState(false);
  const [gstUploadProgress, setGstUploadProgress] = useState(0);

  // Safety net: clean up any uploaded-but-unsubmitted PDFs if this modal is torn down
  // without going through handleCancelOrClose (e.g. the user navigates to another page
  // in-app instead of clicking the modal's own close control).
  const requisitionPdfAttachmentIdRef = useRef('');
  const gstPdfAttachmentIdRef = useRef('');
  const submittedRef = useRef(false);
  const submissionInFlightRef = useRef(false);
  useEffect(() => {
    return () => {
      if (submittedRef.current || submissionInFlightRef.current) return;
      if (requisitionPdfAttachmentIdRef.current) {
        deleteRequisitionPdf(requisitionPdfAttachmentIdRef.current).catch((err) => {
          console.error('Failed to cleanup requisition PDF on unmount:', err);
        });
      }
      if (gstPdfAttachmentIdRef.current) {
        deleteGstBillPdf(gstPdfAttachmentIdRef.current).catch((err) => {
          console.error('Failed to cleanup GST PDF on unmount:', err);
        });
      }
    };
  }, []);

  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [allowedMainHeads, setAllowedMainHeads] = useState([]);
  const [loadingMainHeads, setLoadingMainHeads] = useState(false);
  const [capacityMetrics, setCapacityMetrics] = useState(null);
  const [loadingCapacity, setLoadingCapacity] = useState(false);
  const [subContractorItems, setSubContractorItems] = useState([]);
  const [subcontractorCapacityMetrics, setSubcontractorCapacityMetrics] = useState(null);
  const [loadingSubcontractorCapacity, setLoadingSubcontractorCapacity] = useState(false);
  const [estimateLifecycle, setEstimateLifecycle] = useState(null);
  const isLifecycleBlocked = Boolean(estimateLifecycle?.requisitionsBlocked || estimateLifecycle?.isReopened);

  useEffect(() => {
    let isCurrent = true;
    if (!selectedWO) {
      setAllowedMainHeads([]);
      setCapacityMetrics(null);
      setSubContractorItems([]);
      setEstimateLifecycle(null);
      return;
    }

    // Resolve latest estimate for selected WO regardless of whether it's Final Approved
    const projEstimates = estimates.filter(e => e.work_order_no === selectedWO);
    const latestEst = projEstimates.sort((a, b) => {
      const revDiff = (Number(b.estimate_revision) || 0) - (Number(a.estimate_revision) || 0);
      if (revDiff !== 0) return revDiff;
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    })[0] || null;

    if (!latestEst) {
      setAllowedMainHeads([]);
      setCapacityMetrics(null);
      setSubContractorItems([]);
      setEstimateLifecycle(null);
      return;
    }

    // Establish lifecycle state directly from latest estimate
    const REOPENED_STATUSES = [
      'Estimate Reopened',
      'Under ZO Review',
      'Under HO Review',
      'ZO Revision Requested',
      'HO Revision Requested'
    ];
    const isReopened = REOPENED_STATUSES.includes(latestEst.estimate_status);
    const isBlocked = isReopened || latestEst.estimate_status !== 'Final Approved';

    const lifecycle = {
      status: latestEst.estimate_status || null,
      isReopened,
      requisitionsBlocked: isBlocked,
      blockReason: isBlocked
        ? `Estimate is currently undergoing revision (${latestEst.estimate_status}). New requisitions are paused until final approval.`
        : null
    };

    setEstimateLifecycle(lifecycle);

    // Latest estimate is NOT Final Approved: retain lifecycle, show warning & disable submit
    if (latestEst.estimate_status !== 'Final Approved') {
      setAllowedMainHeads([]);
      setCapacityMetrics(null);
      setSubContractorItems([]);
      return;
    }

    // Latest IS Final Approved: load estimate items + capacity normally
    setLoadingMainHeads(true);
    setCapacityMetrics(null);
    getEstimateById(latestEst.estimate_id)
      .then(res => {
        if (!isCurrent) return;
        if (res.data?.items) {
          const distinctHeads = Array.from(new Set(res.data.items.map(item => item.material_main_head).filter(Boolean)));
          setAllowedMainHeads(distinctHeads);
          const scItems = res.data.items.filter(item => item.material_main_head === 'Sub Contractor');
          setSubContractorItems(scItems);
        }
      })
      .catch(err => {
        if (!isCurrent) return;
        console.error('Failed to fetch estimate items for main heads:', err);
      })
      .finally(() => {
        if (isCurrent) {
          setLoadingMainHeads(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [selectedWO, estimates]);

  useEffect(() => {
    let isCurrent = true;
    if (!selectedWO || !materialHead) {
      setCapacityMetrics(null);
      return;
    }

    setLoadingCapacity(true);
    getMainHeadCapacity(selectedWO, materialHead)
      .then(res => {
        if (!isCurrent) return;
        if (res.data) {
          setCapacityMetrics({
            mainHeadEstimate: Number(res.data.mainHeadEstimate),
            cumulativeApproved: Number(res.data.cumulativeApproved),
            remainingCapacity: Number(res.data.remainingCapacity),
            estimateLifecycle: res.data.estimateLifecycle || null
          });
          if (res.data.estimateLifecycle) {
            setEstimateLifecycle(res.data.estimateLifecycle);
          }
        }
      })
      .catch(err => {
        if (!isCurrent) return;
        console.error('Failed to load Main Head capacity metrics:', err);
      })
      .finally(() => {
        if (isCurrent) {
          setLoadingCapacity(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [selectedWO, materialHead]);

  useEffect(() => {
    let isCurrent = true;
    if (materialHead !== 'Sub Contractor' || !selectedWO || !materialSubHead || !materialDetails) {
      setSubcontractorCapacityMetrics(null);
      return;
    }
    setLoadingSubcontractorCapacity(true);
    getSubcontractorCapacity(selectedWO, materialSubHead, materialDetails)
      .then(res => {
        if (!isCurrent) return;
        if (res.data) {
          setSubcontractorCapacityMetrics({
            estimatedTotal: Number(res.data.estimatedTotal),
            paidTotal: Number(res.data.paidTotal),
            availableBalance: Number(res.data.availableBalance),
            estimateLifecycle: res.data.estimateLifecycle || null
          });
          if (res.data.estimateLifecycle?.requisitionsBlocked) {
            setEstimateLifecycle(res.data.estimateLifecycle);
          }
        }
      })
      .catch(err => {
        if (!isCurrent) return;
        console.error('Failed to load Subcontractor Ledger capacity:', err);
      })
      .finally(() => {
        if (isCurrent) {
          setLoadingSubcontractorCapacity(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [materialHead, selectedWO, materialSubHead, materialDetails]);

  const subHeadOptions = Array.from(new Set(subContractorItems.map(i => i.material_sub_head).filter(Boolean)));
  const materialDetailsOptions = Array.from(new Set(
    subContractorItems.filter(i => i.material_sub_head === materialSubHead).map(i => i.material_details).filter(Boolean)
  ));

  // Auto-lookup project geographical and estimate data during render
  const projectMetadata = (() => {
    if (!selectedWO) return null;
    const proj = projects.find(p => p.work_order_no === selectedWO);
    if (!proj) return null;
    const projEstimates = estimates.filter(e => e.work_order_no === selectedWO);
    const approvedEstimate = projEstimates.find(e => e.estimate_status === 'Final Approved');
    const latestEstimate = projEstimates.sort((a, b) => (b.estimate_revision || 0) - (a.estimate_revision || 0))[0];
    const estimateAmount = approvedEstimate ? Number(approvedEstimate.estimate_amount) : (latestEstimate ? Number(latestEstimate.estimate_amount) : null);
    return {
      ...proj,
      estimate_no: latestEstimate?.estimate_no || approvedEstimate?.estimate_no || '—',
      estimate_status: latestEstimate?.estimate_status || approvedEstimate?.estimate_status || null,
      estimateAmount
    };
  })();

  const advisoryRemaining = selectedWO && projectMetadata?.estimateAmount != null
    ? computeRequisitionAdvisoryRemaining(projectMetadata.estimateAmount, requisitions, selectedWO)
    : null;

  // Reset GST Upload state if toggled to No, cleaning up any already-uploaded file
  const handleGstToggle = async (val) => {
    setGstBill(val);
    if (val === 'No') {
      if (gstPdfAttachmentId) {
        try {
          await deleteGstBillPdf(gstPdfAttachmentId);
        } catch (err) {
          console.error('Failed to delete GST bill PDF on toggle-off:', err);
        }
      }
      setGstPdf(null);
      setGstPdfUrl('');
      setGstPdfAttachmentId('');
      setGstPdfPreview('');
      setGstUploadProgress(0);
      gstPdfAttachmentIdRef.current = '';
    }
  };

  // Immediate upload handler for Requisition PDF
  const handleRequisitionPdfSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError('');

    // Pre-upload validation: require preceding fields
    if (!selectedWO) {
      setError('Please select a Work Order first.');
      e.target.value = null;
      return;
    }
    if (!requisitionNo.trim()) {
      setError('Please enter a Requisition Number first.');
      e.target.value = null;
      return;
    }
    if (!materialHead) {
      setError('Please select a Material Head first.');
      e.target.value = null;
      return;
    }

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
      setRequisitionPdfAttachmentId(res.data.attachmentId);
      setRequisitionPdfPreview(res.data.signedUrl);
      requisitionPdfAttachmentIdRef.current = res.data.attachmentId;
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to upload Requisition PDF.');
      e.target.value = null;
    } finally {
      setIsUploadingReq(false);
    }
  };

  // Clear PDF handler to reset upload state and unlock requisition number
  const handleClearRequisitionPdf = async () => {
    if (requisitionPdfAttachmentId) {
      try {
        await deleteRequisitionPdf(requisitionPdfAttachmentId);
      } catch (err) {
        console.error('Failed to delete cleared requisition PDF:', err);
      }
    }
    setRequisitionPdf(null);
    setRequisitionPdfUrl('');
    setRequisitionPdfAttachmentId('');
    setRequisitionPdfPreview('');
    setReqUploadProgress(0);
    requisitionPdfAttachmentIdRef.current = '';
  };

  // Immediate upload handler for GST Bill PDF
  const handleGstPdfSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError('');

    // Pre-upload validation: require preceding fields
    if (!selectedWO) {
      setError('Please select a Work Order first.');
      e.target.value = null;
      return;
    }
    if (!requisitionNo.trim()) {
      setError('Please enter a Requisition Number first.');
      e.target.value = null;
      return;
    }
    if (!materialHead) {
      setError('Please select a Material Head first.');
      e.target.value = null;
      return;
    }
    if (!requisitionPdfUrl) {
      setError('Please upload the Requisition PDF first.');
      e.target.value = null;
      return;
    }

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
      setGstPdfAttachmentId(res.data.attachmentId);
      setGstPdfPreview(res.data.signedUrl);
      gstPdfAttachmentIdRef.current = res.data.attachmentId;
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to upload GST Bill PDF.');
      e.target.value = null;
    } finally {
      setIsUploadingGst(false);
    }
  };

  const handleClearGstPdf = async () => {
    if (gstPdfAttachmentId) {
      try {
        await deleteGstBillPdf(gstPdfAttachmentId);
      } catch (err) {
        console.error('Failed to delete cleared GST PDF:', err);
      }
    }
    setGstPdf(null);
    setGstPdfUrl('');
    setGstPdfAttachmentId('');
    setGstPdfPreview('');
    setGstUploadProgress(0);
    gstPdfAttachmentIdRef.current = '';
  };

  const handleCancelOrClose = async () => {
    if (submitting) return;
    if (requisitionPdfAttachmentId) {
      try {
        await deleteRequisitionPdf(requisitionPdfAttachmentId);
      } catch (err) {
        console.error('Failed to cleanup requisition PDF on close:', err);
      }
    }
    if (gstPdfAttachmentId) {
      try {
        await deleteGstBillPdf(gstPdfAttachmentId);
      } catch (err) {
        console.error('Failed to cleanup GST PDF on close:', err);
      }
    }
    requisitionPdfAttachmentIdRef.current = '';
    gstPdfAttachmentIdRef.current = '';
    onClose();
  };

  // Final submit save
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (isLifecycleBlocked) {
      setError(estimateLifecycle?.blockReason || 'Cannot submit requisition: estimate is currently undergoing revision.');
      return;
    }

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
    if (capacityMetrics && Number(reqAmount) > capacityMetrics.remainingCapacity) {
      setError(`Requisition Amount exceeds the Remaining Main Head Capacity (₹${capacityMetrics.remainingCapacity.toLocaleString('en-IN')}) for '${materialHead}'.`);
      return;
    }
    if (materialHead === 'Sub Contractor') {
      if (!materialSubHead || !materialDetails) {
        setError('Please select a Sub Head and Subcontractor.');
        return;
      }
      if (subcontractorCapacityMetrics && Number(reqAmount) > subcontractorCapacityMetrics.availableBalance) {
        setError(`Requisition Amount exceeds the Remaining Subcontractor Ledger Balance (₹${subcontractorCapacityMetrics.availableBalance.toLocaleString('en-IN')}) for '${materialDetails}'.`);
        return;
      }
    }
    if (gstBill === 'Yes' && !gstPdfUrl) {
      setError('GST Bill is toggled to Yes but no GST Invoice PDF has been uploaded.');
      return;
    }
    if (!beneficiaryName.trim()) {
      setError('Beneficiary name is required.');
      return;
    }
    if (!beneficiaryAcNo.trim()) {
      setError('Beneficiary account number is required.');
      return;
    }
    if (!/^\d{9,18}$/.test(beneficiaryAcNo.trim())) {
      setError('Beneficiary account number must be 9-18 digits.');
      return;
    }
    if (!beneficiaryIfsc.trim()) {
      setError('Beneficiary IFSC is required.');
      return;
    }
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(beneficiaryIfsc.trim().toUpperCase())) {
      setError('Beneficiary IFSC must be 11-char in format AAAA0XXXXXX.');
      return;
    }
    if (!beneficiaryBankId) {
      setError('Beneficiary bank is required.');
      return;
    }

    let finalBankDetails = bankDetails.trim();
    if (!finalBankDetails && (beneficiaryAcNo.trim() || beneficiaryName.trim())) {
      finalBankDetails = [
        beneficiaryName.trim(),
        beneficiaryAcNo.trim() ? `A/C: ${beneficiaryAcNo.trim()}` : null,
        beneficiaryIfsc.trim() ? `IFSC: ${beneficiaryIfsc.trim()}` : null,
        beneficiaryBankName.trim() ? `Bank: ${beneficiaryBankName.trim()}` : null
      ].filter(Boolean).join(' | ');
    }
    if (!finalBankDetails) {
      finalBankDetails = '—';
    }

    setSubmitting(true);
    try {
      const payload = {
        work_order_no: selectedWO.trim(),
        requisition_no: requisitionNo.trim(),
        material_main_head: materialHead.trim(),
        material_sub_head: materialHead === 'Sub Contractor' ? materialSubHead.trim() : undefined,
        material_details: materialHead === 'Sub Contractor' ? materialDetails.trim() : undefined,
        requisition_pdf_attachment_id: requisitionPdfAttachmentId,
        original_filename: requisitionPdf?.name || null,
        requisition_amount: Number(reqAmount),
        gst_bill: gstBill,
        gst_bill_pdf_attachment_id: gstBill === 'Yes' ? gstPdfAttachmentId : null,
        bank_details: finalBankDetails,
        beneficiary_id: beneficiaryId || undefined,
        beneficiary_name: beneficiaryName.trim() || undefined,
        beneficiary_ac_no: beneficiaryAcNo.trim() || undefined,
        beneficiary_ifsc: beneficiaryIfsc.trim().toUpperCase() || undefined,
        beneficiary_bank_id: beneficiaryBankId || undefined,
        beneficiary_bank_name: beneficiaryBankName.trim() || undefined,
        expen_head_remarks: remarks.trim() || null
      };
      submissionInFlightRef.current = true;
      await onSave(payload);
      submittedRef.current = true;
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to submit requisition.');
    } finally {
      submissionInFlightRef.current = false;
      setSubmitting(false);
    }
  };

  // Render Footer Buttons dynamically based on Step
  const getFooterButtons = () => {
    if (step === 1) {
      return (
        <Button
          variant="primary"
          size="sm"
          onClick={() => setStep(2)}
          className="ml-auto"
        >
          Next Step &rarr;
        </Button>
      );
    }
    if (step === 2) {
      return (
        <>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setStep(1)}
          >
            &larr; Back
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              if (!selectedWO) {
                setError('Please select a Work Order.');
                return;
              }
              setError('');
              setStep(3);
            }}
            disabled={!selectedWO}
          >
            Next Step &rarr;
          </Button>
        </>
      );
    }
    return (
      <>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setStep(2)}
          disabled={submitting}
        >
          &larr; Back
        </Button>
        <Button
          type="submit"
          form="requisition-creation-form"
          variant="primary"
          size="sm"
          loading={submitting}
          disabled={submitting || isUploadingReq || isUploadingGst || isLifecycleBlocked}
          title={isLifecycleBlocked ? (estimateLifecycle?.blockReason || 'Submission paused: estimate under revision') : ''}
        >
          {isLifecycleBlocked ? 'Submission Paused' : 'Save Requisition'}
        </Button>
      </>
    );
  };

  return (
    <Modal
      isOpen={true}
      onClose={submitting ? null : handleCancelOrClose}
      title="Create Requisition"
      subtitle={`Step ${step} of 3`}
      footer={getFooterButtons()}
      size="md"
    >
      {error && (
        <div className="mb-4 p-4 bg-red-950/40 border border-red-500/30 rounded-2xl text-xs text-red-300 flex items-start gap-3 shadow-lg shadow-red-950/50 animate-fadeIn">
          <div className="w-6 h-6 rounded-lg bg-red-500/20 flex items-center justify-center shrink-0 mt-0.5 border border-red-500/30">
            <svg className="w-3.5 h-3.5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div className="space-y-0.5">
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-red-400 block">Requisition Validation Guard</span>
            <span className="font-semibold text-red-200 leading-relaxed">{error}</span>
          </div>
        </div>
      )}

      {/* ──────── STEP 1: USER DETAILS (AUTO-FILLED) ──────── */}
      {step === 1 && (
        <div className="space-y-4 text-left">
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
        </div>
      )}

      {/* ──────── STEP 2: MASTER DATA SELECTION ──────── */}
      {step === 2 && (
        <div className="space-y-4 text-left">
          <Select
            label="Work Order No."
            value={selectedWO}
            onChange={(e) => setSelectedWO(e.target.value)}
            required
          >
            <option value="">-- Choose Work Order --</option>
            {filteredProjects.map((p) => {
              const isRevision = p.latestEst && p.latestEst.estimate_status !== 'Final Approved';
              const estNo = p.latestEst?.estimate_no || p.approvedEst?.estimate_no || 'No Estimate';
              return (
                <option key={p.work_order_no} value={p.work_order_no}>
                  {p.work_order_no} ({estNo}{isRevision ? ` — ⚠️ ${p.latestEst.estimate_status}` : ''})
                </option>
              );
            })}
          </Select>

          {isSelectedWoUnderRevision && (
            <div className="p-4 bg-amber-950/40 border border-amber-500/40 rounded-2xl text-xs text-amber-200 flex items-start gap-3 shadow-lg shadow-amber-950/50 animate-fadeIn">
              <div className="w-6 h-6 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0 mt-0.5 border border-amber-500/30">
                <svg className="w-3.5 h-3.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-amber-400 block">
                  Estimate Under Revision — Requisitions Blocked
                </span>
                <p className="font-medium text-amber-200 leading-relaxed">
                  The cost estimate for work order <span className="font-mono font-bold text-amber-300">{selectedWO}</span> is currently in <span className="font-semibold text-amber-300">'{selectedProject?.latestEst?.estimate_status}'</span> status. Requisition creation is temporarily paused until the estimate receives Final Approval.
                </p>
              </div>
            </div>
          )}

          {projectMetadata && (
            <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-4 space-y-3">
              <p className="text-[9px] font-bold uppercase tracking-widest text-indigo-400 mb-1">
                &darr; Auto-populated geographic and estimate snapshots
              </p>
              <div className="grid grid-cols-2 gap-3 text-xs">
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
                  <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Area Code / Department</p>
                  <p className="text-xs font-semibold text-slate-300 mt-0.5 truncate">{projectMetadata.area_code} / {projectMetadata.department}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Site Details</p>
                  <p className="text-xs font-semibold text-slate-300 mt-0.5 whitespace-pre-line">{projectMetadata.site_details}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ──────── STEP 3: REQUISITION DETAILS & UPLOADS ──────── */}
      {step === 3 && (
        <form id="requisition-creation-form" onSubmit={handleSubmit} className="space-y-4 text-left">
          {isLifecycleBlocked && (
            <div className="p-4 bg-amber-950/40 border border-amber-500/40 rounded-2xl text-xs text-amber-200 flex items-start gap-3 shadow-lg shadow-amber-950/50 animate-fadeIn">
              <div className="w-6 h-6 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0 mt-0.5 border border-amber-500/30">
                <svg className="w-3.5 h-3.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-amber-400 block">
                  Estimate Under Revision — Requisitions Blocked
                </span>
                <p className="font-medium text-amber-200 leading-relaxed">
                  {estimateLifecycle?.blockReason || `The cost estimate for work order ${selectedWO} is currently undergoing revision (${estimateLifecycle?.status}). New requisitions are paused until final approval.`}
                </p>
              </div>
            </div>
          )}

          <Input
            label="Requisition Number"
            type="text"
            value={requisitionNo}
            onChange={(e) => setRequisitionNo(e.target.value.replace(/[^A-Za-z0-9_\-.]/g, ''))}
            placeholder="e.g. REQ-WO-001"
            required
            disabled={requisitionPdfUrl !== '' || submitting}
            helperText={requisitionPdfUrl ? "Requisition number is locked while PDF is uploaded." : ""}
          />

          <Select
            label="Material Main Head"
            value={materialHead}
            onChange={(e) => {
              setMaterialHead(e.target.value);
              setMaterialSubHead('');
              setMaterialDetails('');
            }}
            required
            disabled={submitting || isLifecycleBlocked}
          >
            <option value="">
              {isLifecycleBlocked
                ? `-- Requisitions Paused: Estimate Under Revision (${estimateLifecycle?.status || 'In Revision'}) --`
                : (loadingMainHeads ? '-- Loading Material Heads... --' : '-- Select Material Head --')}
            </option>
            {allowedMainHeads.map((head) => (
              <option key={head} value={head}>
                {head}
              </option>
            ))}
          </Select>

          {materialHead === 'Sub Contractor' && (
            <>
              <Select
                label="Sub Head (Work Package)"
                value={materialSubHead}
                onChange={(e) => { setMaterialSubHead(e.target.value); setMaterialDetails(''); }}
                required
                disabled={submitting}
              >
                <option value="">-- Select Sub Head --</option>
                {subHeadOptions.map((sh) => (
                  <option key={sh} value={sh}>{sh}</option>
                ))}
              </Select>

              <Select
                label="Subcontractor"
                value={materialDetails}
                onChange={(e) => {
                  const val = e.target.value;
                  setMaterialDetails(val);
                  if (val && !beneficiaryName) {
                    setBeneficiaryName(val);
                  }
                }}
                required
                disabled={submitting || !materialSubHead}
              >
                <option value="">-- Select Subcontractor --</option>
                {materialDetailsOptions.map((md) => (
                  <option key={md} value={md}>{md}</option>
                ))}
              </Select>
            </>
          )}

          {/* Requisition PDF Upload */}
          <div className="p-4 border border-white/5 rounded-2xl bg-white/[0.01] space-y-2">
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">
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
                    <Button
                      variant="glass"
                      size="xs"
                      onClick={() => window.open(requisitionPdfPreview, '_blank')}
                    >
                      Preview
                    </Button>
                  )}
                  <Button
                    variant="danger"
                    size="xs"
                    onClick={handleClearRequisitionPdf}
                  >
                    Clear
                  </Button>
                </div>
              </div>
            )}
          </div>

          <FormattedCurrencyInput
            label="Requisition Amount (₹)"
            value={reqAmount}
            onValueChange={(val) => setReqAmount(val)}
            placeholder="0.00"
            required
            disabled={submitting}
          />

          {/* Main Head Capacity Display */}
          {materialHead && (
            <div className={`rounded-2xl border ${isLifecycleBlocked ? 'border-amber-500/30 bg-amber-950/20' : 'border-indigo-500/20 bg-indigo-500/5'} p-4 space-y-2`}>
              <div className="flex items-center justify-between">
                <p className={`text-[9px] font-bold uppercase tracking-widest ${isLifecycleBlocked ? 'text-amber-400' : 'text-indigo-400'}`}>
                  Material Main Head Capacity ({materialHead})
                </p>
                {isLifecycleBlocked && (
                  <Badge variant="amber" className="text-[9px]">
                    Paused: {estimateLifecycle?.status}
                  </Badge>
                )}
              </div>
              {loadingCapacity ? (
                <div className="flex items-center gap-2 py-2">
                  <span className="animate-spin rounded-full h-3 w-3 border-t-2 border-b-2 border-indigo-500" />
                  <span className="text-[9px] uppercase tracking-widest text-slate-500 font-bold">Loading Capacity…</span>
                </div>
              ) : capacityMetrics ? (
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="text-slate-400">Main Head Estimate:</div>
                  <div className="text-slate-200 font-mono text-right">{formatCurrency(capacityMetrics.mainHeadEstimate)}</div>
                  <div className="text-slate-400">Cumulative ZO-Approved:</div>
                  <div className="text-slate-200 font-mono text-right">{formatCurrency(capacityMetrics.cumulativeApproved)}</div>
                  <div className="text-slate-400">Remaining Capacity:</div>
                  <div className="text-emerald-400 font-mono font-bold text-right">{formatCurrency(capacityMetrics.remainingCapacity)}</div>
                </div>
              ) : (
                <p className="text-[9px] text-red-400">Failed to load capacity details.</p>
              )}
            </div>
          )}

          {/* Subcontractor Ledger Balance Display */}
          {materialHead === 'Sub Contractor' && materialSubHead && materialDetails && (
            <div className={`rounded-2xl border ${isLifecycleBlocked ? 'border-amber-500/30 bg-amber-950/20' : 'border-indigo-500/20 bg-indigo-500/5'} p-4 space-y-2`}>
              <div className="flex items-center justify-between">
                <p className={`text-[9px] font-bold uppercase tracking-widest ${isLifecycleBlocked ? 'text-amber-400' : 'text-indigo-400'}`}>
                  Subcontractor Ledger Balance ({materialDetails})
                </p>
                {isLifecycleBlocked && (
                  <Badge variant="amber" className="text-[9px]">
                    Paused: {estimateLifecycle?.status}
                  </Badge>
                )}
              </div>
              {loadingSubcontractorCapacity ? (
                <div className="flex items-center gap-2 py-2">
                  <span className="animate-spin rounded-full h-3 w-3 border-t-2 border-b-2 border-indigo-500" />
                  <span className="text-[9px] uppercase tracking-widest text-slate-500 font-bold">Loading Balance…</span>
                </div>
              ) : subcontractorCapacityMetrics ? (
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="text-slate-400">Estimated Total:</div>
                  <div className="text-slate-200 font-mono text-right">{formatCurrency(subcontractorCapacityMetrics.estimatedTotal)}</div>
                  <div className="text-slate-400">Paid So Far:</div>
                  <div className="text-slate-200 font-mono text-right">{formatCurrency(subcontractorCapacityMetrics.paidTotal)}</div>
                  <div className="text-slate-400">Remaining Balance:</div>
                  <div className="text-emerald-400 font-mono font-bold text-right">{formatCurrency(subcontractorCapacityMetrics.availableBalance)}</div>
                </div>
              ) : (
                <p className="text-[9px] text-red-400">Failed to load balance details.</p>
              )}
            </div>
          )}

          {/* Advisory Balance Display */}
          {projectMetadata && projectMetadata.estimateAmount !== null && (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-2">
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

          <Select
            label="GST Bill Included?"
            value={gstBill}
            onChange={(e) => handleGstToggle(e.target.value)}
            required
            disabled={submitting}
          >
            <option value="No">No</option>
            <option value="Yes">Yes</option>
          </Select>

          {/* GST Bill PDF Upload */}
          {gstBill === 'Yes' && (
            <div className="p-4 border border-white/5 rounded-2xl bg-white/[0.01] space-y-2">
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">
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
                      <Button
                        variant="glass"
                        size="xs"
                        onClick={() => window.open(gstPdfPreview, '_blank')}
                      >
                        Preview
                      </Button>
                    )}
                    <Button
                      variant="danger"
                      size="xs"
                      onClick={handleClearGstPdf}
                    >
                      Clear
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Beneficiary & Payee Banking Details Card */}
          <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/10 space-y-3.5 text-left">
            <div className="flex items-center justify-between pb-2 border-b border-white/5">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-400">
                Beneficiary Banking Details
              </span>
              <span className="text-[9px] text-slate-500 italic">
                Auto-saved to Projects Beneficiary Master
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <ProjectBeneficiarySuggestions
                label="Account No."
                value={beneficiaryAcNo}
                onChange={(e) => {
                  setBeneficiaryAcNo(e.target.value.replace(/\D/g, '').slice(0, 18));
                  setBeneficiaryId(null);
                }}
                maxLength={18}
                onSelect={(b) => {
                  setBeneficiaryAcNo(b.beneficiary_ac_no || '');
                  setBeneficiaryIfsc(b.beneficiary_ifsc || '');
                  setBeneficiaryName(b.beneficiary_name || '');
                  setBeneficiaryBankId(b.beneficiary_bank_id || b.beneficiary_bank?.id || '');
                  setBeneficiaryBankName(b.beneficiary_bank?.bank_name || b.beneficiary_bank_name || '');
                  setBeneficiaryId(b.id || null);
                }}
                placeholder="Enter bank account no…"
                disabled={submitting}
                required
                size="sm"
              />

              <Input
                label="IFSC Code"
                value={beneficiaryIfsc}
                onChange={(e) => setBeneficiaryIfsc(e.target.value.toUpperCase().trim())}
                placeholder="e.g. SBIN0001234"
                maxLength={11}
                disabled={submitting}
                required
                size="sm"
              />

              <ProjectBeneficiarySuggestions
                label="Beneficiary Name"
                value={beneficiaryName}
                searchBy="name"
                primaryField="name"
                enabled={!submitting}
                onChange={(e) => {
                  setBeneficiaryName(e.target.value);
                  setBeneficiaryAcNo('');
                  setBeneficiaryIfsc('');
                  setBeneficiaryBankId('');
                  setBeneficiaryBankName('');
                  setBeneficiaryId(null);
                }}
                onClearSelection={() => {
                  setBeneficiaryName('');
                  setBeneficiaryAcNo('');
                  setBeneficiaryIfsc('');
                  setBeneficiaryBankId('');
                  setBeneficiaryBankName('');
                  setBeneficiaryId(null);
                }}
                onSelect={(b) => {
                  setBeneficiaryAcNo(b.beneficiary_ac_no || '');
                  setBeneficiaryIfsc(b.beneficiary_ifsc || '');
                  setBeneficiaryName(b.beneficiary_name || '');
                  setBeneficiaryBankId(b.beneficiary_bank_id || b.beneficiary_bank?.id || '');
                  setBeneficiaryBankName(b.beneficiary_bank?.bank_name || b.beneficiary_bank_name || '');
                  setBeneficiaryId(b.id || null);
                }}
                placeholder="Enter payee / subcontractor name…"
                disabled={submitting}
                required
                size="sm"
              />

              <Select
                label="Indian Banks"
                value={beneficiaryBankId}
                onChange={(e) => {
                  const id = e.target.value;
                  setBeneficiaryBankId(id);
                  const found = indianBanks.find(b => b.id === id);
                  setBeneficiaryBankName(found ? found.bank_name : '');
                }}
                disabled={submitting}
                required
              >
                <option value="">-- Select Bank --</option>
                {indianBanks.map((b) => (
                  <option key={b.id} value={b.id}>{b.bank_name}</option>
                ))}
              </Select>
            </div>
          </div>

          <TextArea
            label="Additional Bank Notes / Free-Text (Optional)"
            value={bankDetails}
            onChange={(e) => setBankDetails(e.target.value)}
            placeholder="Optional additional branch notes or raw details…"
            rows={2}
            disabled={submitting}
          />

          <TextArea
            label="Expenditure Head Remarks (Optional)"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Optional notes or head of expenditure remarks…"
            rows={2}
            disabled={submitting}
          />
        </form>
      )}
    </Modal>
  );
};

// Main Requisitions Page Component
// Main Requisitions Page Component
const Requisitions = () => {
  const { user } = useAuth();
  const isCreator = ['je', 'admin'].includes(user?.role);
  const queryClient = useQueryClient();

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // UI state
  const [search, setSearch] = useState('');
  const [activeReqId, setActiveReqId] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [cancelTarget, setCancelTarget] = useState(null); // { id, no }
  const [isCancelling, setIsCancelling] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // M6b Approver tab and action states
  const [currentTab, setCurrentTab] = useState(user?.role === 'je' ? 'all' : 'pending');
  const [actionTargetReq, setActionTargetReq] = useState(null);
  const [routeTargetReq, setRouteTargetReq] = useState(null);

  // Projects Directory States
  const [activeWO, setActiveWO] = useState(null);
  const [dirSearchWO, setDirSearchWO] = useState('');
  const [dirSearchDept, setDirSearchDept] = useState('');
  const [dirSearchZone, setDirSearchZone] = useState('');
  const [dirFilterStatus, setDirFilterStatus] = useState('');

  // Fetch all core datasets using React Query
  const { data: requisitionsData, isLoading: loadingRequisitions, error: requisitionsError } = useQuery({
    queryKey: ['requisitions'],
    queryFn: async () => {
      const res = await getRequisitions();
      return res.data?.requisitions ?? [];
    },
    staleTime: 30 * 1000
  });

  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const res = await getProjects();
      return res.data?.projects ?? [];
    },
    staleTime: 120 * 1000
  });

  const { data: estimatesData } = useQuery({
    queryKey: ['estimates'],
    queryFn: async () => {
      const res = await getEstimates({ limit: 1000 });
      return res.data?.estimates ?? [];
    },
    staleTime: 60 * 1000
  });

  const { data: categoriesData } = useQuery({
    queryKey: ['materialCategories'],
    queryFn: async () => {
      const res = await getMaterialCategories();
      return res.data?.mainHeads ?? [];
    },
    staleTime: 300 * 1000
  });

  const requisitions = requisitionsData || [];
  const projects = projectsData || [];
  const estimates = estimatesData || [];
  const mainHeads = categoriesData || [];
  const loading = loadingRequisitions;

  // Filter projects list for the directory tab
  const getFilteredProjects = () => {
    // 1. Map and link approved estimate to each project
    let list = projects.map(p => {
      const approvedEst = estimates.find(e => e.work_order_no === p.work_order_no && e.estimate_status === 'Final Approved');
      return {
        ...p,
        approvedEst
      };
    });

    // 2. Only show projects with a 'Final Approved' estimate
    list = list.filter(p => p.approvedEst);

    // 3. Apply search filters
    const wo = dirSearchWO.toLowerCase().trim();
    if (wo) {
      list = list.filter(
        p =>
          p.work_order_no?.toLowerCase().includes(wo) ||
          p.approvedEst.estimate_no?.toLowerCase().includes(wo)
      );
    }

    const dept = dirSearchDept.toLowerCase().trim();
    if (dept) {
      list = list.filter(p => p.department?.toLowerCase().includes(dept));
    }

    const zone = dirSearchZone.toLowerCase().trim();
    if (zone) {
      list = list.filter(p => p.area_code?.toLowerCase().includes(zone) || p.zone?.toLowerCase().includes(zone));
    }

    const status = dirFilterStatus;
    if (status) {
      list = list.filter(p => p.status === status);
    }

    return list;
  };

  const filteredProjects = getFilteredProjects();

  const displayError = error || requisitionsError?.response?.data?.message || requisitionsError?.message || '';

  // Success auto-dismiss
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(''), 4500);
    return () => clearTimeout(timer);
  }, [success]);

  // Create requisition save callback
  const handleCreate = async (payload) => {
    try {
      await createRequisition(payload);
      setSuccess(`Requisition ${payload.requisition_no} submitted successfully.`);
      queryClient.invalidateQueries({ queryKey: ['requisitions'] });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create requisition.');
    }
  };

  // M6b Approve/Hold action callback
  const handleAct = async (id, actionPayload) => {
    try {
      const res = await actOnRequisition(id, actionPayload);
      setSuccess(`Requisition successfully ${actionPayload.action === 'Approve' ? 'approved' : 'placed on hold'}.`);
      queryClient.invalidateQueries({ queryKey: ['requisitions'] });
      queryClient.invalidateQueries({ queryKey: ['requisition', id] });
      if (actionPayload.action === 'Approve' && res.data?.requisition && !res.data.requisition.payment_destination) {
        setRouteTargetReq(res.data.requisition);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to act on requisition.');
    }
  };

  // Payment route selection callback (from the row action or the post-approve prompt).
  // Errors are surfaced by PaymentRouteModal's own inline banner, not the page banner -
  // re-thrown here (unlike handleAct) so the modal stays open on failure.
  const handleChooseRoute = async (id, route) => {
    if (route === 'ZO_BALANCE') {
      await payFromZoBalance(id);
      setSuccess('Requisition will be paid from the Zonal Office balance.');
    } else {
      await sendRequisitionToAccounts(id);
      setSuccess('Requisition sent to Accounts (saved to import list).');
    }
    queryClient.invalidateQueries({ queryKey: ['requisitions'] });
    queryClient.invalidateQueries({ queryKey: ['requisition', id] });
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
      queryClient.invalidateQueries({ queryKey: ['requisitions'] });
      queryClient.invalidateQueries({ queryKey: ['requisition', cancelTarget.id] });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to cancel requisition.');
    } finally {
      setIsCancelling(false);
    }
  };

  // Filter requisitions list based on search bar and currentTab
  const getFilteredRequisitions = () => {
    let list = [...requisitions];
    
    if (currentTab === 'pending') {
      list = list.filter(r => r.requisition_status === 'Pending');
    } else if (currentTab === 'approved') {
      list = list.filter(r => r.requisition_status === 'Approved');
    } else if (currentTab === 'hold') {
      list = list.filter(r => r.requisition_status === 'Hold');
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

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    setCurrentPage(1);
  }, [currentTab, search, pageSize]);

  const filteredRequisitions = getFilteredRequisitions();

  const totalPages = Math.ceil(filteredRequisitions.length / pageSize) || 1;
  const paginatedRequisitions = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredRequisitions.slice(start, start + pageSize);
  }, [filteredRequisitions, currentPage, pageSize]);

  // Stats computation
  const totalCount = requisitions.length;
  const pendingCount = requisitions.filter(r => r.requisition_status === 'Pending').length;
  const approvedCount = requisitions.filter(r => r.requisition_status === 'Approved').length;
  const holdOrCancelCount = requisitions.filter(r => r.requisition_status === 'Hold' || r.requisition_status === 'Cancelled').length;

  return (
    <>
      <div className="flex-grow flex flex-col min-w-0 overflow-hidden">
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
            <Button
              onClick={() => setShowCreateModal(true)}
              size="sm"
              icon={
                <svg className="w-4 h-4 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              }
            >
              New Requisition
            </Button>
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
            <div key={label} className={`glass-panel rounded-2xl p-5 border ${border} bg-gradient-to-br ${accent} text-left`}>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{label}</p>
              <p className="font-black text-slate-100 mt-1.5 text-3xl tabular-nums">{value}</p>
            </div>
          ))}
        </div>

        {/* Notifications */}
        {displayError && (
          <div className="p-4 bg-red-950/40 border border-red-500/30 rounded-2xl text-xs text-red-300 mb-5 flex items-start gap-3 shadow-lg shadow-red-950/40 animate-fadeIn text-left">
            <div className="w-6 h-6 rounded-lg bg-red-500/20 flex items-center justify-center shrink-0 mt-0.5 border border-red-500/30">
              <svg className="w-3.5 h-3.5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="space-y-0.5">
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-red-400 block">System Alert</span>
              <span className="font-semibold text-red-200 leading-relaxed">{displayError}</span>
            </div>
          </div>
        )}
        {success && (
          <div className="p-4 bg-emerald-950/40 border border-emerald-500/30 rounded-2xl text-xs text-emerald-300 mb-5 flex items-start gap-3 shadow-lg shadow-emerald-950/40 animate-fadeIn text-left">
            <div className="w-6 h-6 rounded-lg bg-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5 border border-emerald-500/30">
              <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="space-y-0.5">
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-400 block">Success Confirmation</span>
              <span className="font-semibold text-emerald-200 leading-relaxed">{success}</span>
            </div>
          </div>
        )}

        {/* Active Project specific ledger or Main dashboard views */}
        {activeWO ? (
          <div className="space-y-6 animate-fadeIn text-left">
            {/* Header / Back button */}
            <div className="flex justify-between items-center">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setActiveWO(null)}
              >
                &larr; Back to Projects Directory
              </Button>
              <Badge variant={activeWO.status === 'Running' ? 'emerald' : activeWO.status === 'Closed' ? 'red' : 'amber'}>
                Status: {activeWO.status}
              </Badge>
            </div>

            {/* Project Metadata Snapshots */}
            <div className="glass-panel p-5 rounded-3xl border border-white/5 space-y-4">
              <span className="text-[9px] uppercase font-black tracking-widest text-amber-500 font-mono block">Project Snapshot Metadata</span>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Input label="State / District" disabled value={`${activeWO.state} / ${activeWO.district}`} size="sm" />
                <Input label="Area Code (Zone)" disabled value={activeWO.area_code || 'N/A'} size="sm" />
                <Input label="Department" disabled value={activeWO.department} size="sm" />
                <Input label="Work Order No." disabled value={activeWO.work_order_no} size="sm" className="font-mono" />
              </div>
              <TextArea
                label="Site Details"
                disabled
                value={activeWO.site_details}
                rows={2}
                size="sm"
              />
            </div>

            {/* Requisitions for this WO */}
            <div className="glass-panel rounded-3xl overflow-hidden shadow-2xl border border-white/5 bg-gradient-to-br from-white/[0.01] to-transparent">
              <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/[0.01]">
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Requisitions Ledger for {activeWO.work_order_no}</span>
                <span className="text-[10px] font-mono font-bold text-amber-500">
                  Total: {requisitions.filter(r => r.work_order_no === activeWO.work_order_no).length} records
                </span>
              </div>
              
              {requisitions.filter(r => r.work_order_no === activeWO.work_order_no).length === 0 ? (
                <div className="text-center p-20 text-slate-500 text-xs uppercase font-extrabold tracking-widest">
                  No requisitions submitted for this work order yet.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow hover={false}>
                      {['Requisition No.', 'Material Head', 'Amount', 'Status', 'Payment Office', 'Submitted Date', 'Actions'].map((h) => (
                        <TableCell key={h} isHeader={true}>
                          {h}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requisitions.filter(r => r.work_order_no === activeWO.work_order_no).map((req) => {
                      const isPending = req.requisition_status === 'Pending';
                      const isHold = req.requisition_status === 'Hold';
                      const financialState = getRequisitionFinancialState(req);
                      const isOwner = req.requester_user_id === user?.mobile_number;
                      const isAdmin = user?.role === 'admin';
                      const canCancel = isPending && (isOwner || isAdmin);
                      return (
                        <TableRow key={req.requisition_id}>
                          <TableCell className="font-mono font-semibold text-slate-100">
                            {req.requisition_no}
                          </TableCell>
                          <TableCell className="text-slate-300 font-semibold">
                            {req.material_main_head}
                          </TableCell>
                          <TableCell className="font-mono font-bold text-amber-500">
                            {req.requisition_status === 'Approved'
                              ? formatCurrency(req.approved_amount ?? req.requisition_amount)
                              : formatCurrency(req.requisition_amount)
                            }
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={financialState.status} />
                          </TableCell>
                          <TableCell className="text-xs text-slate-300">{formatPaymentOffice(req.payment_destination)}</TableCell>
                          <TableCell className="text-[11px] text-slate-500">
                            {formatDate(req.created_at)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2 opacity-60 group-hover:opacity-100 transition-opacity duration-200">
                              <Button
                                variant="glass"
                                size="xs"
                                onClick={() => setActiveReqId(req.requisition_id)}
                              >
                                View Details
                              </Button>
                              {(isPending || isHold) && ['zo', 'ho', 'admin'].includes(user?.role) && (
                                <Button
                                  variant="glass"
                                  size="xs"
                                  className="text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/20"
                                  onClick={() => setActionTargetReq(req)}
                                >
                                  Take Action
                                </Button>
                              )}
                              {req.requisition_status === 'Approved' && !req.payment_destination && ['zo', 'admin'].includes(user?.role) && (
                                <Button
                                  variant="glass"
                                  size="xs"
                                  className="text-indigo-400 hover:text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20 border-indigo-500/20"
                                  onClick={() => setRouteTargetReq(req)}
                                >
                                  Choose Payment Route
                                </Button>
                              )}
                              {canCancel && (
                                <Button
                                  variant="danger"
                                  size="xs"
                                  onClick={() => setCancelTarget({ id: req.requisition_id, no: req.requisition_no })}
                                >
                                  Cancel
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}

              {/* Aggregated ledger summary metrics for this WO */}
              <div className="p-4 border-t border-white/5 bg-amber-950/5 border-l border-r border-b rounded-b-3xl">
                <span className="text-[9px] uppercase font-black tracking-widest text-amber-400 font-mono">Ledger Aggregated Summary Metrics</span>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-2 text-center">
                  <div className="p-3 rounded-2xl bg-black/40 border border-white/5">
                    <p className="text-[8px] font-bold uppercase tracking-widest text-slate-500">Total Requested</p>
                    <p className="text-xs font-mono font-extrabold text-slate-100 mt-2">
                      {formatCurrency(
                        requisitions
                          .filter(r => r.work_order_no === activeWO.work_order_no && r.requisition_status !== 'Cancelled')
                          .reduce((sum, r) => sum + Number(r.requisition_amount), 0)
                      )}
                    </p>
                  </div>
                  <div className="p-3 rounded-2xl bg-black/40 border border-white/5">
                    <p className="text-[8px] font-bold uppercase tracking-widest text-slate-500">Pending Approval</p>
                    <p className="text-xs font-mono font-extrabold text-amber-500 mt-2">
                      {formatCurrency(
                        requisitions
                          .filter(r => r.work_order_no === activeWO.work_order_no && r.requisition_status === 'Pending')
                          .reduce((sum, r) => sum + Number(r.requisition_amount), 0)
                      )}
                    </p>
                  </div>
                  <div className="p-3 rounded-2xl bg-black/40 border border-white/5">
                    <p className="text-[8px] font-bold uppercase tracking-widest text-slate-500">Approved Value</p>
                    <p className="text-xs font-mono font-extrabold text-emerald-400 mt-2">
                      {formatCurrency(
                        requisitions
                          .filter(r => r.work_order_no === activeWO.work_order_no && r.requisition_status === 'Approved')
                          .reduce((sum, r) => sum + Number(r.approved_amount ?? r.requisition_amount), 0)
                      )}
                    </p>
                  </div>
                  <div className="p-3 rounded-2xl bg-black/40 border border-white/5">
                    <p className="text-[8px] font-bold uppercase tracking-widest text-slate-500">Hold / Cancelled</p>
                    <p className="text-xs font-mono font-extrabold text-red-400 mt-2">
                      {formatCurrency(
                        requisitions
                          .filter(r => r.work_order_no === activeWO.work_order_no && ['Hold', 'Cancelled'].includes(r.requisition_status))
                          .reduce((sum, r) => sum + Number(r.requisition_amount), 0)
                      )}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6 animate-fadeIn">
            {/* Search Bar, Tabs & Refresh */}
            <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4 mb-5">
              <div className="flex flex-wrap items-center gap-1 glass-panel p-1 rounded-xl border border-white/5">
                <button
                  onClick={() => setCurrentTab('pending')}
                  className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-[9px] sm:text-[10px] font-bold uppercase tracking-wider transition-all duration-200 ${
                    currentTab === 'pending'
                      ? 'bg-white/10 text-slate-100 border border-white/10'
                      : 'text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  Pending ({requisitions.filter(r => r.requisition_status === 'Pending').length})
                </button>
                <button
                  onClick={() => setCurrentTab('approved')}
                  className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-[9px] sm:text-[10px] font-bold uppercase tracking-wider transition-all duration-200 ${
                    currentTab === 'approved'
                      ? 'bg-white/10 text-slate-100 border border-white/10'
                      : 'text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  Approved ({requisitions.filter(r => r.requisition_status === 'Approved').length})
                </button>
                <button
                  onClick={() => setCurrentTab('hold')}
                  className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-[9px] sm:text-[10px] font-bold uppercase tracking-wider transition-all duration-200 ${
                    currentTab === 'hold'
                      ? 'bg-white/10 text-slate-100 border border-white/10'
                      : 'text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  Hold ({requisitions.filter(r => r.requisition_status === 'Hold').length})
                </button>
                <button
                  onClick={() => setCurrentTab('all')}
                  className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-[9px] sm:text-[10px] font-bold uppercase tracking-wider transition-all duration-200 ${
                    currentTab === 'all'
                      ? 'bg-white/10 text-slate-100 border border-white/10'
                      : 'text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  All ({requisitions.length})
                </button>
                <button
                  onClick={() => setCurrentTab('directory')}
                  className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-[9px] sm:text-[10px] font-bold uppercase tracking-wider transition-all duration-200 ${
                    currentTab === 'directory'
                      ? 'bg-white/10 text-slate-100 border border-white/10'
                      : 'text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  Projects Directory ({
                    projects.filter(p =>
                      estimates.some(e => e.work_order_no === p.work_order_no && e.estimate_status === 'Final Approved')
                    ).length
                  })
                </button>
              </div>

              {currentTab !== 'directory' && (
                <div className="flex flex-wrap items-center gap-3">
                  <Input
                    type="text"
                    placeholder="Search requisitions…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    size="sm"
                    iconLeft={
                      <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    }
                    containerClassName="w-48 sm:w-60"
                  />

                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-500 font-bold uppercase">Show:</span>
                    <select
                      value={pageSize}
                      onChange={(e) => setPageSize(Number(e.target.value))}
                      className="px-2.5 py-1.5 rounded-xl text-xs bg-slate-950/80 border border-white/10 text-slate-300 focus:outline-none focus:border-amber-500/50 font-bold cursor-pointer"
                    >
                      <option value={5}>5 / pg</option>
                      <option value={10}>10 / pg</option>
                      <option value={20}>20 / pg</option>
                      <option value={50}>50 / pg</option>
                    </select>
                  </div>

                  {user?.role?.toLowerCase() !== 'je' && (
                    <Button
                      onClick={() => setShowExportModal(true)}
                      title="Export Expenditure Sheet"
                      variant="glass"
                      size="sm"
                      className="border-white/10 hover:border-amber-500/30 text-slate-300 hover:text-amber-400"
                    >
                      <svg className="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Export Expenditure Sheet
                    </Button>
                  )}

                  <Button
                    variant="glass"
                    size="sm"
                    onClick={() => queryClient.invalidateQueries({ queryKey: ['requisitions'] })}
                    title="Refresh"
                    icon={
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    }
                  />
                </div>
              )}
            </div>

            {currentTab === 'directory' ? (
              <div className="space-y-6 animate-fadeIn">
                {/* Search filters */}
                <div className="glass-panel p-5 rounded-3xl border border-white/5 flex flex-col gap-4 text-left">
                  <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400">Filter Projects Directory</span>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                    <Input
                      type="text"
                      value={dirSearchWO}
                      onChange={(e) => setDirSearchWO(e.target.value)}
                      placeholder="Search Estimate or WO..."
                      size="sm"
                      label="Estimate / Work Order No"
                    />
                    <Input
                      type="text"
                      value={dirSearchDept}
                      onChange={(e) => setDirSearchDept(e.target.value)}
                      placeholder="Filter by Department..."
                      size="sm"
                      label="Department"
                    />
                    <Input
                      type="text"
                      value={dirSearchZone}
                      onChange={(e) => setDirSearchZone(e.target.value)}
                      placeholder="Filter by Zone/Area..."
                      size="sm"
                      label="Zone / Area"
                    />
                    <Select
                      value={dirFilterStatus}
                      onChange={(e) => setDirFilterStatus(e.target.value)}
                      size="sm"
                      label="Project Status"
                    >
                      <option value="">All Statuses</option>
                      <option value="Running">Running</option>
                      <option value="Closed">Closed</option>
                      <option value="Complete Under Maintenance">Complete Under Maintenance</option>
                    </Select>
                  </div>
                </div>

                {/* Grid layout list */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredProjects.length === 0 ? (
                    <div className="col-span-full p-10 text-center text-slate-500 font-medium italic glass-panel rounded-3xl">
                      No projects matched directory filters.
                    </div>
                  ) : (
                    filteredProjects.map((proj) => (
                      <div
                        key={proj.work_order_no}
                        onClick={() => setActiveWO(proj)}
                        className="glass-panel glass-card-hover p-6 rounded-3xl border border-white/5 cursor-pointer relative overflow-hidden flex flex-col justify-between min-h-[200px] text-left font-sans text-slate-100"
                      >
                        <div>
                          <div className="flex justify-between items-start mb-3">
                            <span className="text-[9px] font-bold uppercase tracking-widest text-amber-500 font-mono truncate max-w-[200px]" title={proj.department}>
                              {proj.department}
                            </span>
                            <Badge variant={proj.status === 'Running' ? 'emerald' : proj.status === 'Closed' ? 'red' : 'amber'} showDot={false}>
                              {proj.status}
                            </Badge>
                          </div>
                          
                          <h3 className="text-sm font-extrabold text-slate-200 font-mono" title={proj.approvedEst?.estimate_no}>
                            {proj.approvedEst?.estimate_no || 'No Approved Estimate'}
                          </h3>
                          <p className="text-[10px] text-slate-400 font-mono mt-1">
                            WO: {proj.work_order_no}
                          </p>
                          <p className="text-xs text-slate-400 mt-2 truncate-2-lines min-h-[32px]">
                            {proj.site_details}
                          </p>
                        </div>

                        <div className="border-t border-white/5 pt-4 mt-4 flex items-center justify-between">
                          <div className="flex flex-col">
                            <span className="text-[8px] uppercase tracking-widest text-slate-500">Geography</span>
                            <span className="text-xs text-slate-300 font-semibold mt-0.5">{proj.state} / {proj.district}</span>
                          </div>
                          <span className="text-[10px] font-bold text-amber-500 uppercase tracking-widest group-hover:translate-x-1 transition duration-200">
                            Open Requisitions &rarr;
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : (
              /* Requisitions List Table */
              <div className="glass-panel rounded-3xl overflow-hidden shadow-2xl border border-white/10 bg-[#0d131f]/90 backdrop-blur-xl min-h-[400px] flex flex-col">
                {loading ? (
                  <SkeletonTable rows={6} cols={7} />
                ) : filteredRequisitions.length === 0 ? (
                  <div className="text-center flex-1 flex items-center justify-center p-24 text-slate-400 text-xs uppercase font-extrabold tracking-widest">
                    No requisitions matching parameters.
                  </div>
                ) : (
                  <>
                    <Table>
                      <TableHeader className="bg-slate-900/90 border-b border-white/10">
                        <TableRow hover={false} className="border-b border-white/10 bg-slate-900/90">
                          {['Requisition No.', 'Work Order', 'Material Head', 'Amount', 'Status', 'Payment Office', 'Submitted Date', 'Actions'].map((h) => (
                            <TableCell key={h} isHeader={true} className="text-slate-300 font-black uppercase tracking-widest text-[10px] py-4 bg-slate-900/90">
                              {h}
                            </TableCell>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody className="divide-y divide-white/5">
                        {paginatedRequisitions.map((req) => {
                          const isPending = req.requisition_status === 'Pending';
                          const isHold = req.requisition_status === 'Hold';
                          const financialState = getRequisitionFinancialState(req);
                          const isOwner = req.requester_user_id === user?.mobile_number;
                          const isAdmin = user?.role === 'admin';
                          const canCancel = isPending && (isOwner || isAdmin);
                          return (
                            <TableRow key={req.requisition_id} className="hover:bg-white/[0.04] transition-colors border-b border-white/5">
                              <TableCell className="font-mono font-bold text-slate-100 text-xs">
                                {req.requisition_no}
                              </TableCell>
                              <TableCell className="font-mono text-slate-300 font-semibold hover:text-amber-400 cursor-pointer transition-colors text-xs">
                                {req.work_order_no}
                              </TableCell>
                              <TableCell className="text-slate-200 font-bold text-xs">
                                {req.material_main_head}
                              </TableCell>
                              <TableCell className="font-mono font-black text-amber-400 text-sm tracking-tight">
                                {req.requisition_status === 'Approved'
                                  ? formatCurrency(req.approved_amount ?? req.requisition_amount)
                                  : formatCurrency(req.requisition_amount)
                                }
                              </TableCell>
                              <TableCell>
                                <StatusBadge status={financialState.status} />
                              </TableCell>
                              <TableCell className="text-xs text-slate-300">{formatPaymentOffice(req.payment_destination)}</TableCell>
                              <TableCell className="text-xs text-slate-300 font-medium">
                                {formatDate(req.created_at)}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2 opacity-90 group-hover:opacity-100 transition-opacity duration-200">
                                  {/* View details */}
                                  <Button
                                    variant="glass"
                                    size="xs"
                                    className="bg-white/10 hover:bg-white/20 text-slate-100 font-extrabold border border-white/15 shadow-sm"
                                    onClick={() => setActiveReqId(req.requisition_id)}
                                  >
                                    View Details
                                  </Button>

                                  {/* Take Action Button (ZO/HO/Admin for Pending/Hold rows) */}
                                  {(isPending || isHold) && ['zo', 'ho', 'admin'].includes(user?.role) && (
                                    <Button
                                      variant="glass"
                                      size="xs"
                                      className="text-slate-950 font-black bg-amber-500 hover:bg-amber-400 border border-amber-400 shadow-md shadow-amber-500/20"
                                      onClick={() => setActionTargetReq(req)}
                                    >
                                      Take Action
                                    </Button>
                                  )}

                                  {/* Choose Payment Route Button (ZO/Admin for Approved-but-unrouted rows) */}
                                  {req.requisition_status === 'Approved' && !req.payment_destination && ['zo', 'admin'].includes(user?.role) && (
                                    <Button
                                      variant="glass"
                                      size="xs"
                                      className="text-slate-950 font-black bg-indigo-400 hover:bg-indigo-300 border border-indigo-300 shadow-md shadow-indigo-500/20"
                                      onClick={() => setRouteTargetReq(req)}
                                    >
                                      Choose Payment Route
                                    </Button>
                                  )}

                                  {/* Cancel Button */}
                                  {canCancel && (
                                    <Button
                                      variant="danger"
                                      size="xs"
                                      className="bg-rose-500/20 hover:bg-rose-500 text-rose-300 hover:text-white border border-rose-500/30 font-bold"
                                      onClick={() => setCancelTarget({ id: req.requisition_id, no: req.requisition_no })}
                                    >
                                      Cancel
                                    </Button>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>

                    {/* Pagination Controls Footer */}
                    <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} maxVisible={5} />
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </main>
      </div>

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

      {/* Payment Route Modal (triggered right after Approve, or from a row/detail action) */}
      {routeTargetReq && (
        <PaymentRouteModal
          requisition={routeTargetReq}
          onClose={() => setRouteTargetReq(null)}
          onChooseRoute={handleChooseRoute}
        />
      )}

      {/* Export Expenditure Sheet Modal */}
      {showExportModal && user?.role?.toLowerCase() !== 'je' && (
        <ExportExpenditureModal
          projects={projects}
          onClose={() => setShowExportModal(false)}
          loading={isExporting}
          onConfirm={async ({ dateRange, workOrderFilter }) => {
            setIsExporting(true);
            try {
              const [frRes, reqRes, returnRes] = await Promise.all([
                getFundRequests().catch(() => ({ data: { fundRequests: [] } })),
                getRequisitions().catch(() => ({ data: { requisitions: [] } })),
                getReturnRequests().catch(() => ({ data: { returns: [] } }))
              ]);
              const allFundRequests = frRes.data?.fundRequests || [];
              const allRequisitions = reqRes.data?.requisitions || reqRes.data || requisitionsData || [];
              const allFundReturns = returnRes.data?.returns || [];
              await exportCombinedExpenditureSheet({
                fundRequests: allFundRequests,
                requisitions: allRequisitions,
                fundReturns: allFundReturns,
                projects,
                metadata: { workOrderFilter: workOrderFilter || 'All' },
                dateRange
              });
              setShowExportModal(false);
            } catch (err) {
              console.error('Export expenditure failed:', err);
              alert('Failed to export expenditure sheet: ' + (err.message || 'Unknown error'));
            } finally {
              setIsExporting(false);
            }
          }}
        />
      )}

    </>
  );
};

export default Requisitions;
