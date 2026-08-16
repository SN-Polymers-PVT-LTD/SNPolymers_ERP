import React, { useState } from 'react';
import { Button, Input, Select, Badge } from '../ui';
import BeneficiaryAutofill from './BeneficiaryAutofill';
import LastHoActionTag from './LastHoActionTag';
import ReopenedBadge from './ReopenedBadge';
import INDIAN_BANKS from '../../constants/indianBanks';

const formatCurrency = (val) =>
  val != null ? `₹ ${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—';

const STATUS_VARIANTS = {
  'Pending HO Review': 'amber',
  Approved: 'emerald',
  'Partially Approved': 'emerald',
  'On Hold': 'orange',
  'Returned for Correction': 'red',
  Rejected: 'red'
};

const PAYMENT_MODES = ['Cheque', 'Bulk NEFT', 'RTGS', 'NEFT'].map(v => ({ value: v, label: v }));
const BANK_OPTIONS = INDIAN_BANKS.map(b => ({ value: b, label: b }));

const emptyDraft = (item) => ({
  account_sub_title_text: item.account_sub_title_text || '',
  particulars: item.particulars || '',
  beneficiary_ac_no: item.beneficiary_ac_no || '',
  beneficiary_name: item.beneficiary_name || '',
  beneficiary_ifsc: item.beneficiary_ifsc || '',
  beneficiary_bank_name: item.beneficiary_bank_name || '',
  debit_bank_ac_type: item.debit_bank_ac_type || '',
  req_amount: item.req_amount ?? '',
  payment_mode: item.payment_mode || '',
  cheque_no: item.cheque_no || '',
  cheque_date: item.cheque_date || ''
});

/**
 * B3 gate (§4c): editable exactly when sheetStatus === 'Open' (via onSave →
 * updateLineItem, no status change) OR item.requisition_status ===
 * 'Returned for Correction' (via onResubmit → resubmit RPC, transitions the
 * item back to 'Pending HO Review'). These two paths are mutually exclusive
 * and use different endpoints — this component only ever calls one of them
 * per render, matching the backend's split.
 */
const LineItemRow = ({
  item,
  sheetStatus,
  bankBalances = [],
  onSave,
  onResubmit,
  onDelete,
  selectable,
  selected,
  onToggleSelect
}) => {
  const openPath = sheetStatus === 'Open';
  const returnedPath = item.requisition_status === 'Returned for Correction';
  const editable = openPath || returnedPath;

  const [draft, setDraft] = useState(() => emptyDraft(item));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const bankOptions = bankBalances.map(b => ({ value: b.bank_name, label: b.bank_name }));

  const setField = (field, value) => setDraft(prev => ({ ...prev, [field]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (draft.payment_mode === 'Cheque' && (!draft.cheque_no || !draft.cheque_date)) {
      setError('cheque_no and cheque_date are required when payment_mode is Cheque.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...draft,
        req_amount: draft.req_amount === '' ? null : Number(draft.req_amount),
        payment_mode: draft.payment_mode || null,
        cheque_no: draft.payment_mode === 'Cheque' ? draft.cheque_no : null,
        cheque_date: draft.payment_mode === 'Cheque' ? draft.cheque_date : null
      };
      if (openPath) {
        await onSave(item.id, payload);
      } else {
        await onResubmit(item.id, payload);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save line item.');
    } finally {
      setSaving(false);
    }
  };

  if (!editable) {
    return (
      <div className="flex flex-col gap-2 p-4 rounded-2xl bg-white/[0.02] border border-white/10">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-slate-100">{item.beneficiary_name || item.particulars || 'Line item'}</p>
            <p className="text-xs text-slate-500">{item.debit_bank_ac_type} · {item.payment_mode}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-slate-200">{formatCurrency(item.req_amount)}</span>
            <Badge variant={STATUS_VARIANTS[item.requisition_status] || 'slate'}>
              {item.requisition_status || 'Draft'}
            </Badge>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <LastHoActionTag item={item} />
          <ReopenedBadge item={item} />
        </div>
        {selectable && (
          <label className="flex items-center gap-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            <input type="checkbox" checked={!!selected} onChange={(e) => onToggleSelect?.(item.id, e.target.checked)} />
            Select for NEFT export
          </label>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-4 rounded-2xl bg-white/[0.03] border border-amber-500/20">
      {returnedPath && (
        <div className="flex items-center gap-2">
          <Badge variant="red">Returned for Correction</Badge>
          <LastHoActionTag item={item} />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input label="Particulars" value={draft.particulars} onChange={(e) => setField('particulars', e.target.value)} />
        <Input label="Account Sub-title" value={draft.account_sub_title_text} onChange={(e) => setField('account_sub_title_text', e.target.value)} />
        <Input label="Beneficiary A/C No." value={draft.beneficiary_ac_no} onChange={(e) => setField('beneficiary_ac_no', e.target.value)} />
        <Input label="Beneficiary IFSC" value={draft.beneficiary_ifsc} onChange={(e) => setField('beneficiary_ifsc', e.target.value.toUpperCase())} />
        <Input label="Beneficiary Name" value={draft.beneficiary_name} onChange={(e) => setField('beneficiary_name', e.target.value)} />
        <Select
          label="Beneficiary Bank"
          value={draft.beneficiary_bank_name}
          onChange={(e) => setField('beneficiary_bank_name', e.target.value)}
          options={[{ value: '', label: 'Select bank...' }, ...BANK_OPTIONS]}
        />
      </div>

      <BeneficiaryAutofill
        accountNumber={draft.beneficiary_ac_no}
        ifsc={draft.beneficiary_ifsc}
        onAutofill={(b) => setDraft(prev => ({
          ...prev,
          beneficiary_name: b.beneficiary_name,
          beneficiary_bank_name: b.beneficiary_bank_name
        }))}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Select
          label="Debit Bank A/C"
          value={draft.debit_bank_ac_type}
          onChange={(e) => setField('debit_bank_ac_type', e.target.value)}
          options={[{ value: '', label: 'Select...' }, ...bankOptions]}
        />
        <Input
          label="Requested Amount"
          type="number"
          value={draft.req_amount}
          onChange={(e) => setField('req_amount', e.target.value)}
        />
        <Select
          label="Payment Mode"
          value={draft.payment_mode}
          onChange={(e) => setField('payment_mode', e.target.value)}
          options={[{ value: '', label: 'Select...' }, ...PAYMENT_MODES]}
        />
      </div>

      {draft.payment_mode === 'Cheque' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Cheque No." required value={draft.cheque_no} onChange={(e) => setField('cheque_no', e.target.value)} />
          <Input label="Cheque Date" required value={draft.cheque_date} onChange={(e) => setField('cheque_date', e.target.value)} />
        </div>
      )}

      {error && <p className="text-[10px] font-semibold text-red-400">{error}</p>}

      <div className="flex items-center gap-2">
        <Button type="submit" variant={returnedPath ? 'amber' : 'primary'} size="sm" loading={saving}>
          {returnedPath ? 'Resubmit' : 'Save'}
        </Button>
        {openPath && onDelete && (
          <Button type="button" variant="danger" size="sm" onClick={() => onDelete(item.id)}>
            Delete
          </Button>
        )}
      </div>
    </form>
  );
};

export default LineItemRow;
