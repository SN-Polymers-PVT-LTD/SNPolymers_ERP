import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Badge,
  Button,
  Input,
  Modal,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
  TextArea
} from '../components/ui';
import {
  getSubcontractEstimate,
  reviewSubcontractEstimateRows,
  transitionSubcontractEstimateWorkflow
} from '../api/subcontractEstimatesApi';
import { useAuth } from '../components/AuthContext';
import { exportSubcontractEstimateToExcel } from '../utils/subcontractEstimateExport';

const money = (value) =>
  `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatDate = (dateStr) => {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('en-IN');
};

const decisionOptions = [
  { value: '', label: 'Pending Review' },
  { value: 'Approve', label: 'Approve' },
  { value: 'Not Approve', label: 'Not Approve' }
];

const actionLabel = (action) =>
  ({
    ZO_REQUEST_REVISION: 'Request ZO Revision',
    ZO_REJECT: 'Reject Estimate',
    HO_REQUEST_REVISION: 'Request HO Revision',
    HO_REJECT: 'Reject Estimate',
    REOPEN: 'Reopen Estimate'
  }[action] || 'Confirm Workflow Action');

const getStatusBadgeVariant = (status) => {
  switch (status) {
    case 'Draft':
      return 'slate';
    case 'Submitted':
      return 'sky';
    case 'Under ZO Review':
      return 'indigo';
    case 'ZO Approved':
      return 'teal';
    case 'Rejected by ZO':
      return 'red';
    case 'Under HO Review':
      return 'purple';
    case 'Final Approved':
      return 'emerald';
    case 'Rejected by HO':
      return 'rose';
    case 'ZO Revision Requested':
      return 'amber';
    case 'HO Revision Requested':
      return 'orange';
    case 'Estimate Reopened':
      return 'amber';
    default:
      return 'slate';
  }
};

const SubcontractEstimateView = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  // Tab State: 'current' (Current Working Estimate) | 'history' (History & Audit Log)
  const [activeTab, setActiveTab] = useState('current');
  const [userSelectedTab, setUserSelectedTab] = useState(false);

  // Stage-aware row filter: 'all' | 'Approve' | 'Not Approve' | 'Pending'
  const [rowFilter, setRowFilter] = useState('all');

  // Core estimate & decision states
  const [estimate, setEstimate] = useState(null);
  const [decisions, setDecisions] = useState({});
  const [remarks, setRemarks] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Workflow Dialog State (Header-level transition remarks)
  const [remarkDialog, setRemarkDialog] = useState({ action: null, value: '' });

  // Line Remarks Modal State (For entering row rejection remarks without cramping table)
  const [remarksModalData, setRemarksModalData] = useState(null); // { lineId, stage, remarks, lineLabel }

  // Expandable dropdown states for History & Audit Log tab (default hidden/collapsed)
  const [isRevisionCyclesOpen, setIsRevisionCyclesOpen] = useState(false);
  const [isWorkflowHistoryOpen, setIsWorkflowHistoryOpen] = useState(false);

  const load = useCallback(() => {
    return getSubcontractEstimate(id)
      .then((response) => {
        const next = response.data.estimate;
        setEstimate(next);
        const current = next.project_subcontract_estimate_lines || [];
        const reviewStage =
          next.estimate_status === 'Under ZO Review'
            ? 'ZO'
            : next.estimate_status === 'Under HO Review'
            ? 'HO'
            : null;

        setDecisions(
          Object.fromEntries(
            current.map((line) => [
              line.line_id,
              reviewStage === 'HO'
                ? line.ho_office_approve || ''
                : line.zo_office_approve || ''
            ])
          )
        );

        setRemarks(
          Object.fromEntries(
            current.map((line) => [
              line.line_id,
              reviewStage === 'HO'
                ? line.ho_remarks || ''
                : line.zo_remarks || ''
            ])
          )
        );
      })
      .catch((e) => setError(e.response?.data?.message || 'Failed to load subcontract estimate.'));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const lines = useMemo(() => estimate?.project_subcontract_estimate_lines || [], [estimate]);
  const historicalLines = useMemo(
    () => lines.filter((line) => line.final_approved_revision != null),
    [lines]
  );
  const currentLines = useMemo(
    () => lines.filter((line) => line.final_approved_revision == null),
    [lines]
  );

  // Automatically default to History tab when there are no working lines and approved contributions exist
  useEffect(() => {
    if (!userSelectedTab && estimate) {
      const allLines = estimate.project_subcontract_estimate_lines || [];
      const hasWorkingLines = allLines.some((line) => line.final_approved_revision == null);
      const hasApprovedLines = allLines.some((line) => line.final_approved_revision != null);

      if (!hasWorkingLines && hasApprovedLines) {
        setActiveTab('history');
      }
    }
  }, [estimate, userSelectedTab]);
  const workflowLog = useMemo(
    () =>
      [...(estimate?.project_subcontract_estimate_workflow_log || [])].sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at)
      ),
    [estimate]
  );
  const revisionLog = useMemo(
    () =>
      [...(estimate?.subcontract_estimate_revision_log || [])].sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at)
      ),
    [estimate]
  );
  const latestRevision = useMemo(() => revisionLog[0] || null, [revisionLog]);

  const stage =
    estimate?.estimate_status === 'Under ZO Review'
      ? 'ZO'
      : estimate?.estimate_status === 'Under HO Review'
      ? 'HO'
      : null;

  const canReview =
    stage &&
    ((stage === 'ZO' && ['zo', 'admin'].includes(user?.role)) ||
      (stage === 'HO' && ['ho', 'admin'].includes(user?.role)));

  const canEdit =
    ['je', 'admin'].includes(user?.role) &&
    ['Draft', 'ZO Revision Requested', 'HO Revision Requested', 'Estimate Reopened'].includes(
      estimate?.estimate_status
    );

  const isReopened = estimate?.estimate_status === 'Estimate Reopened';
  const isRevisionRequested = ['ZO Revision Requested', 'HO Revision Requested'].includes(
    estimate?.estimate_status
  );

  const canReopen =
    ['Final Approved', 'Rejected by ZO', 'Rejected by HO'].includes(estimate?.estimate_status) &&
    ['zo', 'admin'].includes(user?.role) &&
    historicalLines.length > 0;

  const currentDelta = currentLines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
  const historicalTotal = historicalLines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
  const projectedAmount = Number(estimate?.estimate_amount || 0);

  const exportEstimate = async () => {
    setExporting(true);
    setError('');
    try {
      await exportSubcontractEstimateToExcel(estimate);
    } catch (e) {
      setError(e.message || 'Failed to export subcontract estimate.');
    } finally {
      setExporting(false);
    }
  };

  // Check missing decision remarks for unapproved rows in active review
  const missingDecisionRemarks = currentLines.some(
    (line) => decisions[line.line_id] === 'Not Approve' && !remarks[line.line_id]?.trim()
  );

  // Stage-aware row filtering logic (Correction #2)
  // In ZO review, filter by ZO decision. In HO review, filter by HO decision.
  // In JE revision mode, prioritize the rejecting stage's decision.
  const activeFilteringStage = useMemo(() => {
    if (stage) return stage;
    if (estimate?.estimate_status === 'HO Revision Requested') return 'HO';
    return 'ZO';
  }, [stage, estimate?.estimate_status]);

  const filteredCurrentLines = useMemo(() => {
    if (rowFilter === 'all') return currentLines;
    return currentLines.filter((line) => {
      // Keep row being modal-edited visible
      if (remarksModalData?.lineId === line.line_id) {
        return true;
      }

      const savedDecision =
        activeFilteringStage === 'HO' ? line.ho_office_approve : line.zo_office_approve;
      const liveDecision = decisions[line.line_id];

      if (rowFilter === 'Pending') {
        if (canReview) {
          // If a row was pending on the server, keep it visible during this review session
          // so decisions and remarks can be entered without the row vanishing under the cursor
          return !savedDecision || !liveDecision;
        }
        return !savedDecision;
      }

      if (rowFilter === 'Approve') {
        if (canReview) {
          return liveDecision === 'Approve' || (!liveDecision && savedDecision === 'Approve');
        }
        return savedDecision === 'Approve';
      }

      if (rowFilter === 'Not Approve') {
        if (canReview) {
          return liveDecision === 'Not Approve' || (!liveDecision && savedDecision === 'Not Approve');
        }
        return savedDecision === 'Not Approve';
      }

      return true;
    });
  }, [currentLines, rowFilter, activeFilteringStage, canReview, decisions, remarksModalData?.lineId]);

  // Handle row decision change
  const handleDecisionChange = (lineId, value) => {
    setDecisions((prev) => ({ ...prev, [lineId]: value }));
    // Auto-clear rejection remarks if toggled to Approve or blank
    if (value !== 'Not Approve') {
      setRemarks((prev) => ({ ...prev, [lineId]: '' }));
    }
  };

  // Open line remarks modal
  const openRemarksModal = (lineId, reviewStage, currentRemark, line) => {
    const subName = line.subcontractor?.subcontractor_name || 'Subcontractor';
    const workName = line.subcontract_work?.material_details || 'Work';
    setRemarksModalData({
      lineId,
      stage: reviewStage,
      remarks: currentRemark || '',
      lineLabel: `${subName} · ${workName}`
    });
  };

  // Save line remarks from modal
  const saveRemarksModal = () => {
    if (remarksModalData) {
      setRemarks((prev) => ({
        ...prev,
        [remarksModalData.lineId]: remarksModalData.remarks.trim()
      }));
      setRemarksModalData(null);
    }
  };

  // Execute workflow action
  const executeWorkflow = async (action, actionRemarks = null) => {
    setSaving(true);
    setError('');
    try {
      let currentEstimate = estimate;

      // Persist unsaved decisions before every review-stage transition. Header
      // approval therefore validates the same persisted state the reviewer
      // sees, and uses the returned optimistic-concurrency version.
      if (canReview && [
        'ZO_APPROVE', 'ZO_REQUEST_REVISION', 'ZO_REJECT',
        'HO_APPROVE', 'HO_REQUEST_REVISION', 'HO_REJECT'
      ].includes(action)) {
        const approvals = changedReviewApprovals();

        if (approvals.length > 0) {
          const reviewResponse = await reviewSubcontractEstimateRows(id, {
            stage,
            approvals,
            expected_updated_at: currentEstimate.updated_at
          });
          currentEstimate = reviewResponse.data.estimate;
        }
      }

      const response = await transitionSubcontractEstimateWorkflow(id, {
        action,
        remarks: actionRemarks,
        expected_updated_at: currentEstimate.updated_at
      });
      setEstimate(response.data.estimate);
      setRemarkDialog({ action: null, value: '' });
      await load();
    } catch (e) {
      if (e.response?.status === 409) {
        await load();
        setError('This estimate changed in another session. The latest server version is loaded. Review it before retrying.');
      } else {
        setError(e.response?.data?.message || 'Workflow action failed.');
      }
    } finally {
      setSaving(false);
    }
  };

  const workflow = (action) => {
    if (['ZO_REQUEST_REVISION', 'ZO_REJECT', 'HO_REQUEST_REVISION', 'HO_REJECT', 'REOPEN'].includes(action)) {
      if (canReview && missingDecisionRemarks) {
        setError('Please provide remarks for each line marked Not Approve before requesting revision.');
        return;
      }
      setRemarkDialog({ action, value: '' });
      return;
    }
    executeWorkflow(action);
  };

  const hasAnyDecision = useMemo(
    () => currentLines.some((line) => decisions[line.line_id]),
    [currentLines, decisions]
  );

  const changedReviewApprovals = () =>
    currentLines.flatMap((line) => {
      const decision = decisions[line.line_id];
      const lineDecision = stage === 'HO' ? line.ho_office_approve : line.zo_office_approve;
      const lineRemarks = stage === 'HO' ? line.ho_remarks : line.zo_remarks;
      const nextRemarks = remarks[line.line_id] || null;
      const savedRemarks = lineRemarks || null;

      if (!decision || (decision === lineDecision && nextRemarks === savedRemarks)) return [];
      return [{
        line_id: line.line_id,
        approve_status: decision,
        remarks: nextRemarks
      }];
    });

  const saveDecisions = async () => {
    if (missingDecisionRemarks) {
      setError('Please provide remarks for each line marked Not Approve before saving decisions.');
      return;
    }

    const approvals = changedReviewApprovals();

    if (approvals.length === 0) {
      setError('Please select a decision for at least one row before saving.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const response = await reviewSubcontractEstimateRows(id, {
        stage,
        approvals,
        expected_updated_at: estimate.updated_at
      });
      setEstimate(response.data.estimate);
    } catch (e) {
      if (e.response?.status === 409) {
        await load();
        setError('These decisions were based on an older estimate version. The latest server version is loaded.');
      } else {
        setError(e.response?.data?.message || 'Failed to save row decisions.');
      }
    } finally {
      setSaving(false);
    }
  };

  if (error && !estimate) {
    return <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-300">{error}</div>;
  }

  if (!estimate) {
    return <div className="p-8 text-sm text-slate-400">Loading subcontract estimate…</div>;
  }

  return (
    <div className="subcontract-estimate-view space-y-6">
      {/* ── HEADER TOOLBAR ── */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/5 pb-5">
        <div>
          <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">
            Projects Module
          </span>
          <h1 className="text-3xl font-extrabold text-slate-100 mt-1">Subcontract Estimate</h1>
          <p className="mt-1 text-xs text-slate-400 font-medium">
            Stage-aware review controls, immutable audit provenance, and approval retention.
          </p>
        </div>

        {/* Action Toolbar */}
        <div className="estimate-action-toolbar flex flex-wrap items-center gap-2">
          <Button variant="success" size="sm" onClick={exportEstimate} loading={exporting}>
            Export Excel
          </Button>
          {canEdit && (
            <Button onClick={() => navigate(`/subcontract-estimates/${id}/edit`)}>
              {isReopened ? 'Edit Revision' : 'Edit Draft'}
            </Button>
          )}

          {/* Submission Triggers */}
          {estimate.estimate_status === 'Draft' && ['je', 'admin'].includes(user?.role) && (
            <Button variant="secondary" disabled={saving} onClick={() => workflow('SUBMIT')}>
              Submit
            </Button>
          )}
          {isRevisionRequested && ['je', 'admin'].includes(user?.role) && (
            <Button variant="secondary" disabled={saving} onClick={() => workflow('RESUBMIT')}>
              Resubmit
            </Button>
          )}
          {isReopened && ['je', 'admin'].includes(user?.role) && (
            <Button variant="secondary" disabled={saving} onClick={() => workflow('SUBMIT_REOPENED')}>
              Submit Revision
            </Button>
          )}

          {/* Review Intake */}
          {estimate.estimate_status === 'Submitted' && ['zo', 'admin'].includes(user?.role) && (
            <Button variant="secondary" disabled={saving} onClick={() => workflow('OPEN_ZO_REVIEW')}>
              Open ZO Review
            </Button>
          )}
          {estimate.estimate_status === 'ZO Approved' && ['ho', 'admin'].includes(user?.role) && (
            <Button variant="secondary" disabled={saving} onClick={() => workflow('OPEN_HO_REVIEW')}>
              Open HO Review
            </Button>
          )}

          {/* Review Actions */}
          {canReview && (
            <Button
              disabled={saving || !currentLines.length || !hasAnyDecision || missingDecisionRemarks}
              onClick={saveDecisions}
            >
              Save Row Decisions
            </Button>
          )}

          {stage === 'ZO' && canReview && (
            <>
              <Button
                variant="secondary"
                disabled={saving || !currentLines.length || currentLines.some((line) => decisions[line.line_id] !== 'Approve')}
                onClick={() => workflow('ZO_APPROVE')}
              >
                Approve Header
              </Button>
              <Button variant="ghost" disabled={saving} onClick={() => workflow('ZO_REQUEST_REVISION')}>
                Request Revision
              </Button>
              <Button variant="ghost" disabled={saving} onClick={() => workflow('ZO_REJECT')}>
                Reject
              </Button>
            </>
          )}

          {stage === 'HO' && canReview && (
            <>
              <Button
                variant="secondary"
                disabled={saving || !currentLines.length || currentLines.some((line) => decisions[line.line_id] !== 'Approve')}
                onClick={() => workflow('HO_APPROVE')}
              >
                Final Approve
              </Button>
              <Button variant="ghost" disabled={saving} onClick={() => workflow('HO_REQUEST_REVISION')}>
                Request Revision
              </Button>
              <Button variant="ghost" disabled={saving} onClick={() => workflow('HO_REJECT')}>
                Reject
              </Button>
            </>
          )}

          {canReopen && (
            <Button variant="secondary" size="sm" disabled={saving} onClick={() => workflow('REOPEN')}>
              Reopen
            </Button>
          )}
        </div>
      </div>

      {error && <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>}

      {/* ── KEY FINANCIAL METRICS BAR ── */}
      <div className="estimate-glass-panel grid grid-cols-2 gap-4 rounded-2xl border border-white/5 bg-white/[0.02] p-5 md:grid-cols-4">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">Work Order</span>
          <div className="font-mono text-white text-sm font-semibold mt-0.5">{estimate.work_order_no}</div>
        </div>
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">Workflow Status</span>
          <div className="mt-0.5">
            <Badge variant={getStatusBadgeVariant(estimate.estimate_status)}>
              {estimate.estimate_status}
            </Badge>
          </div>
        </div>
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">Revision</span>
          <div className="text-white text-sm font-mono font-semibold mt-0.5">{estimate.estimate_revision}</div>
        </div>
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">Projected Total</span>
          <div className="font-bold text-amber-300 text-sm font-mono mt-0.5">{money(projectedAmount)}</div>
        </div>
      </div>

      {/* ── REVISION REQUEST ALERT BANNER (Strict stage remarks, no fallback) ── */}
      {isRevisionRequested && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
              ⚠️ {estimate.estimate_status === 'ZO Revision Requested' ? 'ZO Revision Requested' : 'HO Revision Requested'}
            </span>
            {latestRevision?.revision_deadline && (
              <span className="text-xs font-mono text-amber-300/80">
                Deadline: {formatDate(latestRevision.revision_deadline)}
              </span>
            )}
          </div>

          <div className="text-sm text-slate-200">
            <span className="font-semibold text-amber-300">
              {estimate.estimate_status === 'HO Revision Requested' ? 'HO Revision Remarks: ' : 'ZO Revision Remarks: '}
            </span>
            <span>
              {estimate.estimate_status === 'HO Revision Requested'
                ? estimate.ho_remarks || 'Please review and revise the estimate lines as requested by HO.'
                : estimate.zo_remarks || 'Please review and revise the estimate lines as requested by ZO.'}
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Unapproved lines require correction. Unchanged approved lines retain their approval status upon resubmission.
          </p>
        </div>
      )}

      {/* ── REOPENED ESTIMATE DELTA SUMMARY ── */}
      {isReopened && (
        <div className="grid gap-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5 md:grid-cols-3 text-xs">
          <div>
            <span className="text-slate-500 block uppercase tracking-wider font-bold text-[10px]">Previously Approved Baseline</span>
            <div className="font-semibold text-slate-100 font-mono text-sm mt-0.5">{money(estimate.last_approved_amount)}</div>
          </div>
          <div>
            <span className="text-slate-500 block uppercase tracking-wider font-bold text-[10px]">Current Revision Delta</span>
            <div className="font-semibold text-amber-300 font-mono text-sm mt-0.5">{money(currentDelta)}</div>
          </div>
          <div>
            <span className="text-slate-500 block uppercase tracking-wider font-bold text-[10px]">Projected Effective Total</span>
            <div className="font-semibold text-emerald-300 font-mono text-sm mt-0.5">{money(projectedAmount)}</div>
          </div>
        </div>
      )}

      {/* ── TAB CONTROLLERS ── */}
      <div className="flex gap-6 border-b border-white/5">
        <button
          type="button"
          onClick={() => {
            setUserSelectedTab(true);
            setActiveTab('current');
          }}
          className={`pb-3 text-xs font-extrabold uppercase tracking-wider border-b-2 transition-all duration-200 ${
            activeTab === 'current'
              ? 'border-amber-500 text-slate-100'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Current Working Estimate ({currentLines.length})
        </button>
        <button
          type="button"
          onClick={() => {
            setUserSelectedTab(true);
            setActiveTab('history');
          }}
          className={`pb-3 text-xs font-extrabold uppercase tracking-wider border-b-2 transition-all duration-200 ${
            activeTab === 'history'
              ? 'border-amber-500 text-slate-100'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          History & Audit Log ({historicalLines.length + workflowLog.length})
        </button>
      </div>

      {/* ── TAB 1: CURRENT WORKING ESTIMATE ── */}
      {activeTab === 'current' && (
        <div className="space-y-6">
          {currentLines.length === 0 && historicalLines.length > 0 ? (
            <div className="p-8 rounded-3xl border border-emerald-500/20 bg-emerald-500/[0.04] text-center space-y-4 my-4">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto text-emerald-400 text-xl font-bold">
                ✓
              </div>
              <div className="max-w-lg mx-auto space-y-1.5">
                <h3 className="text-base font-bold text-slate-100">
                  {estimate.estimate_status === 'Final Approved'
                    ? 'This Subcontract Estimate is Final Approved'
                    : 'All Line Items Approved in Permanent Baseline'}
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  All {historicalLines.length} line items totaling{' '}
                  <strong className="text-emerald-400 font-mono">{money(historicalTotal)}</strong>{' '}
                  have been approved and stamped into the permanent accounting baseline.
                </p>
              </div>

              {/* Quick metrics */}
              <div className="grid grid-cols-2 max-w-xs mx-auto gap-3 py-2 text-xs">
                <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                  <span className="text-slate-500 block uppercase tracking-wider text-[9px] font-bold">Approved Lines</span>
                  <span className="font-mono text-white font-bold text-sm">{historicalLines.length}</span>
                </div>
                <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                  <span className="text-slate-500 block uppercase tracking-wider text-[9px] font-bold">Approved Amount</span>
                  <span className="font-mono text-emerald-400 font-bold text-sm">{money(historicalTotal)}</span>
                </div>
              </div>

              <div className="pt-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setUserSelectedTab(true);
                    setActiveTab('history');
                  }}
                  className="inline-flex items-center gap-2 font-bold"
                >
                  <span>View Final Approved Lines in History ({historicalLines.length})</span>
                  <span>→</span>
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* Stage-Aware Filter Bar */}
              <div className="flex flex-wrap items-center gap-3 p-4 rounded-2xl border border-white/5 bg-white/[0.02]">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mr-2">
              Filter by {activeFilteringStage} Decision:
            </span>
            {['all', 'Approve', 'Not Approve', 'Pending'].map((opt) => (
              <button
                key={`filter-${opt}`}
                type="button"
                onClick={() => setRowFilter(opt)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all duration-200 ${
                  rowFilter === opt
                    ? opt === 'Approve'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : opt === 'Not Approve'
                      ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                      : opt === 'Pending'
                      ? 'bg-slate-500/20 text-slate-300 border border-slate-500/30'
                      : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                    : 'bg-white/5 text-slate-500 border border-white/5 hover:border-white/10 hover:text-slate-300'
                }`}
              >
                {opt === 'all' ? 'All' : opt}
              </button>
            ))}

            {rowFilter !== 'all' && (
              <>
                <div className="w-px h-5 bg-white/10 mx-1" />
                <button
                  type="button"
                  onClick={() => setRowFilter('all')}
                  className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-white/5 border border-white/10 text-slate-400 hover:text-slate-200 hover:border-white/20 transition-all duration-200"
                >
                  ✕ Reset
                </button>
              </>
            )}

            <span className="text-[10px] text-slate-500 font-mono ml-auto">
              Showing {filteredCurrentLines.length} of {currentLines.length} lines
            </span>
          </div>

          {/* Current Working Lines Table */}
          <div className="estimate-glass-panel rounded-2xl border border-white/5 overflow-hidden bg-white/[0.01]">
            <Table containerClassName="min-w-[1250px]">
              <TableHeader>
                <TableRow hover={false}>
                  <TableCell isHeader className="w-12 text-center">#</TableCell>
                  <TableCell isHeader className="w-56">Subcontractor</TableCell>
                  <TableCell isHeader className="w-60">Subcontract Work</TableCell>
                  <TableCell isHeader className="w-16 text-center">Unit</TableCell>
                  <TableCell isHeader className="w-20 text-right">Qty</TableCell>
                  <TableCell isHeader className="w-28 text-right">Rate</TableCell>
                  <TableCell isHeader className="w-32 text-right">Amount</TableCell>
                  <TableCell isHeader className="w-28 text-center">Kind</TableCell>
                  <TableCell isHeader className="w-36 text-center border-l border-white/5">ZO Decision</TableCell>
                  <TableCell isHeader className="w-44">ZO Remarks</TableCell>
                  <TableCell isHeader className="w-36 text-center border-l border-white/5">HO Decision</TableCell>
                  <TableCell isHeader className="w-44">HO Remarks</TableCell>
                  <TableCell isHeader className="w-32 text-center">State</TableCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCurrentLines.map((line, idx) => {
                  const isZoReviewable = canReview && stage === 'ZO';
                  const isHoReviewable = canReview && stage === 'HO';
                  const isZoRejected = decisions[line.line_id] === 'Not Approve' || line.zo_office_approve === 'Not Approve';
                  const isHoRejected = decisions[line.line_id] === 'Not Approve' || line.ho_office_approve === 'Not Approve';

                  // Row protection logic matching backend rules (Correction #6)
                  // In ZO Revision Requested or Reopened: ZO-approved row is protected
                  // In HO Revision Requested: HO-approved row is protected. (An HO-rejected row is editable even if ZO approved it)
                  const isProtectedRow =
                    line.ho_office_approve === 'Approve' ||
                    ((estimate.estimate_status === 'ZO Revision Requested' || isReopened) &&
                      line.zo_office_approve === 'Approve');

                  return (
                    <TableRow key={line.line_id}>
                      <TableCell className="text-center font-mono text-slate-500 text-xs">
                        {idx + 1}
                      </TableCell>

                      <TableCell>
                        <span className="font-semibold text-slate-200 block">
                          {line.subcontractor?.subcontractor_name || 'Subcontractor'}
                        </span>
                        {line.subcontractor?.is_active === false && (
                          <span className="inline-block text-[9px] text-amber-400 font-bold uppercase mt-0.5">
                            (Inactive Contractor)
                          </span>
                        )}
                      </TableCell>

                      <TableCell>
                        <span className="font-medium text-slate-300 block">
                          {line.subcontract_work?.material_details || 'Work Scope'}
                        </span>
                        {line.subcontract_work?.is_active === false && (
                          <span className="inline-block text-[9px] text-amber-400 font-bold uppercase mt-0.5">
                            (Inactive Work)
                          </span>
                        )}
                      </TableCell>

                      <TableCell className="text-center font-mono text-slate-400 text-xs">
                        {line.subcontract_work?.unit || '—'}
                      </TableCell>

                      <TableCell className="text-right font-mono font-bold text-slate-300 text-xs">
                        {line.qty}
                      </TableCell>

                      <TableCell className="text-right font-mono text-slate-300 text-xs">
                        {money(line.rate)}
                      </TableCell>

                      <TableCell className="text-right font-mono font-bold text-slate-200 text-xs">
                        {money(line.amount)}
                      </TableCell>

                      <TableCell className="text-center">
                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-white/5 text-slate-400">
                          {line.entry_kind}
                        </span>
                        {line.adjusts_line_id && (
                          <div className="text-[9px] text-amber-400/80 mt-0.5 font-mono">
                            adjusts line
                          </div>
                        )}
                      </TableCell>

                      {/* ── ZO DECISION COLUMN ── */}
                      <TableCell className="border-l border-white/5 text-center">
                        {isZoReviewable ? (
                          <Select
                            size="sm"
                            value={decisions[line.line_id] || ''}
                            onChange={(e) => handleDecisionChange(line.line_id, e.target.value)}
                            options={decisionOptions}
                          />
                        ) : line.zo_office_approve ? (
                          <Badge variant={line.zo_office_approve === 'Approve' ? 'emerald' : 'rose'}>
                            {line.zo_office_approve}
                          </Badge>
                        ) : (
                          <span className="text-slate-500 font-mono text-xs">—</span>
                        )}
                      </TableCell>

                      {/* ── ZO REMARKS COLUMN (Focused Modal Interaction) ── */}
                      <TableCell>
                        {isZoReviewable ? (
                          <Input
                            size="sm"
                            readOnly
                            value={remarks[line.line_id] || ''}
                            onClick={() =>
                              openRemarksModal(line.line_id, 'ZO', remarks[line.line_id], line)
                            }
                            placeholder={decisions[line.line_id] === 'Not Approve' ? 'Click to enter required reason' : 'Optional remark'}
                            className={`cursor-pointer transition-colors text-xs truncate ${
                              decisions[line.line_id] === 'Not Approve' && !remarks[line.line_id]?.trim()
                                ? 'border-red-500/50 bg-red-950/20 text-red-300'
                                : 'hover:bg-white/10'
                            }`}
                          />
                        ) : (
                          <span className="text-slate-400 italic text-xs block truncate max-w-[170px]" title={line.zo_remarks || ''}>
                            {line.zo_remarks || '—'}
                          </span>
                        )}
                      </TableCell>

                      {/* ── HO DECISION COLUMN ── */}
                      <TableCell className="border-l border-white/5 text-center">
                        {isHoReviewable ? (
                          <Select
                            size="sm"
                            value={decisions[line.line_id] || ''}
                            onChange={(e) => handleDecisionChange(line.line_id, e.target.value)}
                            options={decisionOptions}
                          />
                        ) : line.ho_office_approve ? (
                          <Badge variant={line.ho_office_approve === 'Approve' ? 'emerald' : 'rose'}>
                            {line.ho_office_approve}
                          </Badge>
                        ) : (
                          <span className="text-slate-500 font-mono text-xs">—</span>
                        )}
                      </TableCell>

                      {/* ── HO REMARKS COLUMN (Focused Modal Interaction) ── */}
                      <TableCell>
                        {isHoReviewable ? (
                          <Input
                            size="sm"
                            readOnly
                            value={remarks[line.line_id] || ''}
                            onClick={() =>
                              openRemarksModal(line.line_id, 'HO', remarks[line.line_id], line)
                            }
                            placeholder={decisions[line.line_id] === 'Not Approve' ? 'Click to enter required reason' : 'Optional remark'}
                            className={`cursor-pointer transition-colors text-xs truncate ${
                              decisions[line.line_id] === 'Not Approve' && !remarks[line.line_id]?.trim()
                                ? 'border-red-500/50 bg-red-950/20 text-red-300'
                                : 'hover:bg-white/10'
                            }`}
                          />
                        ) : (
                          <span className="text-slate-400 italic text-xs block truncate max-w-[170px]" title={line.ho_remarks || ''}>
                            {line.ho_remarks || '—'}
                          </span>
                        )}
                      </TableCell>

                      {/* ── DERIVED AUDIT STATE (Correction #1) ── */}
                      <TableCell className="text-center">
                        {isProtectedRow ? (
                          <Badge variant="emerald">Protected</Badge>
                        ) : (isZoRejected && estimate.estimate_status === 'ZO Revision Requested') ||
                          (isHoRejected && estimate.estimate_status === 'HO Revision Requested') ? (
                          <Badge variant="rose">Revision Needed</Badge>
                        ) : line.ho_office_approve === 'Approve' ? (
                          <Badge variant="emerald">HO Approved</Badge>
                        ) : line.zo_office_approve === 'Approve' ? (
                          <Badge variant="teal">ZO Approved</Badge>
                        ) : (
                          <Badge variant="slate">Pending</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}

                {!filteredCurrentLines.length && (
                  <TableRow>
                    <TableCell colSpan={13} className="text-center py-12 text-slate-500 text-xs uppercase font-extrabold tracking-widest">
                      {rowFilter === 'all' ? 'No current working line items found.' : `No line items matching "${rowFilter}".`}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
            </>
          )}
        </div>
      )}

      {/* ── TAB 2: HISTORY & AUDIT LOG ── */}
      {activeTab === 'history' && (
        <div className="space-y-8">
          {/* Section 1: Historically Final Approved Contributions */}
          <section className="space-y-4">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-widest text-slate-200">
                Final Approved Contributions
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Historically approved contributions are immutable baselines integrated with the Subcontractor Ledger and Cost Estimate.
              </p>
            </div>

            {/* Accounting Baseline Strip */}
            <div className="estimate-glass-panel grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 rounded-xl border border-white/5 bg-white/[0.02] text-xs">
              <div>
                <span className="text-slate-500 block uppercase tracking-wider text-[10px] font-bold">Approved Baseline</span>
                <span className="font-mono text-emerald-400 font-bold text-sm mt-0.5 block">{money(historicalTotal)}</span>
              </div>
              <div>
                <span className="text-slate-500 block uppercase tracking-wider text-[10px] font-bold">Current Working Delta</span>
                <span className="font-mono text-amber-300 font-bold text-sm mt-0.5 block">{money(currentDelta)}</span>
              </div>
              <div>
                <span className="text-slate-500 block uppercase tracking-wider text-[10px] font-bold">Effective Total</span>
                <span className="font-mono text-white font-bold text-sm mt-0.5 block">{money(projectedAmount)}</span>
              </div>
            </div>

            <div className="estimate-glass-panel rounded-2xl border border-white/5 overflow-hidden bg-white/[0.01]">
              <Table containerClassName="min-w-[1000px]">
                <TableHeader>
                  <TableRow hover={false}>
                    <TableCell isHeader className="w-12 text-center">#</TableCell>
                    <TableCell isHeader>Subcontractor</TableCell>
                    <TableCell isHeader>Work</TableCell>
                    <TableCell isHeader className="w-16 text-center">Unit</TableCell>
                    <TableCell isHeader className="w-20 text-right">Qty</TableCell>
                    <TableCell isHeader className="w-28 text-right">Rate</TableCell>
                    <TableCell isHeader className="w-32 text-right">Amount</TableCell>
                    <TableCell isHeader className="w-24 text-center">Kind</TableCell>
                    <TableCell isHeader className="w-36 text-center">Approved Rev</TableCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historicalLines.map((line, idx) => (
                    <TableRow key={line.line_id}>
                      <TableCell className="text-center font-mono text-slate-500 text-xs">
                        {idx + 1}
                      </TableCell>
                      <TableCell>
                        <span className="font-semibold text-slate-200 block">
                          {line.subcontractor?.subcontractor_name || 'Historical subcontractor'}
                        </span>
                        {line.subcontractor?.is_active === false && (
                          <span className="text-[9px] text-amber-400 font-bold uppercase">(Inactive)</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="font-medium text-slate-300">
                          {line.subcontract_work?.material_details || 'Historical work'}
                        </span>
                      </TableCell>
                      <TableCell className="text-center font-mono text-slate-400 text-xs">
                        {line.subcontract_work?.unit || '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-slate-300 text-xs">
                        {line.qty}
                      </TableCell>
                      <TableCell className="text-right font-mono text-slate-300 text-xs">
                        {money(line.rate)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-slate-200 text-xs">
                        {money(line.amount)}
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-white/5 text-slate-400">
                          {line.entry_kind}
                        </span>
                        {line.adjusts_line_id && (
                          <div className="text-[9px] text-slate-500 font-mono mt-0.5">adjusts line</div>
                        )}
                      </TableCell>
                      <TableCell className="text-center font-mono text-xs text-slate-400">
                        Rev {line.final_approved_revision}
                      </TableCell>
                    </TableRow>
                  ))}

                  {!historicalLines.length && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-12 text-slate-500 text-xs uppercase font-extrabold tracking-widest">
                        No final-approved contributions yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </section>

          {/* Section 2: Revision Log Cycles */}
          {revisionLog.length > 0 && (
            <section className="space-y-4">
              <button
                type="button"
                onClick={() => setIsRevisionCyclesOpen((prev) => !prev)}
                aria-expanded={isRevisionCyclesOpen}
                aria-controls="revision-cycles-content"
                className="estimate-glass-panel w-full flex items-center justify-between p-4 rounded-2xl border border-white/5 bg-white/[0.015] hover:bg-white/[0.03] transition-colors duration-150 text-left group cursor-pointer"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-sm font-bold uppercase tracking-widest text-slate-200 group-hover:text-white transition-colors">
                      Revision Cycles ({revisionLog.length})
                    </h2>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      {isRevisionCyclesOpen ? 'Hide' : 'Show'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Timeline of revision requests, deadlines, and resubmissions.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <div className={`p-2 rounded-xl bg-white/5 text-slate-400 group-hover:text-slate-200 transition-transform duration-200 ${isRevisionCyclesOpen ? 'rotate-180' : ''}`}>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              </button>

              {isRevisionCyclesOpen && (
                <div id="revision-cycles-content" className="estimate-glass-panel divide-y divide-white/5 rounded-2xl border border-white/5 bg-white/[0.01]">
                  {revisionLog.map((rev) => (
                    <div key={rev.id} className="p-5 hover:bg-white/[0.01] transition-colors duration-150 space-y-3">
                      <div className="flex justify-between items-center text-xs">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold uppercase bg-amber-500/10 text-amber-500 border border-amber-500/20 px-2 py-0.5 rounded-lg">
                            Cycle {rev.revision_cycle}
                          </span>
                          <span className="text-slate-400 font-mono font-bold">Stage: {rev.stage}</span>
                        </div>
                        <span className="text-[11px] text-slate-400 font-mono">
                          Initiated: {formatDate(rev.created_at)}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                        <div>
                          <span className="text-[10px] uppercase font-bold text-slate-500 block">Requested By</span>
                          <span className="text-slate-300 font-mono">{rev.requested_by}</span>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase font-bold text-slate-500 block">Resubmitted By</span>
                          <span className="text-slate-300 font-mono">
                            {rev.resubmitted_by || 'Awaiting Resubmission'}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase font-bold text-slate-500 block">Revision Deadline</span>
                          <span className="text-slate-300 font-mono">{formatDate(rev.revision_deadline)}</span>
                        </div>
                        {rev.resubmitted_at && (
                          <div>
                            <span className="text-[10px] uppercase font-bold text-slate-500 block">Resubmitted At</span>
                            <span className="text-slate-300 font-mono">{formatDate(rev.resubmitted_at)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Section 3: Workflow History Audit Log */}
          <section className="space-y-4">
            <button
              type="button"
              onClick={() => setIsWorkflowHistoryOpen((prev) => !prev)}
              aria-expanded={isWorkflowHistoryOpen}
              aria-controls="workflow-history-content"
              className="estimate-glass-panel w-full flex items-center justify-between p-4 rounded-2xl border border-white/5 bg-white/[0.015] hover:bg-white/[0.03] transition-colors duration-150 text-left group cursor-pointer"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2.5">
                  <h2 className="text-sm font-bold uppercase tracking-widest text-slate-200 group-hover:text-white transition-colors">
                    Workflow History
                  </h2>
                  {workflowLog.length > 0 && (
                    <span className="text-[10px] font-bold font-mono px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-400 border border-slate-500/20">
                      {workflowLog.length} events
                    </span>
                  )}
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/5 text-slate-400 border border-white/10">
                    {isWorkflowHistoryOpen ? 'Hide' : 'Show'}
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Complete audit trail of state transitions, actors, and mandatory remarks.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <div className={`p-2 rounded-xl bg-white/5 text-slate-400 group-hover:text-slate-200 transition-transform duration-200 ${isWorkflowHistoryOpen ? 'rotate-180' : ''}`}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            </button>

            {isWorkflowHistoryOpen && (
              <div id="workflow-history-content" className="estimate-glass-panel rounded-2xl border border-white/5 overflow-hidden bg-white/[0.01]">
                <Table containerClassName="min-w-[900px]">
                  <TableHeader>
                    <TableRow hover={false}>
                      <TableCell isHeader className="w-48">When</TableCell>
                      <TableCell isHeader className="w-40">Action</TableCell>
                      <TableCell isHeader className="w-56">Transition</TableCell>
                      <TableCell isHeader className="w-48">Actor</TableCell>
                      <TableCell isHeader>Remarks</TableCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {workflowLog.map((event) => (
                      <TableRow key={event.id}>
                        <TableCell className="font-mono text-xs text-slate-400">
                          {formatDate(event.created_at)}
                        </TableCell>
                        <TableCell className="font-semibold text-xs text-slate-200">
                          {event.action}
                        </TableCell>
                        <TableCell>
                          <Badge variant="slate">
                            {event.from_status} → {event.to_status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-slate-300">
                          {event.actor_user?.display_name || event.actor} ({event.actor_role})
                        </TableCell>
                        <TableCell className="text-xs text-slate-300 italic">
                          {event.remarks || '—'}
                        </TableCell>
                      </TableRow>
                    ))}

                    {!workflowLog.length && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-slate-500 text-xs uppercase font-extrabold tracking-widest">
                          No workflow events recorded.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        </div>
      )}

      {/* ── APPROVAL INFORMATION CARDS (Cost Estimate Pattern) ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t border-white/5">
        {/* JE Card */}
        <div className="p-5 rounded-2xl border border-white/5 bg-white/[0.02] space-y-3">
          <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block border-b border-white/5 pb-2">
            JE / Estimate Preparer
          </span>
          <div>
            <span className="text-[10px] text-slate-500 block uppercase font-bold">JE User ID / Mob</span>
            <span className="font-mono text-slate-300 text-xs">{estimate.created_by || '—'}</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 block uppercase font-bold">Submission Status</span>
            <div className="mt-0.5">
              <Badge variant={getStatusBadgeVariant(estimate.estimate_status)}>
                {estimate.estimate_status}
              </Badge>
            </div>
          </div>
          {estimate.je_remarks && (
            <div>
              <span className="text-[10px] text-slate-500 block uppercase font-bold">Submission Remarks</span>
              <span className="text-slate-300 italic text-xs block mt-0.5 leading-relaxed">
                {estimate.je_remarks}
              </span>
            </div>
          )}
        </div>

        {/* ZO Card */}
        <div className="p-5 rounded-2xl border border-white/5 bg-white/[0.02] space-y-3">
          <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block border-b border-white/5 pb-2">
            ZO / Zonal Office
          </span>
          <div>
            <span className="text-[10px] text-slate-500 block uppercase font-bold">ZO Audit Status</span>
            <div className="mt-0.5">
              <Badge variant={estimate.zo_approval_date ? 'teal' : 'slate'}>
                {estimate.zo_approval_date ? 'Approved' : 'Awaiting Audit'}
              </Badge>
            </div>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 block uppercase font-bold">Audited By</span>
            <span className="text-slate-300 font-mono text-xs">{estimate.zo_approved_by || '—'}</span>
          </div>
          {estimate.zo_approval_date && (
            <div>
              <span className="text-[10px] text-slate-500 block uppercase font-bold">Approval Date</span>
              <span className="text-slate-300 font-mono text-xs">{formatDate(estimate.zo_approval_date)}</span>
            </div>
          )}
          {estimate.zo_remarks && (
            <div>
              <span className="text-[10px] text-slate-500 block uppercase font-bold">ZO Remarks</span>
              <span className="text-slate-300 italic text-xs block mt-0.5 leading-relaxed">
                {estimate.zo_remarks}
              </span>
            </div>
          )}
        </div>

        {/* HO Card */}
        <div className="p-5 rounded-2xl border border-white/5 bg-white/[0.02] space-y-3">
          <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block border-b border-white/5 pb-2">
            HO / Head Office
          </span>
          <div>
            <span className="text-[10px] text-slate-500 block uppercase font-bold">HO Audit Status</span>
            <div className="mt-0.5">
              <Badge variant={estimate.estimate_status === 'Final Approved' ? 'emerald' : 'slate'}>
                {estimate.estimate_status === 'Final Approved' ? 'Final Approved' : 'Awaiting Audit'}
              </Badge>
            </div>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 block uppercase font-bold">Audited By</span>
            <span className="text-slate-300 font-mono text-xs">{estimate.ho_approved_by || '—'}</span>
          </div>
          {estimate.ho_approval_date && (
            <div>
              <span className="text-[10px] text-slate-500 block uppercase font-bold">Approval Date</span>
              <span className="text-slate-300 font-mono text-xs">{formatDate(estimate.ho_approval_date)}</span>
            </div>
          )}
          {estimate.ho_remarks && (
            <div>
              <span className="text-[10px] text-slate-500 block uppercase font-bold">HO Remarks</span>
              <span className="text-slate-300 italic text-xs block mt-0.5 leading-relaxed">
                {estimate.ho_remarks}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── ROW REMARKS MODAL (Cost Estimate Popover Pattern) ── */}
      {remarksModalData && (
        <Modal
          title={`Review Remarks (${remarksModalData.stage})`}
          subtitle={remarksModalData.lineLabel}
          onClose={() => setRemarksModalData(null)}
          footer={
            <div className="flex justify-end gap-2 w-full">
              <Button variant="ghost" onClick={() => setRemarksModalData(null)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={saveRemarksModal}>
                Save Remarks
              </Button>
            </div>
          }
        >
          <div className="space-y-4 text-left">
            <p className="text-xs text-slate-400">
              Provide a clear reason for the review decision. Remarks are mandatory when marking a line &ldquo;Not Approve&rdquo;.
            </p>
            <TextArea
              autoFocus
              label="Line Remarks"
              rows={4}
              value={remarksModalData.remarks}
              onChange={(e) =>
                setRemarksModalData((prev) => (prev ? { ...prev, remarks: e.target.value } : null))
              }
              placeholder="Enter rejection reason or audit instruction…"
            />
          </div>
        </Modal>
      )}

      {/* ── HEADER WORKFLOW CONFIRMATION MODAL ── */}
      {remarkDialog.action && (
        <Modal
          title={actionLabel(remarkDialog.action)}
          subtitle="Mandatory remarks"
          onClose={() => !saving && setRemarkDialog({ action: null, value: '' })}
          footer={
            <>
              <Button
                variant="ghost"
                disabled={saving}
                onClick={() => setRemarkDialog({ action: null, value: '' })}
              >
                Cancel
              </Button>
              <Button
                disabled={saving || !remarkDialog.value.trim()}
                onClick={() => executeWorkflow(remarkDialog.action, remarkDialog.value.trim())}
              >
                Confirm
              </Button>
            </>
          }
        >
          <TextArea
            autoFocus
            label="Remarks"
            required
            rows={5}
            value={remarkDialog.value}
            onChange={(e) => setRemarkDialog((current) => ({ ...current, value: e.target.value }))}
            placeholder="Enter the reason for this workflow action"
            helperText="These remarks are stored in the immutable workflow history."
          />
        </Modal>
      )}
    </div>
  );
};

export default SubcontractEstimateView;
