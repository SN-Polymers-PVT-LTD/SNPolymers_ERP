import React, { useState, useRef, useEffect } from 'react';
import { Button, Input, FormattedCurrencyInput, Select, SearchableSelect, Badge, TableRow, TableCell } from '../ui';
import BeneficiaryAutofill from './BeneficiaryAutofill';
import LastHoActionTag from './LastHoActionTag';
import ReopenedBadge from './ReopenedBadge';
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
 *
 * Rendered as a <tr> (this row lives inside the sheet detail page's line
 * items <table>) rather than a <form> — a <form> cannot wrap a <tr>, so
 * saving is triggered directly from the Save/Resubmit button's onClick
 * instead of a form submit event.
 */
const LineItemRow = ({
  item,
  sheetStatus,
  bankBalances = [],
  accountSubTitles = [],
  indianBanks = [],
  onSave,
  onResubmit,
  onDelete,
  deleting,
  pending,
  onAddItem,
  addingItem,
  onCreateAccountSubTitle,
  selectable,
  selected,
  onToggleSelect,
  registerSave,
  dismissedBeneficiaryKeys,
  onDismissBeneficiaryKey,
  renderExtraCell,
  showActionsCell = true
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
  const indianBankOptions = indianBanks.map(b => ({ value: b, label: b }));

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
  // closures) so this same function works both as the row's own Save button
  // handler and as an externally-triggered save (the detail page's
  // "Save Draft" batches this across every openPath row via `registerSave`,
  // calling it outside of any render this component controls).
  const performSave = async () => {
    const currentDraft = draftRef.current;
    setError('');
    setSaving(true);
    try {
      const payload = {
        ...currentDraft,
        req_amount: currentDraft.req_amount === '' ? null : Number(currentDraft.req_amount),
        payment_mode: currentDraft.payment_mode || null,
        cheque_no: currentDraft.cheque_no || null,
        cheque_date: currentDraft.cheque_date || null
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

  const handleSaveClick = async () => {
    try {
      await performSave();
    } catch {
      // performSave already set the row's own error state; nothing further
      // to do here.
    }
  };

  // Only openPath rows are batchable — Returned-for-Correction rows use the
  // resubmit endpoint, a state transition rather than a draft save, so they
  // stay opt-in via their own "Resubmit" button and are never silently
  // included in a bulk "Save Draft" click.
  useEffect(() => {
    if (!openPath || !registerSave || pending) return undefined;
    registerSave(item.id, performSave);
    return () => registerSave(item.id, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPath, item.id, registerSave, pending]);

  if (!editable && !viewOnlyFull) {
    return (
      <TableRow>
        <TableCell colSpan={2}>
          <p className="text-sm font-bold text-slate-100">{item.particulars || '—'}</p>
        </TableCell>
        <TableCell className="min-w-[200px]">
          <div className="flex flex-col gap-1">
            <p className="text-xs font-semibold text-slate-300">{item.beneficiary_name || '—'}</p>
            {item.beneficiary_ac_no && (
              <p className="text-[10px] text-slate-500">
                <span className="text-slate-600 font-bold uppercase tracking-wider mr-1">A/C</span>
                {item.beneficiary_ac_no}
              </p>
            )}
            {item.beneficiary_ifsc && (
              <p className="text-[10px] text-slate-500">
                <span className="text-slate-600 font-bold uppercase tracking-wider mr-1">IFSC</span>
                {item.beneficiary_ifsc}
              </p>
            )}
          </div>
        </TableCell>
        <TableCell>{item.debit_bank_ac_type || '—'}</TableCell>
        <TableCell align="right">
          <span className="font-bold text-slate-200">{formatCurrency(item.req_amount)}</span>
        </TableCell>
        <TableCell>{item.payment_mode || '—'}</TableCell>
        <TableCell className="min-w-[220px] max-w-[260px]">
          <div className="flex flex-col gap-1.5 items-start">
            <Badge variant={STATUS_VARIANTS[item.requisition_status] || 'slate'}>
              {item.requisition_status || 'Draft'}
            </Badge>
            <LastHoActionTag item={item} />
            <ReopenedBadge item={item} />
          </div>
        </TableCell>
        {showActionsCell && (
          <TableCell>
            {selectable && (
              <label className="flex items-center gap-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                <input type="checkbox" checked={!!selected} onChange={(e) => onToggleSelect?.(item.id, e.target.checked)} />
                Select
              </label>
            )}
          </TableCell>
        )}
        {renderExtraCell && <TableCell className="min-w-[260px]">{renderExtraCell(item)}</TableCell>}
      </TableRow>
    );
  }

  const readOnly = !editable || pending; // viewOnlyFull, or a not-yet-reconciled optimistic placeholder
  const holdDays = viewOnlyFull ? daysOnHold(item) : null;

  return (
    <TableRow className={editable ? 'bg-amber-500/[0.03]' : 'bg-orange-500/[0.03]'}>
      <TableCell className="min-w-[160px]">
        <div className="flex flex-col gap-2">
          {pending && <Badge variant="slate">Creating…</Badge>}
          {returnedPath && <Badge variant="red">Returned for Correction</Badge>}
          {viewOnlyFull && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="orange">On Hold</Badge>
              {holdDays != null && (
                <span className="text-[9px] font-bold uppercase tracking-wider text-orange-400">
                  {holdDays}d
                </span>
              )}
            </div>
          )}
          <Input disabled={readOnly} value={draft.particulars} onChange={(e) => setField('particulars', e.target.value)} placeholder="Particulars" size="sm" />
          <LastHoActionTag item={item} />
          <ReopenedBadge item={item} />
        </div>
      </TableCell>

      <TableCell className="min-w-[160px]">
        <SearchableSelect
          disabled={readOnly}
          value={draft.account_sub_title_text}
          onChange={handleSubTitleTextChange}
          options={subTitleOptions}
          onSelect={(opt) => setDraft(prev => ({ ...prev, account_sub_title_id: opt.value, account_sub_title_text: opt.label }))}
          onCreate={onCreateAccountSubTitle ? handleCreateSubTitle : undefined}
          placeholder="Search or add a title..."
        />
      </TableCell>

      <TableCell className="min-w-[220px]">
        <div className="flex flex-col gap-1.5">
          <Input disabled={readOnly} value={draft.beneficiary_ac_no} onChange={(e) => setField('beneficiary_ac_no', e.target.value)} placeholder="A/C No." size="sm" />
          <Input disabled={readOnly} value={draft.beneficiary_ifsc} onChange={(e) => setField('beneficiary_ifsc', e.target.value.toUpperCase())} placeholder="IFSC" size="sm" />
          <Input disabled={readOnly} value={draft.beneficiary_name} onChange={(e) => setField('beneficiary_name', e.target.value)} placeholder="Beneficiary Name" size="sm" />
          <Select
            disabled={readOnly}
            value={draft.beneficiary_bank_name}
            onChange={(e) => setField('beneficiary_bank_name', e.target.value)}
            options={[{ value: '', label: 'Select bank...' }, ...indianBankOptions]}
          />
          {editable && (
            <BeneficiaryAutofill
              accountNumber={draft.beneficiary_ac_no}
              ifsc={draft.beneficiary_ifsc}
              currentName={draft.beneficiary_name}
              currentBankName={draft.beneficiary_bank_name}
              sheetDismissedKeys={dismissedBeneficiaryKeys}
              onSheetDismiss={onDismissBeneficiaryKey}
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
        </div>
      </TableCell>

      <TableCell className="min-w-[140px]">
        <Select
          disabled={readOnly}
          value={draft.debit_bank_ac_type}
          onChange={(e) => setField('debit_bank_ac_type', e.target.value)}
          options={[{ value: '', label: 'Select...' }, ...bankOptions]}
        />
      </TableCell>

      <TableCell className="min-w-[140px]">
        <FormattedCurrencyInput
          disabled={readOnly}
          value={draft.req_amount}
          onValueChange={(val) => setField('req_amount', val)}
        />
      </TableCell>

      <TableCell className="min-w-[160px]">
        <div className="flex flex-col gap-1.5">
          <Select
            disabled={readOnly}
            value={draft.payment_mode}
            onChange={(e) => setField('payment_mode', e.target.value)}
            options={[{ value: '', label: 'Select...' }, ...PAYMENT_MODES]}
          />
          <Input disabled={readOnly} value={draft.cheque_no} onChange={(e) => setField('cheque_no', e.target.value)} placeholder="Cheque No. (optional)" size="sm" />
          <Input disabled={readOnly} value={draft.cheque_date} onChange={(e) => setField('cheque_date', e.target.value)} placeholder="Cheque Date (optional)" size="sm" />
        </div>
      </TableCell>

      <TableCell className="min-w-[100px]">
        <Badge variant={STATUS_VARIANTS[item.requisition_status] || 'slate'}>
          {item.requisition_status || 'Draft'}
        </Badge>
        {error && <p className="text-[10px] font-semibold text-red-400 mt-1.5">{error}</p>}
      </TableCell>

      {showActionsCell && (
      <TableCell className="min-w-[140px]">
        {editable && (
          <div className="flex items-center gap-2">
            {returnedPath && (
              <Button type="button" variant="amber" size="sm" loading={saving} onClick={handleSaveClick}>
                Resubmit
              </Button>
            )}
            {openPath && onAddItem && !pending && (
              <button
                type="button"
                aria-label="Add line item"
                title="Add line item"
                disabled={addingItem}
                onClick={onAddItem}
                className="inline-flex items-center justify-center w-8 h-8 rounded-xl text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m-7-7h14" />
                </svg>
              </button>
            )}
            {openPath && onDelete && !pending && (
              <button
                type="button"
                aria-label="Delete line item"
                title="Delete line item"
                disabled={deleting}
                onClick={() => onDelete(item.id)}
                className="inline-flex items-center justify-center w-8 h-8 rounded-xl text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <svg className={`w-4 h-4 ${deleting ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  {deleting ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 12a8 8 0 018-8V2.5" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m2 0-1 13a2 2 0 01-2 2H9a2 2 0 01-2-2L6 7h12z" />
                  )}
                </svg>
              </button>
            )}
          </div>
        )}
        {selectable && (
          <label className="flex items-center gap-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider mt-2">
            <input type="checkbox" checked={!!selected} onChange={(e) => onToggleSelect?.(item.id, e.target.checked)} />
            Select
          </label>
        )}
      </TableCell>
      )}
      {renderExtraCell && <TableCell className="min-w-[260px]">{renderExtraCell(item)}</TableCell>}
    </TableRow>
  );
};

export default LineItemRow;
