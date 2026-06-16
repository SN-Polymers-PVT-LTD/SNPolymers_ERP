import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../components/AuthContext';
import BackgroundShapes from '../components/BackgroundShapes';
import Sidebar, { MobileHeader } from '../components/Sidebar';
import authApi from '../api/authApi';

const ESTIMATE_STATUS = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  UNDER_ZO_REVIEW: 'Under ZO Review',
  ZO_APPROVED: 'ZO Approved',
  UNDER_HO_REVIEW: 'Under HO Review',
  FINAL_APPROVED: 'Final Approved',
  REJECTED_BY_ZO: 'Rejected by ZO',
  REJECTED_BY_HO: 'Rejected by HO',
  ZO_REVISION_REQUESTED: 'ZO Revision Requested',
  HO_REVISION_REQUESTED: 'HO Revision Requested'
};

const formatINR = (value) => {
  const num = Number(value) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(num);
};

const EstimateView = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  // Data States
  const [estimate, setEstimate] = useState(null);
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [revisions, setRevisions] = useState([]);
  
  // Tab control: 'items' | 'revisions'
  const [activeViewTab, setActiveViewTab] = useState('items');

  // Review & Decisions States (ZO & HO)
  const [rowDecisions, setRowDecisions] = useState({}); // item_id -> { approve_status: 'Approve'|'Not Approve', remarks: '' }
  const [runningApprovedTotal, setRunningApprovedTotal] = useState(0);

  // Revision Modal State
  const [showRevisionModal, setShowRevisionModal] = useState(false);
  const [deadlineHours, setDeadlineHours] = useState(24);
  const [revisionRemarks, setRevisionRemarks] = useState('');

  // General States
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    fetchEstimateDetails();
  }, [id]);

  const fetchEstimateDetails = async () => {
    setLoading(true);
    setError('');
    try {
      const [detailRes, revisionRes] = await Promise.all([
        authApi.get(`/estimates/${id}`),
        authApi.get(`/estimates/${id}/revisions`)
      ]);

      if (detailRes.data?.success) {
        setEstimate(detailRes.data.estimate);
        setItems(detailRes.data.items || []);
        setSummary(detailRes.data.summary);

        // Prepopulate row decisions if Under ZO Review or Under HO Review
        const initialDecisions = {};
        const isZoStage = detailRes.data.estimate.estimate_status === ESTIMATE_STATUS.UNDER_ZO_REVIEW;
        const isHoStage = detailRes.data.estimate.estimate_status === ESTIMATE_STATUS.UNDER_HO_REVIEW;
        
        detailRes.data.items.forEach(item => {
          if (isZoStage) {
            initialDecisions[item.item_id] = {
              approve_status: item.zo_office_approve || '',
              remarks: item.zo_remarks || ''
            };
          } else if (isHoStage) {
            initialDecisions[item.item_id] = {
              approve_status: item.ho_office_approve || '',
              remarks: item.ho_remarks || ''
            };
          }
        });
        setRowDecisions(initialDecisions);
        calculateRunningTotal(detailRes.data.items, initialDecisions, detailRes.data.estimate.estimate_status);
      }

      if (revisionRes.data?.success) {
        setRevisions(revisionRes.data.revisions || []);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load cost estimate details.');
    } finally {
      setLoading(false);
    }
  };

  const calculateRunningTotal = (itemsList, decisions, status) => {
    const total = itemsList.reduce((acc, item) => {
      const dec = decisions[item.item_id];
      if (status === ESTIMATE_STATUS.UNDER_ZO_REVIEW) {
        if (dec?.approve_status === 'Approve') {
          return acc + (Number(item.amount) || 0);
        }
      } else if (status === ESTIMATE_STATUS.UNDER_HO_REVIEW) {
        if (item.zo_office_approve === 'Approve' && dec?.approve_status === 'Approve') {
          return acc + (Number(item.amount) || 0);
        }
      }
      return acc;
    }, 0);
    setRunningApprovedTotal(total);
  };

  const handleDecisionChange = (itemId, field, value) => {
    const updated = {
      ...rowDecisions,
      [itemId]: {
        ...rowDecisions[itemId],
        [field]: value
      }
    };
    
    // Auto-clear remarks if toggled back to Approve
    if (field === 'approve_status' && value === 'Approve') {
      updated[itemId].remarks = '';
    }

    setRowDecisions(updated);
    calculateRunningTotal(items, updated, estimate.estimate_status);
  };

  const handleStartReview = async () => {
    setError('');
    setSuccess('');
    setSubmitting(true);
    try {
      const res = await authApi.patch(`/estimates/${id}/review`);
      if (res.data?.success) {
        setSuccess(res.data.message || 'Review stage opened.');
        fetchEstimateDetails();
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to start review.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveRowApprovals = async () => {
    setError('');
    setSuccess('');
    setSubmitting(true);

    const approvalsPayload = Object.keys(rowDecisions)
      .filter(itemId => rowDecisions[itemId].approve_status)
      .map(itemId => ({
        item_id: itemId,
        approve_status: rowDecisions[itemId].approve_status,
        remarks: rowDecisions[itemId].remarks || null
      }));

    if (approvalsPayload.length === 0) {
      setError('Please record decisions before saving approvals.');
      setSubmitting(false);
      return;
    }

    // Validation: Rejections must have remarks
    for (const app of approvalsPayload) {
      if (app.approve_status === 'Not Approve' && (!app.remarks || app.remarks.trim() === '')) {
        setError('Remarks are mandatory for all unapproved items.');
        setSubmitting(false);
        return;
      }
    }

    try {
      const res = await authApi.post(`/estimates/${id}/row-approvals`, {
        approvals: approvalsPayload
      });
      if (res.data?.success) {
        setSuccess('Row approvals updated successfully.');
        fetchEstimateDetails();
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save row decisions.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitReview = async () => {
    setError('');
    setSuccess('');

    // Ensure decisions are recorded for all rows
    const undecided = items.some(item => !rowDecisions[item.item_id]?.approve_status);
    if (undecided) {
      setError('Decisions must be recorded for all rows before finalizing the review.');
      return;
    }

    // Rejections must have remarks
    for (const item of items) {
      const dec = rowDecisions[item.item_id];
      if (dec.approve_status === 'Not Approve' && (!dec.remarks || dec.remarks.trim() === '')) {
        setError(`Please enter rejection comments for item: ${item.material_details}`);
        return;
      }
    }

    if (!window.confirm('Finalize your review submission? This status transition is transactional and permanent.')) return;

    setSubmitting(true);
    try {
      // 1. Submit Row Decisions first to ensure DB matches state
      const approvalsPayload = items.map(item => ({
        item_id: item.item_id,
        approve_status: rowDecisions[item.item_id].approve_status,
        remarks: rowDecisions[item.item_id].remarks || null
      }));
      await authApi.post(`/estimates/${id}/row-approvals`, { approvals: approvalsPayload });

      // 2. Submit Final Review
      const remarks = prompt('Enter review summary comments (optional):') || '';
      const res = await authApi.post(`/estimates/${id}/submit-review`, { remarks });
      if (res.data?.success) {
        setSuccess('Review finalized successfully.');
        fetchEstimateDetails();
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to submit review.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestRevision = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    
    // Validation: Ensure there is at least one Not Approve row
    const hasRejections = Object.values(rowDecisions).some(dec => dec.approve_status === 'Not Approve');
    if (!hasRejections) {
      setError('At least one row must be marked "Not Approve" before requesting a revision.');
      setShowRevisionModal(false);
      return;
    }

    if (deadlineHours < 1 || deadlineHours > 168 || !Number.isInteger(deadlineHours)) {
      setError('Deadline must be an integer between 1 and 168 hours.');
      return;
    }

    setSubmitting(true);
    try {
      // 1. Save Row Decisions first
      const approvalsPayload = Object.keys(rowDecisions)
        .filter(itemId => rowDecisions[itemId].approve_status)
        .map(itemId => ({
          item_id: itemId,
          approve_status: rowDecisions[itemId].approve_status,
          remarks: rowDecisions[itemId].remarks || null
        }));
      await authApi.post(`/estimates/${id}/row-approvals`, { approvals: approvalsPayload });

      // 2. Request Revision
      const res = await authApi.post(`/estimates/${id}/request-revision`, {
        deadline_hours: deadlineHours
      });

      if (res.data?.success) {
        setSuccess('Revision cycle initiated successfully.');
        setShowRevisionModal(false);
        fetchEstimateDetails();
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to request revision.');
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleString('en-IN');
  };

  if (loading) {
    return (
      <div className="h-screen bg-black text-slate-100 flex flex-col md:flex-row font-sans relative overflow-hidden">
        <BackgroundShapes />
        <Sidebar />
        <MobileHeader />
        <main className="flex-grow flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500" />
        </main>
      </div>
    );
  }

  if (!estimate) {
    return (
      <div className="h-screen bg-black text-slate-100 flex flex-col md:flex-row font-sans relative overflow-hidden">
        <BackgroundShapes />
        <Sidebar />
        <MobileHeader />
        <main className="flex-grow flex items-center justify-center text-xs uppercase font-extrabold tracking-widest text-slate-400">
          Estimate details not found.
        </main>
      </div>
    );
  }

  const isJE = user?.role === 'je' || user?.role === 'staff';
  const isZO = user?.role === 'zo';
  const isHO = user?.role === 'ho';
  const isAdmin = user?.role === 'admin';

  // State checking
  const canStartZOReview = (isZO || isAdmin) && estimate.estimate_status === ESTIMATE_STATUS.SUBMITTED;
  const canStartHOReview = (isHO || isAdmin) && estimate.estimate_status === ESTIMATE_STATUS.ZO_APPROVED;
  
  const isCurrentlyInZOReview = estimate.estimate_status === ESTIMATE_STATUS.UNDER_ZO_REVIEW;
  const isCurrentlyInHOReview = estimate.estimate_status === ESTIMATE_STATUS.UNDER_HO_REVIEW;
  
  const showReviewPanel = (isZO || isAdmin) && isCurrentlyInZOReview || (isHO || isAdmin) && isCurrentlyInHOReview;
  const canEditEstimate = isJE && [ESTIMATE_STATUS.DRAFT, ESTIMATE_STATUS.ZO_REVISION_REQUESTED, ESTIMATE_STATUS.HO_REVISION_REQUESTED].includes(estimate.estimate_status);

  return (
    <div className="h-screen bg-black text-slate-100 flex flex-col md:flex-row font-sans relative overflow-hidden">
      <BackgroundShapes />
      <Sidebar />
      <MobileHeader />

      <main className="flex-grow p-6 md:p-10 overflow-y-auto max-w-7xl mx-auto w-full relative z-10">
        
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-8 pb-6 border-b border-white/5">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">Workflow Status: {estimate.estimate_status}</span>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Estimate Detail Console</h1>
            <p className="text-xs text-slate-400 font-medium mt-1.5">Detailed estimate sheets auditing, approvals logs, and revision control cycles.</p>
          </div>
          <div className="flex gap-3">
            {canEditEstimate && (
              <Link
                to={`/estimates/${id}/edit`}
                className="bg-white hover:bg-slate-100 text-slate-950 px-5 py-3 rounded-xl text-xs font-bold uppercase tracking-wider shadow-lg hover:shadow-xl transition-all duration-300"
              >
                Edit Draft Items
              </Link>
            )}
            {canStartZOReview && (
              <button
                onClick={handleStartZOReview}
                className="bg-amber-500 hover:bg-amber-600 text-slate-950 px-5 py-3 rounded-xl text-xs font-bold uppercase tracking-wider shadow-lg transition"
              >
                Start ZO Review
              </button>
            )}
            {canStartHOReview && (
              <button
                onClick={handleStartZOReview} // Maps to the same controller endpoint
                className="bg-indigo-500 hover:bg-indigo-600 text-slate-100 px-5 py-3 rounded-xl text-xs font-bold uppercase tracking-wider shadow-lg transition"
              >
                Start HO Review
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 mb-6">
            {error}
          </div>
        )}

        {success && (
          <div className="p-4 bg-emerald-950/20 border border-emerald-900/30 rounded-2xl text-xs text-emerald-300 mb-6">
            {success}
          </div>
        )}

        {/* Info Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
          {/* Header Metadata */}
          <div className="glass-panel p-6 rounded-3xl border border-white/5 lg:col-span-2 space-y-4">
            <h3 className="text-xs uppercase font-extrabold tracking-widest text-slate-400 mb-2">Estimate Header Metadata</h3>
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-slate-500 block mb-0.5">Work Order / Estimate No</span>
                <span className="font-mono font-bold text-slate-200">{estimate.work_order_no} / {estimate.estimate_no}</span>
              </div>
              <div>
                <span className="text-slate-500 block mb-0.5">Zonal Office No</span>
                <span className="font-mono font-bold text-slate-200">{estimate.zonal_office_no}</span>
              </div>
              <div>
                <span className="text-slate-500 block mb-0.5">State & District</span>
                <span className="text-slate-200">{estimate.projects_master?.state} / {estimate.projects_master?.district}</span>
              </div>
              <div>
                <span className="text-slate-500 block mb-0.5">Area Code & Department</span>
                <span className="text-slate-200">{estimate.projects_master?.zone} / {estimate.projects_master?.department}</span>
              </div>
              <div className="col-span-2 border-t border-white/5 pt-2">
                <span className="text-slate-500 block mb-0.5">Site details</span>
                <span className="text-slate-300">{estimate.projects_master?.site_details}</span>
              </div>
              {estimate.je_remarks && (
                <div className="col-span-2 border-t border-white/5 pt-2">
                  <span className="text-slate-500 block mb-0.5">JE Submission Comments</span>
                  <span className="text-slate-300 italic">"{estimate.je_remarks}"</span>
                </div>
              )}
            </div>
          </div>

          {/* Audit & Workflow Status */}
          <div className="glass-panel p-6 rounded-3xl border border-white/5 space-y-4">
            <h3 className="text-xs uppercase font-extrabold tracking-widest text-slate-400 mb-2">Auditing Trail Overview</h3>
            <div className="space-y-3.5 text-[11px]">
              <div className="flex justify-between items-center pb-2 border-b border-white/5">
                <span className="text-slate-500">Submitted by JE</span>
                <span className="text-slate-300 font-semibold">{estimate.je_name || 'N/A'}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-white/5">
                <span className="text-slate-500">ZO Approved By</span>
                <span className="text-slate-300 font-semibold">{estimate.zo_name || 'N/A'}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-white/5">
                <span className="text-slate-500">HO Approved By</span>
                <span className="text-slate-300 font-semibold">{estimate.ho_name || 'N/A'}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Revision Cycle</span>
                <span className="font-mono font-bold text-amber-500">R{estimate.estimate_revision}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex gap-6 mb-6 border-b border-white/5">
          <button
            onClick={() => setActiveViewTab('items')}
            className={`pb-3 text-xs font-extrabold uppercase tracking-wider border-b-2 transition-all duration-200 ${
              activeViewTab === 'items' ? 'border-amber-500 text-slate-100' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Cost Estimate Line Items ({items.length})
          </button>
          <button
            onClick={() => setActiveViewTab('revisions')}
            className={`pb-3 text-xs font-extrabold uppercase tracking-wider border-b-2 transition-all duration-200 ${
              activeViewTab === 'revisions' ? 'border-amber-500 text-slate-100' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Revision Log Cycles ({revisions.length})
          </button>
        </div>

        {activeViewTab === 'items' ? (
          <>
            {/* Table Area */}
            <div className="glass-panel rounded-3xl border border-white/5 overflow-hidden mb-6">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[1000px]">
                  <thead>
                    <tr className="border-b border-white/5 bg-white/[0.02] text-[9px] uppercase tracking-widest text-slate-400 font-mono">
                      <th className="py-4 px-6 w-36">Category</th>
                      <th className="py-4 px-6">Material Details</th>
                      <th className="py-4 px-6 w-20">Unit</th>
                      <th className="py-4 px-6 w-20 text-center">Qty</th>
                      <th className="py-4 px-6 w-24 text-right">Rate</th>
                      <th className="py-4 px-6 w-28">Ref</th>
                      <th className="py-4 px-6 w-32 text-right">Amount</th>
                      {showReviewPanel ? (
                        <>
                          <th className="py-4 px-6 w-40">Review Decision</th>
                          <th className="py-4 px-6">Remarks</th>
                        </>
                      ) : (
                        <>
                          <th className="py-4 px-6 w-28 text-center">ZO Approve</th>
                          <th className="py-4 px-6 w-28 text-center">HO Approve</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-xs text-slate-300">
                    {items.map((item) => {
                      const dec = rowDecisions[item.item_id];
                      const isRejected = dec?.approve_status === 'Not Approve';

                      return (
                        <tr key={item.item_id} className="hover:bg-white/[0.01] transition-colors duration-200">
                          <td className="py-4 px-6">
                            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-white/5 text-slate-400">
                              {item.material_main_head}
                            </span>
                          </td>
                          <td className="py-4 px-6 font-bold text-slate-200">{item.material_details}</td>
                          <td className="py-4 px-6 text-slate-400">{item.unit}</td>
                          <td className="py-4 px-6 text-center font-semibold text-slate-300">{item.qty}</td>
                          <td className="py-4 px-6 text-right font-mono">{formatINR(item.rate)}</td>
                          <td className="py-4 px-6 text-slate-400">{item.rate_reference}</td>
                          <td className="py-4 px-6 text-right font-mono font-bold text-slate-200">
                            {formatINR(item.amount)}
                          </td>
                          {showReviewPanel ? (
                            <>
                              <td className="py-3 px-4">
                                <select
                                  value={dec?.approve_status || ''}
                                  onChange={(e) => handleDecisionChange(item.item_id, 'approve_status', e.target.value)}
                                  className="w-full glass-input p-2 rounded-lg text-xs"
                                  disabled={submitting}
                                >
                                  <option value="">Decide</option>
                                  <option value="Approve">Approve</option>
                                  <option value="Not Approve">Not Approve</option>
                                </select>
                              </td>
                              <td className="py-3 px-4">
                                <input
                                  type="text"
                                  placeholder={isRejected ? 'Remarks mandatory' : 'Optional comments'}
                                  value={dec?.remarks || ''}
                                  onChange={(e) => handleDecisionChange(item.item_id, 'remarks', e.target.value)}
                                  className={`w-full glass-input p-2 rounded-lg text-xs ${
                                    isRejected && !dec?.remarks?.trim() ? 'border border-red-500/50 bg-red-950/10' : ''
                                  }`}
                                  disabled={submitting}
                                  required={isRejected}
                                />
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="py-4 px-6 text-center">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                  item.zo_office_approve === 'Approve' ? 'bg-emerald-950/40 text-emerald-400' :
                                  item.zo_office_approve === 'Not Approve' ? 'bg-red-950/40 text-red-400' : 'text-slate-500'
                                }`}>
                                  {item.zo_office_approve || 'Pending'}
                                </span>
                              </td>
                              <td className="py-4 px-6 text-center">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                  item.ho_office_approve === 'Approve' ? 'bg-emerald-950/40 text-emerald-400' :
                                  item.ho_office_approve === 'Not Approve' ? 'bg-red-950/40 text-red-400' : 'text-slate-500'
                                }`}>
                                  {item.ho_office_approve || 'Pending'}
                                </span>
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Summaries Panels */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
              <div className="glass-panel p-6 rounded-3xl border border-white/5 space-y-4">
                <span className="text-[10px] uppercase font-bold tracking-widest text-slate-500">Grand Financial Summaries</span>
                <div className="space-y-3 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Gross Total (Gross Sum)</span>
                    <span className="font-mono font-bold text-slate-200">{formatINR(summary?.gross_total)}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm font-bold border-t border-white/5 pt-3">
                    <span className="text-slate-400">Approved Grand Total (Payable Amount)</span>
                    <span className="font-mono text-lg text-emerald-400">{formatINR(summary?.approved_grand_total)}</span>
                  </div>
                </div>
              </div>

              {/* Running Total review helper */}
              {showReviewPanel && (
                <div className="glass-panel p-6 rounded-3xl border border-white/5 flex flex-col justify-between">
                  <div>
                    <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 block mb-2">Live Review Helper</span>
                    <p className="text-xs text-slate-400">Shows the dynamic, running total of all items marked Approved in this session.</p>
                  </div>
                  <div className="flex justify-between items-baseline mt-6">
                    <span className="text-xs text-slate-300 font-semibold">Approved Running Total:</span>
                    <span className="text-2xl font-mono font-extrabold text-amber-500">{formatINR(runningApprovedTotal)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Review actions */}
            {showReviewPanel && (
              <div className="flex justify-end gap-4">
                <button
                  type="button"
                  onClick={handleSaveRowApprovals}
                  className="bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10 px-6 py-3.5 rounded-xl text-xs font-bold uppercase tracking-wider transition disabled:opacity-50"
                  disabled={submitting}
                >
                  Save Row Approvals
                </button>
                <button
                  type="button"
                  onClick={() => setShowRevisionModal(true)}
                  className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 px-6 py-3.5 rounded-xl text-xs font-bold uppercase tracking-wider transition disabled:opacity-50"
                  disabled={submitting}
                >
                  Request Revision
                </button>
                <button
                  type="button"
                  onClick={handleSubmitReview}
                  className="bg-white hover:bg-slate-100 text-slate-950 px-6 py-3.5 rounded-xl text-xs font-bold uppercase tracking-wider transition disabled:opacity-50 shadow-lg"
                  disabled={submitting}
                >
                  Submit Final Review
                </button>
              </div>
            )}
          </>
        ) : (
          /* Revisions Log Tab */
          <div className="glass-panel rounded-3xl border border-white/5 overflow-hidden">
            {revisions.length === 0 ? (
              <div className="text-center p-24 text-slate-400 text-xs uppercase font-extrabold tracking-widest">
                No revision request cycles are currently recorded for this cost estimate.
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {revisions.map((rev) => (
                  <div key={rev.id} className="p-6 hover:bg-white/[0.01] transition duration-200 space-y-4">
                    <div className="flex justify-between items-center text-xs">
                      <div>
                        <span className="text-[10px] font-bold uppercase bg-amber-500/10 text-amber-500 border border-amber-500/20 px-2 py-0.5 rounded-lg mr-3">
                          Cycle {rev.revision_cycle}
                        </span>
                        <span className="text-slate-400 font-mono">Stage: {rev.stage}</span>
                      </div>
                      <span className="text-[11px] text-slate-400">Created: {formatDate(rev.created_at)}</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[11px]">
                      <div>
                        <span className="text-slate-500 block">Requested By</span>
                        <span className="text-slate-300 font-semibold">{rev.requested_by_name || rev.requested_by}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Resubmitted By</span>
                        <span className="text-slate-300 font-semibold">
                          {rev.resubmitted_by_name === 'Auto-resubmitted by system' ? (
                            <span className="text-red-400 font-bold italic">Auto-resubmitted by system</span>
                          ) : (
                            rev.resubmitted_by_name || 'Awaiting Resubmission'
                          )}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Revision Deadline</span>
                        <span className="text-slate-300 font-mono">{formatDate(rev.revision_deadline)}</span>
                      </div>
                      {rev.resubmitted_at && (
                        <div>
                          <span className="text-slate-500 block">Resubmitted At</span>
                          <span className="text-slate-300 font-mono">{formatDate(rev.resubmitted_at)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── REQUEST REVISION MODAL ── */}
        {showRevisionModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 transition-all duration-300">
            <div className="glass-panel p-6 rounded-3xl max-w-md w-full shadow-[0_25px_60px_rgba(0,0,0,0.6)] border border-white/10 relative overflow-hidden">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-sm font-extrabold uppercase tracking-widest text-slate-200">Request JE Revision</h3>
                <button onClick={() => setShowRevisionModal(false)} className="text-slate-400 hover:text-slate-200 transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form onSubmit={handleRequestRevision} className="space-y-5">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5">
                    Revision Deadline duration (Hours)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="168"
                    value={deadlineHours}
                    onChange={(e) => setDeadlineHours(parseInt(e.target.value) || '')}
                    className="w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-slate-100 text-sm font-semibold transition"
                    required
                    disabled={submitting}
                  />
                  <span className="text-[10px] text-slate-500 mt-1 block">Specify integer value between 1 and 168 hours (Max 7 days). Default is 24h.</span>
                </div>

                <div className="flex gap-3 justify-end mt-8">
                  <button
                    type="button"
                    onClick={() => setShowRevisionModal(false)}
                    className="px-4 py-2 text-slate-400 hover:text-slate-200 font-extrabold text-xs uppercase tracking-wider transition"
                    disabled={submitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="bg-white hover:bg-slate-100 text-slate-950 px-5 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300 shadow-md"
                    disabled={submitting}
                  >
                    Request Revision
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default EstimateView;
