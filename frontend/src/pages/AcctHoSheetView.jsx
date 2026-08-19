import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../components/AuthContext';
import { Button, Modal, SkeletonPage, Badge, Table, TableHeader, TableBody, TableRow, TableCell } from '../components/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import LineItemRow from '../components/acctRequisition/LineItemRow';
import HoDecisionPanel from '../components/acctRequisition/HoDecisionPanel';
import BankBalanceBanner from '../components/acctRequisition/BankBalanceBanner';

import {
  getSheetById, actOnLineItemsBatch, reopenLineItem, getBankBalances
} from '../api/acctRequisitionsApi';

// No "Actions" column — HO's rows are never editable (no Save/Add/Delete),
// so that column was always empty here, just dead space next to the Status
// column making the whole area look unbalanced.
const TABLE_HEADERS = [
  'Particulars', 'Account Sub-title', 'Beneficiary', 'Debit Bank',
  'Requested Amount', 'Payment Mode', 'Status', 'Decision'
];

const getStatusBadgeVariant = (status) => (status === 'Reviewed' ? 'emerald' : 'blue');

// Mirrors AcctRequisitionSheetView.jsx's layout (full-width header, one bank
// balance card per bank, a real <Table>) rather than squeezing the review
// table into a side column — that's what previously made it render as
// stacked form fields instead of table columns.
const AcctHoSheetView = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  // Decisions staged in local state (mirrors the cost-estimate HO review's
  // rowDecisions) — no network call until "Save Draft"/"Submit Decisions"
  // batches every staged row into one request, instead of one PATCH per row
  // per click.
  const [decisions, setDecisions] = useState({});
  const [batchErrors, setBatchErrors] = useState({});
  const [submittingDecisions, setSubmittingDecisions] = useState(false);

  const isHoUser = user?.role === 'ho' || user?.role === 'admin';
  const canReopen = user?.permissions?.['ho.requisition.reopen'] === true;

  const { data: sheetDetail, isLoading: loadingDetail } = useQuery({
    queryKey: ['acctSheet', id],
    queryFn: async () => (await getSheetById(id)).data?.sheet,
    enabled: !!id && isHoUser
  });

  const { data: bankBalances = [] } = useQuery({
    queryKey: ['acctBankBalances'],
    queryFn: async () => (await getBankBalances()).data?.bankBalances ?? [],
    staleTime: 60 * 1000,
    enabled: isHoUser
  });

  const invalidateSheet = () => {
    queryClient.invalidateQueries({ queryKey: ['acctSheets', 'submitted'] });
    queryClient.invalidateQueries({ queryKey: ['acctSheet', id] });
  };

  const handleDecisionChange = (itemId, decision) => {
    setDecisions((prev) => ({ ...prev, [itemId]: decision }));
    setBatchErrors((prev) => {
      if (!prev[itemId]) return prev;
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  };

  const handleReopen = async (itemId, data) => {
    await reopenLineItem(itemId, data);
    invalidateSheet();
    setSuccess('Line item reopened for review.');
  };

  // Same client-side checks HoDecisionPanel used to run before its own
  // per-row submit (ho_pass_amount required for PartiallyApprove, ho_remarks
  // required for Hold/Return/Reject) — done here, before the batch call,
  // because the backend validates the whole actions array as one unit: one
  // malformed staged row would 400 the entire batch rather than failing
  // just that row. Filtering invalid rows out client-side keeps everyone
  // else's valid decisions submittable.
  const handleSubmitDecisions = async () => {
    setError('');
    setSuccess('');
    const nextBatchErrors = {};
    const actions = [];

    for (const [itemId, decision] of Object.entries(decisions)) {
      if (!decision?.action) continue;
      if (decision.action === 'PartiallyApprove' && !decision.ho_pass_amount) {
        nextBatchErrors[itemId] = 'Pass amount is required for Partially Approve.';
        continue;
      }
      if (['Hold', 'Return', 'Reject'].includes(decision.action) && !decision.ho_remarks?.trim()) {
        nextBatchErrors[itemId] = 'Remarks are required for this decision.';
        continue;
      }
      actions.push({
        line_item_id: itemId,
        action: decision.action,
        ho_pass_amount: decision.action === 'PartiallyApprove' ? Number(decision.ho_pass_amount) : undefined,
        ho_remarks: decision.ho_remarks?.trim() || undefined
      });
    }

    if (actions.length === 0) {
      setBatchErrors(nextBatchErrors);
      if (Object.keys(nextBatchErrors).length === 0) {
        setError('Stage at least one decision before submitting.');
      }
      return;
    }

    setSubmittingDecisions(true);
    try {
      const res = await actOnLineItemsBatch(id, actions);
      const results = res.data?.results || [];
      const nextDecisions = { ...decisions };
      for (const r of results) {
        if (r.success) {
          delete nextDecisions[r.line_item_id];
        } else {
          nextBatchErrors[r.line_item_id] = r.error_message || 'Failed to apply this decision.';
        }
      }
      setDecisions(nextDecisions);
      setBatchErrors(nextBatchErrors);
      invalidateSheet();

      const failedCount = results.filter((r) => !r.success).length;
      if (failedCount > 0) {
        setError(`${failedCount} of ${results.length} decision(s) failed — check the errors below.`);
      } else {
        setSuccess(`${results.length} decision(s) applied.`);
      }
    } catch (err) {
      setBatchErrors(nextBatchErrors);
      setError(err.response?.data?.message || 'Failed to submit decisions.');
    } finally {
      setSubmittingDecisions(false);
    }
  };

  const renderDecision = (item) => (
    <HoDecisionPanel
      item={item}
      decision={decisions[item.id]}
      onDecisionChange={handleDecisionChange}
      onReopen={(data) => handleReopen(item.id, data)}
      canReopen={canReopen}
      disabled={submittingDecisions}
      error={batchErrors[item.id]}
    />
  );

  if (!isHoUser) {
    return <div className="p-8 text-center text-slate-400 text-sm">Access denied.</div>;
  }

  if (loadingDetail) {
    return <SkeletonPage />;
  }

  if (!sheetDetail) {
    return (
      <div className="flex-grow flex items-center justify-center p-12 text-xs uppercase font-extrabold tracking-widest text-slate-400">
        Requisition sheet not found.
      </div>
    );
  }

  const items = sheetDetail.items || [];
  const actionableItems = items.filter(i => ['Pending HO Review', 'On Hold'].includes(i.requisition_status));
  const otherItems = items.filter(i => !['Pending HO Review', 'On Hold'].includes(i.requisition_status));
  const stagedCount = Object.values(decisions).filter((d) => d?.action).length;
  // "Save Draft" persists whatever's staged so far, complete or not — useful
  // incremental progress on a large sheet. "Submit Decisions" is the same
  // underlying batch call, but only unlocks once every actionable row has a
  // decision, so it reads as the deliberate "I'm done reviewing this sheet"
  // action rather than something you could click by accident mid-review.
  const allDecided = actionableItems.length > 0 && actionableItems.every((item) => decisions[item.id]?.action);

  // Client-side-only preview: sums staged Approve/Partially Approve amounts
  // per bank, before "Submit Decisions" is clicked — never sent anywhere,
  // just lets HO see the effect of decisions still being made.
  const stagedDebitsByBank = items.reduce((acc, item) => {
    const decision = decisions[item.id];
    if (decision?.action !== 'Approve' && decision?.action !== 'PartiallyApprove') return acc;
    const amount = decision.action === 'Approve'
      ? Number(item.req_amount || 0)
      : Number(decision.ho_pass_amount || 0);
    const bank = item.debit_bank_ac_type;
    if (!bank) return acc;
    acc[bank] = (acc[bank] || 0) + amount;
    return acc;
  }, {});

  const renderTable = (rows) => (
    <div className="glass-panel rounded-3xl border border-white/5 overflow-hidden">
      <Table containerClassName="min-w-[1180px]">
        <TableHeader>
          <TableRow hover={false}>
            {TABLE_HEADERS.map((h) => (
              <TableCell key={h} isHeader align={h === 'Requested Amount' ? 'right' : 'left'}>{h}</TableCell>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(item => (
            <LineItemRow
              key={item.id}
              item={item}
              sheetStatus={sheetDetail.sheet_status}
              bankBalances={bankBalances}
              showActionsCell={false}
              renderExtraCell={renderDecision}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-8 pb-6 border-b border-white/5">
        <div>
          <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">
            HO · Accounts Requisition Review
          </span>
          <div className="flex items-center gap-3 mt-1">
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-100">{sheetDetail.sheet_number}</h1>
            <Badge variant={getStatusBadgeVariant(sheetDetail.sheet_status)} showDot={false}>{sheetDetail.sheet_status}</Badge>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="glass" size="sm" onClick={() => navigate('/acct-requisitions/ho-queue')}>
            ← Back to Queue
          </Button>
          <Button variant="glass" size="sm" onClick={() => navigate('/acct-requisitions/bank-balances')}>
            View Bank Balances
          </Button>
          {actionableItems.length > 0 && (
            <>
              <Button variant="glass" size="sm" onClick={handleSubmitDecisions} loading={submittingDecisions} disabled={stagedCount === 0}>
                Save Draft{stagedCount > 0 ? ` (${stagedCount})` : ''}
              </Button>
              <Button
                variant="amber"
                onClick={handleSubmitDecisions}
                loading={submittingDecisions}
                disabled={!allDecided}
                title={!allDecided ? 'Stage a decision for every row before finishing review' : undefined}
              >
                Submit Decisions
              </Button>
            </>
          )}
        </div>
      </div>

      {bankBalances.length > 0 && (
        <div className="flex flex-wrap gap-4 mb-6">
          {bankBalances.map((bank) => (
            <BankBalanceBanner
              key={bank.bank_name}
              bankBalance={bank}
              lineItems={items}
              stagedDebit={stagedDebitsByBank[bank.bank_name] || 0}
            />
          ))}
        </div>
      )}

      {actionableItems.length === 0 && otherItems.length === 0 ? (
        <p className="text-xs text-slate-500 text-center p-12 glass-panel rounded-3xl border border-white/5">No line items on this sheet.</p>
      ) : (
        <>
          {actionableItems.length > 0 && renderTable(actionableItems)}

          {otherItems.length > 0 && (
            <div className="flex flex-col gap-2 mt-6">
              <span className="text-[10px] uppercase font-bold tracking-widest text-slate-500">
                Already Decided
              </span>
              {renderTable(otherItems)}
            </div>
          )}
        </>
      )}

      {success && (
        <Modal isOpen={true} onClose={() => setSuccess('')} title="Success" size="sm"
          footer={<Button variant="amber" onClick={() => setSuccess('')} className="w-full">Continue</Button>}>
          <p className="text-xs text-slate-300 text-center py-4">{success}</p>
        </Modal>
      )}

      {error && (
        <Modal isOpen={true} onClose={() => setError('')} title="Action Blocked" size="sm"
          footer={<Button variant="primary" onClick={() => setError('')} className="w-full">Understood</Button>}>
          <p className="text-xs text-slate-300 text-center py-4">{error}</p>
        </Modal>
      )}
    </>
  );
};

export default AcctHoSheetView;
