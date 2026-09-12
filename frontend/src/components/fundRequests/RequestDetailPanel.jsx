import React, { useState, useEffect, useMemo } from 'react';
import TimelineProgress from './TimelineProgress';
import { getProjects, getProjectCapacity } from '../../api/projectsApi';
import { getZonalBalances } from '../../api/zoBalancesApi';
import { getIndianBanks } from '../../api/requisitionsApi';
import { FormattedCurrencyInput, Select } from '../ui';
import ProjectBeneficiarySuggestions from '../requisitions/ProjectBeneficiarySuggestions';
import {
  computeHoApproveRemaining,
  computePipelineRemainingAfterApprove
} from '../../utils/businessRules/fundRequests';

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

const getBeneficiaryValidationError = ({ name, accountNo, ifsc, bankId }) => {
  if (!name.trim()) return 'Beneficiary name is required.';
  if (!accountNo.trim() || !/^\d{9,18}$/.test(accountNo.trim())) {
    return 'Beneficiary account number must be 9-18 digits.';
  }
  if (!ifsc.trim() || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.trim().toUpperCase())) {
    return 'Beneficiary IFSC must be 11-char in format AAAA0XXXXXX.';
  }
  if (!bankId) return 'Beneficiary bank is required.';
  return null;
};

/** Display-only: Final Approved estimate and spec 4(c) remaining (never WO-value fallback). */
function getFinalApprovedEstimateDisplay(capacity) {
  if (!capacity || capacity.estimate_amount == null) {
    return { estimateValue: null, remainingCapacity: null };
  }
  const estimateValue = Number(capacity.estimate_amount);
  const submittedTotal = Number(capacity.fr_submitted_total || 0);
  return {
    estimateValue,
    remainingCapacity: estimateValue - submittedTotal
  };
}

const RequestDetailPanel = ({
  user,
  request,        // null if creating new
  initialWorkOrder = '',
  onClose,
  onSave,         // ZO submit function
  onSaveDraft,
  onUpdate,
  onSubmit,
  onAct,          // Accounts approve/hold action function
  onCancel        // ZO cancel action function
}) => {
  const isCreate = !request;
  const isDraft = request?.request_status === 'Draft';
  const isEditable = isCreate || (isDraft && (request.zo_user_id === user?.mobile_number || user?.role === 'admin'));
  const isPending = request?.request_status === 'Pending';
  const isHold = request?.request_status === 'Hold';
  const isPendingOrHold = isPending || isHold;
  // Fund Request approval is performed only from the Accounts Requisition
  // Sheet; this panel is never an approval surface.
  const isApproverRole = false;
  const isZoOrAdmin = user?.role === 'zo' || user?.role === 'staff' || user?.role === 'admin';

  // State values
  const [zoFrNo, setZoFrNo] = useState('');
  const [zoFrAmount, setZoFrAmount] = useState('');
  const [zoRemarks, setZoRemarks] = useState('');

  // Beneficiary banking details (creation mode) — shared projects_beneficiary_master
  const [beneficiaryAcNo, setBeneficiaryAcNo] = useState('');
  const [beneficiaryIfsc, setBeneficiaryIfsc] = useState('');
  const [beneficiaryName, setBeneficiaryName] = useState('');
  const [beneficiaryBankId, setBeneficiaryBankId] = useState('');
  const [beneficiaryBankName, setBeneficiaryBankName] = useState('');
  const [indianBanks, setIndianBanks] = useState([]);

  // Projects and capacity states for creation mode
  const [projects, setProjects] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [selectedWorkOrder, setSelectedWorkOrder] = useState('');
  const [selectedProjectValue, setSelectedProjectValue] = useState(null);
  const [remainingCapacity, setRemainingCapacity] = useState(null);

  // Detail context states (for viewing mode)
  const [detailProjectValue, setDetailProjectValue] = useState(null);
  const [detailRemainingCapacity, setDetailRemainingCapacity] = useState(null);
  const [detailHoApproveRemaining, setDetailHoApproveRemaining] = useState(null);
  const [detailZoBalance, setDetailZoBalance] = useState(null);
  const [loadingContext, setLoadingContext] = useState(false);

  // HO action states
  const [hoAction, setHoAction] = useState('Approve');
  const [hoAmount, setHoAmount] = useState('');
  const [hoAccount, setHoAccount] = useState('');
  const [hoRemarks, setHoRemarks] = useState('');
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionError, setActionError] = useState('');

  // Load projects list for dropdown in creation mode
  useEffect(() => {
    if (isEditable && user) {
      Promise.resolve().then(() => {
        setLoadingProjects(true);
      });
      getProjects({ has_approved_estimate: true })
        .then((res) => {
          const list = res.data?.projects || [];
          // Filter: Owned by ZO and status is Active (Running) or Under Maintenance (Complete Under Maintenance)
          const eligible = list.filter(
            (p) =>
              p.zo_user_id === user.mobile_number &&
              (p.status === 'Running' || p.status === 'Complete Under Maintenance')
          );
          setProjects(eligible);
        })
        .catch((err) => {
          console.error('Failed to load projects mapping', err);
        })
        .finally(() => {
          setLoadingProjects(false);
        });
    }
  }, [isEditable, user]);

  useEffect(() => {
    if (isEditable && initialWorkOrder) {
      setSelectedWorkOrder(initialWorkOrder);
    }
  }, [isEditable, initialWorkOrder]);

  // Load active Indian Banks for the beneficiary bank dropdown in creation mode
  useEffect(() => {
    if (isEditable) {
      getIndianBanks()
        .then((res) => {
          const banks = (res.data?.indianBanks || []).filter((b) => b.is_active);
          setIndianBanks(banks);
        })
        .catch((err) => {
          console.error('Failed to load Indian Banks', err);
        });
    }
  }, [isEditable]);

  // Recalculate remaining capacity when Work Order is selected in creation mode
  useEffect(() => {
    if (isEditable && selectedWorkOrder) {
      getProjectCapacity(selectedWorkOrder)
        .then((res) => {
          const { estimateValue, remainingCapacity: remaining } = getFinalApprovedEstimateDisplay(
            res.data?.capacity
          );
          setSelectedProjectValue(estimateValue);
          setRemainingCapacity(remaining);
        })
        .catch((err) => {
          console.error('Failed to fetch work order capacity', err);
          setSelectedProjectValue(null);
          setRemainingCapacity(null);
        });
    } else {
      setSelectedProjectValue(null);
      setRemainingCapacity(null);
    }
  }, [isEditable, selectedWorkOrder]);

  // Load context details (estimate, remaining capacity, ZO balance) in viewing mode
  useEffect(() => {
    if (!isCreate && request?.work_order_no) {
      setLoadingContext(true);
      Promise.all([
        getProjectCapacity(request.work_order_no),
        getZonalBalances()
      ])
        .then(([capacityRes, balancesRes]) => {
          const capacity = capacityRes.data?.capacity;
          const { estimateValue, remainingCapacity } = getFinalApprovedEstimateDisplay(capacity);
          setDetailProjectValue(estimateValue);
          setDetailRemainingCapacity(remainingCapacity);
          setDetailHoApproveRemaining(
            computeHoApproveRemaining(
              capacity?.estimate_amount,
              capacity?.fr_submitted_total,
              request
            )
          );

          const balances = balancesRes.data?.balances || [];
          const matchedBalance = balances.find((b) => b.zo_user_id === request.zo_user_id);
          setDetailZoBalance(matchedBalance ? matchedBalance.available_balance : 0);
        })
        .catch((err) => {
          console.error('Failed to load request context details', err);
        })
        .finally(() => {
          setLoadingContext(false);
        });
    }
  }, [isCreate, request]);

  // Load request details if viewing
  useEffect(() => {
    Promise.resolve().then(() => {
      if (request) {
        setZoFrNo(request.zo_fr_no);
        setZoFrAmount(request.zo_fr_amount);
        setZoRemarks(request.zo_remarks || '');
        setHoRemarks(request.ho_remarks || '');
        setSelectedWorkOrder(request.work_order_no || '');
        setBeneficiaryAcNo(request.beneficiary_ac_no || '');
        setBeneficiaryIfsc(request.beneficiary_ifsc || '');
        setBeneficiaryName(request.beneficiary_name || '');
        setBeneficiaryBankId(request.beneficiary_bank_id || '');
        setBeneficiaryBankName(request.beneficiary_bank_name || '');
        
      } else {
        // Clear forms
        setZoFrNo('');
        setZoFrAmount('');
        setZoRemarks('');
      }
    });
  }, [request]);

  // Set default HO approved amount matching requested amount
  useEffect(() => {
    if (request && isPendingOrHold) {
      Promise.resolve().then(() => {
        setHoAmount(request.zo_fr_amount);
      });
    }
  }, [request, isPendingOrHold]);

  // Clear HO inputs when action changes to Hold (per process flow specs)
  useEffect(() => {
    if (hoAction === 'Hold') {
      Promise.resolve().then(() => {
        setHoRemarks('');
        setHoAmount('');
        setHoAccount('');
      });
    }
  }, [hoAction]);


  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    if (!selectedWorkOrder) {
      setActionError('Work Order selection is required.');
      return;
    }
    if (!zoFrNo.trim()) {
      setActionError('Fund Request Number is required.');
      return;
    }
    const parsedAmount = parseFloat(zoFrAmount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setActionError('Amount must be a positive number.');
      return;
    }
    if (remainingCapacity !== null && parsedAmount > remainingCapacity) {
      setActionError(`Requested amount cannot exceed the remaining Work Order funding capacity of ${formatCurrency(remainingCapacity)}.`);
      return;
    }
    if (!zoRemarks.trim()) {
      setActionError('Remarks are required to submit a fund request.');
      return;
    }
    const beneficiaryError = getBeneficiaryValidationError({
      name: beneficiaryName,
      accountNo: beneficiaryAcNo,
      ifsc: beneficiaryIfsc,
      bankId: beneficiaryBankId
    });
    if (beneficiaryError) {
      setActionError(beneficiaryError);
      return;
    }

    setActionError('');
    setActionSubmitting(true);
    try {
      await onSave({
        work_order_no: selectedWorkOrder,
        zo_fr_no: zoFrNo.trim(),
        zo_fr_amount: parsedAmount,
        zo_remarks: zoRemarks.trim() || null,
        beneficiary_ac_no: beneficiaryAcNo.trim() || null,
        beneficiary_ifsc: beneficiaryIfsc.trim() || null,
        beneficiary_name: beneficiaryName.trim() || null,
        beneficiary_bank_id: beneficiaryBankId || null,
        beneficiary_bank_name: beneficiaryBankName.trim() || null,
        submission_mode: 'submit'
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

  const getDraftPayload = () => ({
    work_order_no: selectedWorkOrder,
    zo_fr_no: zoFrNo.trim(),
    zo_fr_amount: Number(zoFrAmount),
    zo_remarks: zoRemarks.trim() || null,
    beneficiary_ac_no: beneficiaryAcNo.trim() || null,
    beneficiary_ifsc: beneficiaryIfsc.trim() || null,
    beneficiary_name: beneficiaryName.trim() || null,
    beneficiary_bank_id: beneficiaryBankId || null,
    beneficiary_bank_name: beneficiaryBankName.trim() || null,
    submission_mode: 'draft'
  });

  const handleSaveDraft = async (e) => {
    e.preventDefault();
    if (!selectedWorkOrder || !zoFrNo.trim()) {
      setActionError('Work Order and Fund Request Number are required to save a draft.');
      return;
    }
    const parsedAmount = Number(zoFrAmount);
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
      setActionError('Amount must be a finite non-negative number.');
      return;
    }
    setActionError('');
    setActionSubmitting(true);
    try {
      const payload = getDraftPayload();
      if (isDraft) await onUpdate(request.fund_request_id, payload);
      else await onSaveDraft(payload);
      onClose();
    } catch (err) {
      setActionError(err.response?.data?.message || 'Failed to save draft.');
    } finally {
      setActionSubmitting(false);
    }
  };

  const handleSubmitDraft = async (e) => {
    e.preventDefault();
    if (isCreate) return handleCreateSubmit(e);
    const beneficiaryError = getBeneficiaryValidationError({
      name: beneficiaryName,
      accountNo: beneficiaryAcNo,
      ifsc: beneficiaryIfsc,
      bankId: beneficiaryBankId
    });
    if (beneficiaryError) {
      setActionError(beneficiaryError);
      return;
    }
    setActionSubmitting(true);
    setActionError('');
    try {
      await onUpdate(request.fund_request_id, getDraftPayload());
      await onSubmit(request.fund_request_id);
      onClose();
    } catch (err) {
      setActionError(err.response?.data?.message || 'Failed to submit fund request.');
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
      if (detailHoApproveRemaining !== null && parsedAmount > detailHoApproveRemaining) {
        setActionError(`Approved amount cannot exceed the remaining Work Order funding capacity of ${formatCurrency(detailHoApproveRemaining)}.`);
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

  const todayFormatted = new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });

  const showHoApproveHeadroom = !isCreate && isPendingOrHold && isApproverRole;
  const showDualRemaining =
    !isCreate && isPendingOrHold && detailHoApproveRemaining != null && detailRemainingCapacity != null;
  const hoApprovedOnThisFr =
    !isCreate && request?.request_status === 'Approved' && request?.approve_ho_amount != null
      ? Number(request.approve_ho_amount)
      : null;

  const hoApprovePreviewAmount = useMemo(() => {
    if (!showHoApproveHeadroom || hoAction !== 'Approve') return null;
    const parsed = parseFloat(hoAmount);
    if (isNaN(parsed) || parsed <= 0) return null;
    return parsed;
  }, [showHoApproveHeadroom, hoAction, hoAmount]);

  const previewPipelineRemaining = useMemo(
    () => computePipelineRemainingAfterApprove(detailHoApproveRemaining, hoApprovePreviewAmount),
    [detailHoApproveRemaining, hoApprovePreviewAmount]
  );

  const isHoApproveLivePreview = previewPipelineRemaining != null;
  const displayRemainingFr = isHoApproveLivePreview
    ? previewPipelineRemaining
    : detailHoApproveRemaining;
  const displayRemainingAfterFr = isHoApproveLivePreview
    ? previewPipelineRemaining
    : detailRemainingCapacity;

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
                request.request_status === 'Pending' && request.accounts_line_item_id ? 'bg-indigo-500/10 border-indigo-500/25 text-indigo-400' :
                request.request_status === 'Pending' ? 'bg-amber-500/10 border-amber-500/25 text-amber-400' :
                request.request_status === 'Approved' ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400' :
                request.request_status === 'Hold' ? 'bg-red-500/10 border-red-500/25 text-red-400' :
                'bg-slate-500/10 border-slate-500/25 text-slate-400'
              }`}>
                {request.request_status === 'Pending' && request.accounts_line_item_id ? 'In Accounts Sheet' : request.request_status}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 font-medium mt-1">Create and manage fund requests against approved project estimates.</p>
        </div>
        <div className="flex items-center gap-3 self-end">
          {isEditable && (
            <>
              <button 
                onClick={onClose} 
                className="px-4 py-2 hover:bg-white/5 border border-white/5 rounded-xl text-xs font-bold uppercase tracking-wider text-slate-400 hover:text-slate-200 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveDraft}
                disabled={actionSubmitting}
                className="bg-white/10 hover:bg-white/20 border border-white/10 text-slate-200 font-bold px-5 py-2 rounded-xl text-xs uppercase tracking-wider transition"
              >
                {actionSubmitting ? 'Saving...' : 'Save Draft'}
              </button>
              <button
                onClick={handleSubmitDraft}
                disabled={actionSubmitting}
                className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-5 py-2 rounded-xl text-xs uppercase tracking-wider shadow-lg shadow-amber-500/20 transition flex items-center gap-2"
              >
                {actionSubmitting ? 'Submitting...' : 'Submit Request'}
              </button>
            </>
          )}
          {!isEditable && (
            <>
              {isPending && isZoOrAdmin && !request.accounts_line_item_id && (
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

      {!isCreate && request.accounts_line_item_id && isPending && (
        <div className="mb-5 p-4 bg-indigo-950/20 border border-indigo-900/30 rounded-2xl text-xs text-indigo-300 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />
            <span>This Fund Request has been imported into an Accounts Requisition Sheet. Final approval, bank debit, and ZO balance credit will occur upon Head Office approval of that sheet.</span>
          </div>
        </div>
      )}

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
                {isEditable ? (
                  <FormattedCurrencyInput
                    value={zoFrAmount}
                    onValueChange={(val) => setZoFrAmount(val)}
                    placeholder="0.00"
                    disabled={actionSubmitting}
                    className="!w-full text-center !bg-transparent outline-none !border-x-0 !border-t-0 !border-b !border-slate-700 focus:!border-amber-500 text-lg font-black text-slate-100 font-mono mt-2 !px-0 !py-1 !rounded-none"
                    containerClassName="w-full"
                  />
                ) : (
                  <span className="text-xl font-black text-emerald-400 font-mono mt-3">
                    {formatCurrency(request.zo_fr_amount)}
                  </span>
                )}
              </div>

              {/* Form/Request Metadata & remarks */}
              <div className="md:col-span-2 space-y-4">
                {isEditable && (
                  <div>
                    <label className="block text-[8px] font-bold uppercase tracking-widest text-slate-500 mb-1">Work Order (Project)</label>
                    <select
                      value={selectedWorkOrder}
                      onChange={(e) => setSelectedWorkOrder(e.target.value)}
                      disabled={actionSubmitting || loadingProjects}
                      className="w-full glass-input rounded-lg px-3 py-1.5 font-semibold text-xs bg-slate-900 border border-white/10 text-slate-100"
                    >
                      <option value="">-- Select Work Order --</option>
                      {projects.map((p) => (
                        <option key={p.work_order_no} value={p.work_order_no}>
                          {p.work_order_no} - {p.project_name} ({p.status})
                        </option>
                      ))}
                    </select>
                    {selectedWorkOrder && (
                      <div className="grid grid-cols-2 gap-2.5 p-3 rounded-2xl bg-white/[0.01] border border-white/5 text-xs text-left mt-2">
                        <div>
                          <span className="text-slate-500 block text-[9px] uppercase tracking-wider font-bold">Final Approved Estimate</span>
                          <span className="font-bold text-slate-300 font-mono">
                            {selectedProjectValue != null ? formatCurrency(selectedProjectValue) : '—'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[9px] uppercase tracking-wider font-bold">Remaining FR (Submitted)</span>
                          <span className="font-bold text-amber-400 font-mono">
                            {remainingCapacity !== null ? formatCurrency(remainingCapacity) : '—'}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4 text-xs">
                  {isEditable ? (
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
                  <label className="block text-[8px] font-bold uppercase tracking-widest text-slate-500 mb-1">
                    Remarks <span className="text-red-500 font-bold">*</span>
                  </label>
                  {isCreate ? (
                    <textarea
                      value={zoRemarks}
                      onChange={(e) => setZoRemarks(e.target.value)}
                      placeholder="Add request remarks..."
                      rows={2}
                      required
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

            {/* Beneficiary Banking Details */}
            <div className="mt-6 p-4 rounded-2xl bg-white/[0.02] border border-white/10 space-y-3.5 text-left">
              <div className="flex items-center justify-between pb-2 border-b border-white/5">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-400">
                  Beneficiary Banking Details
                </span>
                {isEditable && (
                  <span className="text-[9px] text-slate-500 italic">
                    Saved to the beneficiary directory on submission
                  </span>
                )}
              </div>

              {isEditable ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <ProjectBeneficiarySuggestions
                    label="Account No."
                    value={beneficiaryAcNo}
                    onChange={(e) => setBeneficiaryAcNo(e.target.value.replace(/\D/g, '').slice(0, 18))}
                    maxLength={18}
                    onSelect={(b) => {
                      setBeneficiaryAcNo(b.beneficiary_ac_no || '');
                      setBeneficiaryIfsc(b.beneficiary_ifsc || '');
                      setBeneficiaryName(b.beneficiary_name || '');
                      setBeneficiaryBankId(b.beneficiary_bank_id || b.beneficiary_bank?.id || '');
                      setBeneficiaryBankName(b.beneficiary_bank?.bank_name || b.beneficiary_bank_name || '');
                    }}
                    placeholder="Enter bank account no…"
                    disabled={actionSubmitting}
                    required
                    size="sm"
                  />

                  <div>
                    <label className="block text-[8px] font-bold uppercase tracking-widest text-slate-500 mb-1">IFSC Code</label>
                    <input
                      type="text"
                      value={beneficiaryIfsc}
                      onChange={(e) => setBeneficiaryIfsc(e.target.value.toUpperCase().trim())}
                      placeholder="e.g. SBIN0001234"
                      maxLength={11}
                      disabled={actionSubmitting}
                      required
                      className="w-full glass-input rounded-lg px-3 py-1.5 font-semibold text-xs"
                    />
                  </div>

                  <ProjectBeneficiarySuggestions
                    label="Beneficiary Name"
                    value={beneficiaryName}
                    searchBy="name"
                    primaryField="name"
                    enabled={!actionSubmitting}
                    onChange={(e) => {
                      setBeneficiaryName(e.target.value);
                      setBeneficiaryAcNo('');
                      setBeneficiaryIfsc('');
                      setBeneficiaryBankId('');
                      setBeneficiaryBankName('');
                    }}
                    onClearSelection={() => {
                      setBeneficiaryName('');
                      setBeneficiaryAcNo('');
                      setBeneficiaryIfsc('');
                      setBeneficiaryBankId('');
                      setBeneficiaryBankName('');
                    }}
                    onSelect={(b) => {
                      setBeneficiaryAcNo(b.beneficiary_ac_no || '');
                      setBeneficiaryIfsc(b.beneficiary_ifsc || '');
                      setBeneficiaryName(b.beneficiary_name || '');
                      setBeneficiaryBankId(b.beneficiary_bank_id || b.beneficiary_bank?.id || '');
                      setBeneficiaryBankName(b.beneficiary_bank?.bank_name || b.beneficiary_bank_name || '');
                    }}
                    placeholder="Enter payee name…"
                    disabled={actionSubmitting}
                    required
                    size="sm"
                  />

                  <Select
                    label="Indian Banks"
                    value={beneficiaryBankId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setBeneficiaryBankId(id);
                      const found = indianBanks.find((b) => b.id === id);
                      setBeneficiaryBankName(found ? found.bank_name : '');
                    }}
                    disabled={actionSubmitting}
                    required
                  >
                    <option value="">-- Select Bank --</option>
                    {indianBanks.map((b) => (
                      <option key={b.id} value={b.id}>{b.bank_name}</option>
                    ))}
                  </Select>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                  <div>
                    <span className="text-slate-500 block text-[9px] uppercase tracking-wider font-bold">Account No.</span>
                    <span className="font-bold text-slate-300 font-mono">{request.beneficiary_ac_no || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[9px] uppercase tracking-wider font-bold">IFSC Code</span>
                    <span className="font-bold text-slate-300 font-mono">{request.beneficiary_ifsc || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[9px] uppercase tracking-wider font-bold">Beneficiary Name</span>
                    <span className="font-bold text-slate-300">{request.beneficiary_name || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[9px] uppercase tracking-wider font-bold">Bank</span>
                    <span className="font-bold text-slate-300">{request.beneficiary_bank_name || '—'}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {!isCreate && (
            <div
              className={`grid grid-cols-2 md:grid-cols-3 gap-4 p-5 rounded-3xl bg-white/[0.02] border border-white/5 text-xs text-left ${
                showDualRemaining ? 'lg:grid-cols-6' : 'lg:grid-cols-5'
              }`}
            >
              <div>
                <span className="text-slate-500 block text-[9px] uppercase tracking-wider font-bold">Work Order</span>
                <span className="font-bold text-slate-300 font-mono">{request.work_order_no || '—'}</span>
              </div>
              <div>
                 <span className="text-slate-500 block text-[9px] uppercase tracking-wider font-bold">Final Approved Estimate</span>
                 <span className="font-bold text-slate-300 font-mono">
                   {loadingContext ? 'Loading...' : (detailProjectValue != null ? formatCurrency(detailProjectValue) : '—')}
                 </span>
              </div>
              <div>
                <span className="text-slate-500 block text-[9px] uppercase tracking-wider font-bold">Accounts Approved (This FR)</span>
                {hoApprovedOnThisFr != null ? (
                  <span className="font-bold font-mono text-emerald-400">
                    {loadingContext ? 'Loading...' : formatCurrency(hoApprovedOnThisFr)}
                  </span>
                ) : hoApprovePreviewAmount != null ? (
                  <>
                    <span className="font-bold font-mono text-emerald-400">
                      {loadingContext ? 'Loading...' : formatCurrency(hoApprovePreviewAmount)}
                    </span>
                    <span className="block text-[9px] text-slate-500 mt-1 leading-snug">
                      Preview — not saved yet
                    </span>
                  </>
                ) : (
                  <>
                    <span className="font-bold font-mono text-amber-400">
                      {loadingContext ? 'Loading...' : '—'}
                    </span>
                    {!loadingContext && (
                      <span className="block text-[9px] text-slate-500 mt-1 leading-snug">
                        {isPendingOrHold ? 'Pending Accounts approval' : 'Not Accounts-approved'}
                      </span>
                    )}
                  </>
                )}
              </div>
              {showDualRemaining ? (
                <>
                  <div>
                    <span className="text-slate-500 block text-[9px] uppercase tracking-wider font-bold">Remaining FR</span>
                    <span
                      className={`font-bold font-mono ${
                        displayRemainingFr != null && displayRemainingFr < 0
                          ? 'text-red-400'
                          : isHoApproveLivePreview
                            ? 'text-cyan-400'
                            : 'text-emerald-400'
                      }`}
                    >
                      {loadingContext ? 'Loading...' : formatCurrency(displayRemainingFr)}
                    </span>
                    <span className="block text-[9px] text-slate-500 mt-1 leading-snug">
                      {isHoApproveLivePreview
                        ? 'Preview — WO headroom after approval'
                        : 'Excl. this pending request'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[9px] uppercase tracking-wider font-bold">Remaining After This FR</span>
                    <span
                      className={`font-bold font-mono ${
                        displayRemainingAfterFr != null && displayRemainingAfterFr < 0
                          ? 'text-red-400'
                          : isHoApproveLivePreview
                            ? 'text-cyan-400'
                            : 'text-amber-400'
                      }`}
                    >
                      {loadingContext ? 'Loading...' : formatCurrency(displayRemainingAfterFr)}
                    </span>
                    <span className="block text-[9px] text-slate-500 mt-1 leading-snug">
                      {isHoApproveLivePreview
                        ? 'Preview — pipeline after approval'
                        : 'Incl. all submitted FRs'}
                    </span>
                  </div>
                </>
              ) : (
                <div>
                  <span className="text-slate-500 block text-[9px] uppercase tracking-wider font-bold">Remaining FR (Submitted)</span>
                  <span className="font-bold font-mono text-amber-400">
                    {loadingContext ? 'Loading...' : (detailRemainingCapacity != null ? formatCurrency(detailRemainingCapacity) : '—')}
                  </span>
                </div>
              )}
              <div>
                <span className="text-slate-500 block text-[9px] uppercase tracking-wider font-bold">ZO Available Balance</span>
                <span className="font-bold text-emerald-400 font-mono">
                  {loadingContext ? 'Loading...' : formatCurrency(detailZoBalance)}
                </span>
              </div>
            </div>
          )}

          {/* Card D: Approval Timeline bar component */}
          {!isCreate && <TimelineProgress status={request.request_status} />}

        </div>

        {/* Right column sidebar panels */}
        <div className="space-y-6 text-left">
          
          {/* Panel 1: APPROVAL INFORMATION */}
          {!isCreate && (
            <div className="glass-panel p-5 rounded-3xl border border-white/5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-4">Approval Information</span>
              
              {isPendingOrHold && isApproverRole ? (
                request.accounts_line_item_id ? (
                  <div className="p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-xs text-indigo-300">
                    <p className="font-bold mb-1">Queued in Accounts Requisition Sheet</p>
                    <p className="text-slate-400 text-[11px] leading-relaxed">
                      This Fund Request was imported into an Accounts Requisition Sheet. Final approval, bank selection, and ZO balance credit will be executed when Head Office approves the Accounts Sheet.
                    </p>
                  </div>
                ) : (
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
                      {detailHoApproveRemaining != null && (
                        <p className="text-[10px] text-slate-400 leading-relaxed rounded-lg border border-emerald-500/15 bg-emerald-500/5 px-3 py-2">
                          <span className="font-mono font-bold text-emerald-400">
                            {formatCurrency(detailHoApproveRemaining)}
                          </span>{' '}
                          remaining on this WO (excl. this pending request). You may approve up to that on this FR.
                          {(isHoApproveLivePreview ? previewPipelineRemaining : detailRemainingCapacity) != null && (
                            <>
                              {' '}
                              After this FR,{' '}
                              <span
                                className={`font-mono ${
                                  isHoApproveLivePreview ? 'text-cyan-400/90' : 'text-amber-400/90'
                                }`}
                              >
                                {formatCurrency(
                                  isHoApproveLivePreview
                                    ? previewPipelineRemaining
                                    : detailRemainingCapacity
                                )}
                              </span>{' '}
                              will remain on the WO pipeline
                              {isHoApproveLivePreview ? ' (preview)' : ''}.
                            </>
                          )}
                        </p>
                      )}
                      <div>
                        <label className="block text-[8px] font-bold uppercase tracking-widest text-slate-500 mb-1">
                          Amount to Approve (₹)
                        </label>
                        <FormattedCurrencyInput
                          placeholder={
                            detailHoApproveRemaining != null
                              ? `Max ${formatCurrency(Math.min(detailHoApproveRemaining, Number(request.zo_fr_amount || 0)))}`
                              : 'Enter amount to approve...'
                          }
                          value={hoAmount}
                          onValueChange={(val) => setHoAmount(val)}
                          required
                          disabled={actionSubmitting}
                          className="font-mono text-xs"
                          size="sm"
                        />
                        <p className="text-[9px] text-slate-500 mt-1">
                          Requested {formatCurrency(request.zo_fr_amount)} — not approved until you save.
                        </p>
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
                    <label className="block text-[8px] font-bold uppercase tracking-widest text-slate-500 mb-1">Remarks</label>
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
                )
              ) : (
                <div className="space-y-3.5 text-xs">
                  <div className="flex justify-between items-center pb-2 border-b border-white/5">
                    <span className="text-slate-500 font-semibold">Approved By</span>
                    <span className="font-bold text-slate-300">{request.approve_ho_name || (request.approve_ho_user_id ? 'Accounts User' : '—')}</span>
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

          {/* Panel 3: ACTIVITY LOG */}
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
