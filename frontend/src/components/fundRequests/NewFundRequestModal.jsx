import React, { useState } from 'react';
import { Modal, Input, TextArea, Button } from '../ui';

const NewFundRequestModal = ({ user, onClose, onSave }) => {
  const [form, setForm] = useState({ zo_fr_no: '', zo_fr_amount: '', zo_remarks: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.zo_fr_no.trim()) {
      setError('Fund Request Number is required.');
      return;
    }
    const amount = parseFloat(form.zo_fr_amount);
    if (isNaN(amount) || amount <= 0) {
      setError('Amount must be a positive number greater than zero.');
      return;
    }
    if (!form.zo_remarks.trim()) {
      setError('ZO Remarks are required.');
      return;
    }

    setError('');
    setSubmitting(true);
    try {
      await onSave({
        zo_fr_no: form.zo_fr_no.trim(),
        zo_fr_amount: amount,
        zo_remarks: form.zo_remarks.trim()
      });
      onClose();
    } catch (err) {
      if (err.response?.status === 409) {
        setError('Fund Request Number already exists. Please use a different number.');
      } else {
        setError(err.response?.data?.message || 'Failed to submit fund request. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const todayFormatted = new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });

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
        form="new-fund-request-form"
        loading={submitting}
        size="sm"
      >
        Submit Request
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Create Fund Request"
      subtitle="Fund Requisition Module"
      footer={footerButtons}
    >
      {error && (
        <div className="mb-4 p-3 bg-red-950/20 border border-red-900/30 rounded-xl text-xs text-red-300 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
          {error}
        </div>
      )}

      <form id="new-fund-request-form" onSubmit={handleSubmit} className="space-y-4">
        {/* Read-Only User Context */}
        <div className="grid grid-cols-3 gap-2.5 p-3.5 rounded-2xl bg-white/[0.02] border border-white/5 text-left">
          <div>
            <span className="block text-[8px] font-bold uppercase tracking-widest text-slate-500">Display Name</span>
            <span className="text-[11px] font-bold text-slate-300 truncate block mt-0.5">{user?.display_name || '—'}</span>
          </div>
          <div>
            <span className="block text-[8px] font-bold uppercase tracking-widest text-slate-500">Mobile Number</span>
            <span className="text-[11px] font-mono font-bold text-slate-300 truncate block mt-0.5">{user?.mobile_number || '—'}</span>
          </div>
          <div>
            <span className="block text-[8px] font-bold uppercase tracking-widest text-slate-500">Current Date</span>
            <span className="text-[11px] font-mono font-bold text-slate-300 truncate block mt-0.5">{todayFormatted}</span>
          </div>
        </div>

        {/* Request Number */}
        <Input
          label="Fund Request No."
          type="text"
          name="zo_fr_no"
          value={form.zo_fr_no}
          onChange={handleChange}
          placeholder="e.g. ZO/FR/2026/001"
          required
          disabled={submitting}
        />

        {/* Amount */}
        <Input
          label="Requested Amount (₹)"
          type="number"
          name="zo_fr_amount"
          value={form.zo_fr_amount}
          onChange={handleChange}
          placeholder="0.00"
          step="0.01"
          min="0.01"
          required
          disabled={submitting}
        />

        {/* Remarks */}
        <TextArea
          label="ZO Remarks"
          name="zo_remarks"
          value={form.zo_remarks}
          onChange={handleChange}
          placeholder="Provide context or explanation for the request..."
          rows={3}
          required
          disabled={submitting}
        />
      </form>
    </Modal>
  );
};

export default NewFundRequestModal;
