import React, { useState } from 'react';
import { Button, Select, FormattedCurrencyInput, TextArea, Badge } from '../ui';

const ACTION_OPTIONS = [
  { value: 'Approve', label: 'Approve' },
  { value: 'PartiallyApprove', label: 'Partially Approve' },
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
 * Reopen is deliberately NOT part of the staged-decision batch — it acts on
 * an already-Rejected (i.e. already decided) item, a distinct one-off
 * action rather than part of the current review session, so it keeps its
 * own immediate submit.
 */
const HoDecisionPanel = ({ item, decision, onDecisionChange, onReopen, canReopen, disabled, error }) => {
  const [reopenRemark, setReopenRemark] = useState('');
  const [reopenSubmitting, setReopenSubmitting] = useState(false);
  const [reopenError, setReopenError] = useState('');

  const action = decision?.action || '';
  const hoPassAmount = decision?.ho_pass_amount ?? '';
  const hoRemarks = decision?.ho_remarks ?? '';
  const needsPassAmount = action === 'PartiallyApprove';
  const needsRemarks = ['Hold', 'Return', 'Reject'].includes(action);

  const setField = (field, value) => onDecisionChange(item.id, { ...decision, action, ho_pass_amount: hoPassAmount, ho_remarks: hoRemarks, [field]: value });

  const handleReopen = async (e) => {
    e.preventDefault();
    setReopenError('');
    if (!reopenRemark.trim()) {
      setReopenError('reopen_remark is required.');
      return;
    }
    setReopenSubmitting(true);
    try {
      await onReopen({ reopen_remark: reopenRemark.trim() });
      setReopenRemark('');
    } catch (err) {
      setReopenError(err.response?.data?.message || 'Failed to reopen line item.');
    } finally {
      setReopenSubmitting(false);
    }
  };

  if (item.requisition_status === 'Rejected') {
    if (!canReopen) return null;
    return (
      <form onSubmit={handleReopen} className="flex flex-col gap-3 p-4 rounded-2xl bg-white/[0.02] border border-white/10">
        <TextArea
          label="Reopen Remark"
          required
          value={reopenRemark}
          onChange={(e) => setReopenRemark(e.target.value)}
          rows={2}
        />
        {reopenError && <p className="text-[10px] font-semibold text-red-400">{reopenError}</p>}
        <Button type="submit" variant="amber" size="sm" loading={reopenSubmitting}>Reopen</Button>
      </form>
    );
  }

  if (!['Pending HO Review', 'On Hold'].includes(item.requisition_status)) return null;

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
        options={[{ value: '', label: 'Select a decision...' }, ...ACTION_OPTIONS]}
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
