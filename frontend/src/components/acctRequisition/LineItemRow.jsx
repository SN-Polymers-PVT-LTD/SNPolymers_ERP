import React, { useState, useRef, useEffect } from 'react';
import { Button, Input, FormattedCurrencyInput, Select, SearchableSelect, Badge } from '../ui';
import BeneficiaryAutofill from './BeneficiaryAutofill';
import LastHoActionTag from './LastHoActionTag';
import ReopenedBadge from './ReopenedBadge';
import INDIAN_BANKS from '../../constants/indianBanks';
import { upsertBeneficiary } from '../../api/acctRequisitionsApi';

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

// Backend sets ho_actioned_at (not the generic updated_at) at the moment a row
// transitions into Hold (act_acct_line_item_non_approve_transact) — the precise
// "when it entered Hold" timestamp, unaffected by unrelated row touches.
const daysOnHold = (item) => {
  if (item.requisition_status !== 'On Hold' || !item.ho_actioned_at) return null;
  const diffMs = Date.now() - new Date(item.ho_actioned_at).getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
};

const beneficiaryKey = (acNo, ifsc) => `${(acNo || '').trim()}|${(ifsc || '').trim()}`;

const emptyDraft = (item) => ({
  account_sub_title_id: item.account_sub_title_id || null,
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
 *
 * A third mode, viewOnlyFull, covers On Hold (product doc §6: fields are
 * always disabled, never hidden, while a row is Hold or Returned for
 * Correction) — it reuses the same field layout as the editable form but
 * with every field disabled and no submit control.
 */
const LineItemRow = ({
  item,
  sheetStatus,
  bankBalances = [],
  accountSubTitles = [],
  onSave,
  onResubmit,
  onDelete,
  onCreateAccountSubTitle,
  selectable,
  selected,
  onToggleSelect,
  registerSave
}) => {
  const openPath = sheetStatus === 'Open';
  const returnedPath = item.requisition_status === 'Returned for Correction';
  const editable = openPath || returnedPath;
  const viewOnlyFull = !editable && item.requisition_status === 'On Hold';

  const [draft, setDraft] = useState(() => emptyDraft(item));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmedBeneficiaryKey, setConfirmedBeneficiaryKey] = useState(null);
  const draftRef = useRef(draft);
  const confirmedBeneficiaryKeyRef = useRef(confirmedBeneficiaryKey);

  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => { confirmedBeneficiaryKeyRef.current = confirmedBeneficiaryKey; }, [confirmedBeneficiaryKey]);

  const bankOptions = bankBalances.map(b => ({ value: b.bank_name, label: b.bank_name }));
  const subTitleOptions = accountSubTitles.map(t => ({ value: t.id, label: t.title }));

  const setField = (field, value) => setDraft(prev => ({ ...prev, [field]: value }));

  const handleSubTitleTextChange = (text) => {
    const match = subTitleOptions.find(o => o.label.trim().toLowerCase() === text.trim().toLowerCase());
    setDraft(prev => ({ ...prev, account_sub_title_text: text, account_sub_title_id: match?.value || null }));
  };

  const handleCreateSubTitle = async (title) => {
    const created = await onCreateAccountSubTitle(title);
    return { value: created.id, label: created.title };
  };

  // Reads from the refs (not the `draft`/`confirmedBeneficiaryKey` state
  // closures) so this same function works both as the row's own form submit
  // handler and as an externally-triggered save (AcctRequisitions.jsx's
  // "Save Draft" batches this across every openPath row via `registerSave`,
  // calling it outside of any render this component controls).
  const performSave = async () => {
    const currentDraft = draftRef.current;
    setError('');
    if (currentDraft.payment_mode === 'Cheque' && (!currentDraft.cheque_no || !currentDraft.cheque_date)) {
      const msg = 'cheque_no and cheque_date are required when payment_mode is Cheque.';
      setError(msg);
      throw new Error(msg);
    }
    setSaving(true);
    try {
      const payload = {
        ...currentDraft,
        req_amount: currentDraft.req_amount === '' ? null : Number(currentDraft.req_amount),
        payment_mode: currentDraft.payment_mode || null,
        cheque_no: currentDraft.payment_mode === 'Cheque' ? currentDraft.cheque_no : null,
        cheque_date: currentDraft.payment_mode === 'Cheque' ? currentDraft.cheque_date : null
      };
      if (openPath) {
        await onSave(item.id, payload);
      } else {
        await onResubmit(item.id, payload);
      }

      // Product doc §8: a manually-typed (not autofill-confirmed) beneficiary
      // gets upserted into beneficiary_master on save. Best-effort — the line
      // item is already saved, so a beneficiary_master rejection (e.g.
      // unrecognized bank name) must never look like the save itself failed.
      const currentKey = beneficiaryKey(currentDraft.beneficiary_ac_no, currentDraft.beneficiary_ifsc);
      if (
        currentDraft.beneficiary_ac_no?.trim() &&
        currentDraft.beneficiary_ifsc?.trim() &&
        currentDraft.beneficiary_name?.trim() &&
        currentDraft.beneficiary_bank_name?.trim() &&
        confirmedBeneficiaryKeyRef.current !== currentKey
      ) {
        setConfirmedBeneficiaryKey(currentKey);
        upsertBeneficiary({
          account_number: currentDraft.beneficiary_ac_no.trim(),
          ifsc: currentDraft.beneficiary_ifsc.trim(),
          beneficiary_name: currentDraft.beneficiary_name.trim(),
          beneficiary_bank_name: currentDraft.beneficiary_bank_name.trim()
        }).catch((err) => {
          console.warn('Beneficiary master upsert skipped:', err.response?.data?.message || err.message);
        });
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save line item.');
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await performSave();
    } catch {
      // performSave already set the row's own error state; nothing further
      // to do here — this handler exists only to prevent the native form
      // submit's page navigation and to swallow the re-thrown error so it
      // doesn't surface as an unhandled rejection.
    }
  };

  // Only openPath rows are batchable — Returned-for-Correction rows use the
  // resubmit endpoint, a state transition rather than a draft save, so they
  // stay opt-in via their own "Resubmit" button and are never silently
  // included in a bulk "Save Draft" click.
  useEffect(() => {
    if (!openPath || !registerSave) return undefined;
    registerSave(item.id, performSave);
    return () => registerSave(item.id, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPath, item.id, registerSave]);

  if (!editable && !viewOnlyFull) {
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

  const readOnly = !editable; // true exactly when viewOnlyFull (the early return above already excludes every other non-editable status)
  const holdDays = viewOnlyFull ? daysOnHold(item) : null;

  return (
    <form
      onSubmit={handleSubmit}
      className={`flex flex-col gap-3 p-4 rounded-2xl border ${editable ? 'bg-white/[0.03] border-amber-500/20' : 'bg-white/[0.02] border-orange-500/20'}`}
    >
      {returnedPath && (
        <div className="flex items-center gap-2">
          <Badge variant="red">Returned for Correction</Badge>
          <LastHoActionTag item={item} />
        </div>
      )}

      {viewOnlyFull && (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="orange">On Hold</Badge>
          {holdDays != null && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-orange-400">
              {holdDays} day{holdDays === 1 ? '' : 's'} on hold
            </span>
          )}
          <LastHoActionTag item={item} />
          <ReopenedBadge item={item} />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input label="Particulars" disabled={readOnly} value={draft.particulars} onChange={(e) => setField('particulars', e.target.value)} />
        <SearchableSelect
          label="Account Sub-title"
          disabled={readOnly}
          value={draft.account_sub_title_text}
          onChange={handleSubTitleTextChange}
          options={subTitleOptions}
          onSelect={(opt) => setDraft(prev => ({ ...prev, account_sub_title_id: opt.value, account_sub_title_text: opt.label }))}
          onCreate={onCreateAccountSubTitle ? handleCreateSubTitle : undefined}
          placeholder="Search or add a title..."
        />
        <Input label="Beneficiary A/C No." disabled={readOnly} value={draft.beneficiary_ac_no} onChange={(e) => setField('beneficiary_ac_no', e.target.value)} />
        <Input label="Beneficiary IFSC" disabled={readOnly} value={draft.beneficiary_ifsc} onChange={(e) => setField('beneficiary_ifsc', e.target.value.toUpperCase())} />
        <Input label="Beneficiary Name" disabled={readOnly} value={draft.beneficiary_name} onChange={(e) => setField('beneficiary_name', e.target.value)} />
        <Select
          label="Beneficiary Bank"
          disabled={readOnly}
          value={draft.beneficiary_bank_name}
          onChange={(e) => setField('beneficiary_bank_name', e.target.value)}
          options={[{ value: '', label: 'Select bank...' }, ...BANK_OPTIONS]}
        />
      </div>

      {editable && (
        <BeneficiaryAutofill
          accountNumber={draft.beneficiary_ac_no}
          ifsc={draft.beneficiary_ifsc}
          onAutofill={(b) => {
            setDraft(prev => ({
              ...prev,
              beneficiary_name: b.beneficiary_name,
              beneficiary_bank_name: b.beneficiary_bank_name
            }));
            setConfirmedBeneficiaryKey(beneficiaryKey(draft.beneficiary_ac_no, draft.beneficiary_ifsc));
          }}
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Select
          label="Debit Bank A/C"
          disabled={readOnly}
          value={draft.debit_bank_ac_type}
          onChange={(e) => setField('debit_bank_ac_type', e.target.value)}
          options={[{ value: '', label: 'Select...' }, ...bankOptions]}
        />
        <FormattedCurrencyInput
          label="Requested Amount"
          disabled={readOnly}
          value={draft.req_amount}
          onValueChange={(val) => setField('req_amount', val)}
        />
        <Select
          label="Payment Mode"
          disabled={readOnly}
          value={draft.payment_mode}
          onChange={(e) => setField('payment_mode', e.target.value)}
          options={[{ value: '', label: 'Select...' }, ...PAYMENT_MODES]}
        />
      </div>

      {draft.payment_mode === 'Cheque' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Cheque No." required disabled={readOnly} value={draft.cheque_no} onChange={(e) => setField('cheque_no', e.target.value)} />
          <Input label="Cheque Date" required disabled={readOnly} value={draft.cheque_date} onChange={(e) => setField('cheque_date', e.target.value)} />
        </div>
      )}

      {error && <p className="text-[10px] font-semibold text-red-400">{error}</p>}

      {editable && (
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
      )}
    </form>
  );
};

export default LineItemRow;
