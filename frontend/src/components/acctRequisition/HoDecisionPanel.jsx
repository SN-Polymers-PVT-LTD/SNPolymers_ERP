import React from 'react';
import { Select, FormattedCurrencyInput, TextArea, Badge } from '../ui';

const ACTION_OPTIONS_CASH = [
  { value: 'Approve', label: 'Approve' },
  { value: 'PartiallyApprove', label: 'Partially Approve' },
  { value: 'Hold', label: 'Hold' },
  { value: 'Return', label: 'Return for Correction' },
  { value: 'Reject', label: 'Reject' }
];

// A Credit-type item (debit_bank_ac_type === 'Credit') can never be Approved
// or Partially Approved — the backend hard-rejects that with VAL09
// (042_credit_purchases_and_ledger.sql). Offer Credit Approved instead.
const ACTION_OPTIONS_CREDIT = [
  { value: 'CreditApprove', label: 'Credit Approved' },
  { value: 'Hold', label: 'Hold' },
  { value: 'Return', label: 'Return for Correction' },
  { value: 'Reject', label: 'Reject' }
];

/**
 * A staging form, not a submitting one — mirrors the cost-estimate HO
 * review's pattern (decisions live in the parent's local state until one
 * batch "Submit Decisions" click covers every row) instead of each row
 * firing its own request immediately. `decision`/`onDecisionChange` make
 * this a fully controlled component: every field edit is reported up to
 * AcctHoSheetView, which owns the staged decisions map and the actual
 * batch submit. `error` is the per-item failure reported back after a
 * batch submit (e.g. insufficient bank balance on just this item).
 *
 * On Hold and Rejected are both terminal on their original sheet
 * (037_terminal_hold_and_rejected.sql) — no further HO action is possible
 * here at all; re-importing the item into a new sheet
 * (import_acct_line_item_transact) is the only way forward from either, so
 * this renders nothing for them, same as any other already-decided status.
 */
const HoDecisionPanel = ({ item, decision, onDecisionChange, disabled, error }) => {
  const action = decision?.action || '';
  const hoPassAmount = decision?.ho_pass_amount ?? '';
  const hoRemarks = decision?.ho_remarks ?? '';
  const needsPassAmount = action === 'PartiallyApprove';
  const needsRemarks = ['Hold', 'Return', 'Reject'].includes(action);
  const actionOptions = item.debit_bank_ac_type === 'Credit' ? ACTION_OPTIONS_CREDIT : ACTION_OPTIONS_CASH;

  const setField = (field, value) => onDecisionChange(item.id, { ...decision, action, ho_pass_amount: hoPassAmount, ho_remarks: hoRemarks, [field]: value });

  if (item.requisition_status !== 'Pending HO Review') return null;

  return (
    <div className="flex flex-col gap-3 p-4 rounded-2xl bg-white/[0.02] border border-white/10">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Decision</span>
        {action && <Badge variant="amber">Staged</Badge>}
      </div>

      <Select
        value={action}
        disabled={disabled}
        onChange={(e) => setField('action', e.target.value)}
        options={[{ value: '', label: 'Select a decision...' }, ...actionOptions]}
      />

      {needsPassAmount && (
        <FormattedCurrencyInput
          label="Pass Amount"
          required
          disabled={disabled}
          value={hoPassAmount}
          onValueChange={(val) => setField('ho_pass_amount', val)}
        />
      )}

      <TextArea
        label={`Remarks${needsRemarks ? '' : ' (optional)'}`}
        required={needsRemarks}
        disabled={disabled}
        value={hoRemarks}
        onChange={(e) => setField('ho_remarks', e.target.value)}
        rows={2}
      />

      {error && <p className="text-[10px] font-semibold text-red-400">{error}</p>}
    </div>
  );
};

export default HoDecisionPanel;
