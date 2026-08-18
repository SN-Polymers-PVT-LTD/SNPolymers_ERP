import React, { useState } from 'react';
import { Button, Select, FormattedCurrencyInput, TextArea } from '../ui';

const ACTION_OPTIONS = [
  { value: 'Approve', label: 'Approve' },
  { value: 'PartiallyApprove', label: 'Partially Approve' },
  { value: 'Hold', label: 'Hold' },
  { value: 'Return', label: 'Return for Correction' },
  { value: 'Reject', label: 'Reject' }
];

// Mirrors actOnLineItemSchema's superRefine exactly: ho_pass_amount required
// for PartiallyApprove; ho_remarks required for Return/Hold/Reject.
const HoDecisionPanel = ({ item, onAct, onReopen, canReopen, submitting }) => {
  const [action, setAction] = useState('Approve');
  const [hoPassAmount, setHoPassAmount] = useState('');
  const [hoRemarks, setHoRemarks] = useState('');
  const [reopenRemark, setReopenRemark] = useState('');
  const [error, setError] = useState('');

  const needsPassAmount = action === 'PartiallyApprove';
  const needsRemarks = ['Hold', 'Return', 'Reject'].includes(action);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (needsPassAmount && !hoPassAmount) {
      setError('ho_pass_amount is required for Partially Approve.');
      return;
    }
    if (needsRemarks && !hoRemarks.trim()) {
      setError('ho_remarks is required for this action.');
      return;
    }

    try {
      await onAct({
        action,
        ho_pass_amount: needsPassAmount ? Number(hoPassAmount) : undefined,
        ho_remarks: hoRemarks.trim() || undefined
      });
      setHoPassAmount('');
      setHoRemarks('');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to act on line item.');
    }
  };

  const handleReopen = async (e) => {
    e.preventDefault();
    setError('');
    if (!reopenRemark.trim()) {
      setError('reopen_remark is required.');
      return;
    }
    try {
      await onReopen({ reopen_remark: reopenRemark.trim() });
      setReopenRemark('');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to reopen line item.');
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
        {error && <p className="text-[10px] font-semibold text-red-400">{error}</p>}
        <Button type="submit" variant="amber" size="sm" loading={submitting}>Reopen</Button>
      </form>
    );
  }

  if (!['Pending HO Review', 'On Hold'].includes(item.requisition_status)) return null;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-4 rounded-2xl bg-white/[0.02] border border-white/10">
      <Select
        label="Action"
        value={action}
        onChange={(e) => setAction(e.target.value)}
        options={ACTION_OPTIONS}
      />

      {needsPassAmount && (
        <FormattedCurrencyInput
          label="Pass Amount"
          required
          value={hoPassAmount}
          onValueChange={setHoPassAmount}
        />
      )}

      <TextArea
        label={`Remarks${needsRemarks ? '' : ' (optional)'}`}
        required={needsRemarks}
        value={hoRemarks}
        onChange={(e) => setHoRemarks(e.target.value)}
        rows={2}
      />

      {error && <p className="text-[10px] font-semibold text-red-400">{error}</p>}

      <Button type="submit" variant="primary" size="sm" loading={submitting}>
        Submit Decision
      </Button>
    </form>
  );
};

export default HoDecisionPanel;
