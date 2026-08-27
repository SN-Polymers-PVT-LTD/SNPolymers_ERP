import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import LineItemRow from './LineItemRow';
import { Table, TableBody } from '../ui';

vi.mock('../../api/acctRequisitionsApi', () => ({
  upsertBeneficiary: vi.fn().mockResolvedValue({})
}));

const baseItem = {
  id: 'item-1',
  particulars: 'Test item',
  beneficiary_ac_no: '',
  beneficiary_name: '',
  beneficiary_ifsc: '',
  beneficiary_bank_name: '',
  debit_bank_ac_type: '',
  req_amount: 100,
  payment_mode: '',
  cheque_no: '',
  cheque_date: '',
  requisition_status: 'Draft'
};

// There's no per-row Save button — the sheet-level "Save Draft" button is the
// only way an openPath row gets saved, batching every row's own save
// function (registered via `registerSave`) in one click. Tests trigger a
// save the same way that button does: by calling the registered function.
function renderRow(props = {}) {
  const onSave = vi.fn().mockResolvedValue({});
  const onDelete = vi.fn();
  const onAddItem = vi.fn();
  const saveFns = {};
  const registerSave = vi.fn((itemId, fn) => {
    if (fn) saveFns[itemId] = fn;
    else delete saveFns[itemId];
  });
  render(
    <Table>
      <TableBody>
        <LineItemRow
          item={baseItem}
          sheetStatus="Open"
          onSave={onSave}
          onDelete={onDelete}
          onResubmit={onSave}
          onAddItem={onAddItem}
          registerSave={registerSave}
          {...props}
        />
      </TableBody>
    </Table>
  );
  // beneficiary_bank_name, debit_bank_ac_type, then payment_mode are the three
  // plain <select> elements rendered by this row, in that DOM order (account
  // sub title uses a SearchableSelect, not a <select>) — absent entirely on
  // the collapsed, non-editable row (e.g. sheetStatus 'Submitted').
  const comboboxes = screen.queryAllByRole('combobox');
  const paymentModeSelect = comboboxes[2];
  const triggerSaveDraft = () => saveFns[props.item?.id ?? baseItem.id]?.();
  return { onSave, onDelete, onAddItem, paymentModeSelect, triggerSaveDraft };
}

describe('LineItemRow — cheque_no/cheque_date are optional for every payment mode', () => {
  it('renders cheque number/date inputs even when no payment mode is selected', () => {
    renderRow();
    expect(screen.getByPlaceholderText(/Cheque No\./i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Cheque Date/i)).toBeInTheDocument();
  });

  it('keeps cheque number/date inputs visible for a non-Cheque payment mode (e.g. NEFT)', () => {
    const { paymentModeSelect } = renderRow();
    fireEvent.change(paymentModeSelect, { target: { value: 'NEFT' } });
    expect(screen.getByPlaceholderText(/Cheque No\./i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Cheque Date/i)).toBeInTheDocument();
  });

  it('does not mark cheque inputs as required', () => {
    renderRow();
    expect(screen.getByPlaceholderText(/Cheque No\./i)).not.toBeRequired();
    expect(screen.getByPlaceholderText(/Cheque Date/i)).not.toBeRequired();
  });

  it('saves cheque_no/cheque_date on NEFT via Save Draft, instead of nulling them out', async () => {
    const { onSave, paymentModeSelect, triggerSaveDraft } = renderRow();

    fireEvent.change(paymentModeSelect, { target: { value: 'NEFT' } });
    fireEvent.change(screen.getByPlaceholderText(/Cheque No\./i), { target: { value: '000123' } });
    fireEvent.change(screen.getByPlaceholderText(/Cheque Date/i), { target: { value: '2026-08-16' } });

    await triggerSaveDraft();

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, payload] = onSave.mock.calls[onSave.mock.calls.length - 1];
    expect(payload.payment_mode).toBe('NEFT');
    expect(payload.cheque_no).toBe('000123');
    expect(payload.cheque_date).toBe('2026-08-16');
  });

  it('saves payment_mode Cheque with no cheque_no/cheque_date (no longer blocked)', async () => {
    const { onSave, paymentModeSelect, triggerSaveDraft } = renderRow();

    fireEvent.change(paymentModeSelect, { target: { value: 'Cheque' } });
    await triggerSaveDraft();

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, payload] = onSave.mock.calls[onSave.mock.calls.length - 1];
    expect(payload.payment_mode).toBe('Cheque');
    expect(payload.cheque_no).toBeNull();
    expect(payload.cheque_date).toBeNull();
    expect(screen.queryByText(/cheque_no and cheque_date are required/i)).not.toBeInTheDocument();
  });

  it('does not save until Save Draft is triggered', async () => {
    const { onSave, paymentModeSelect } = renderRow();
    fireEvent.change(paymentModeSelect, { target: { value: 'NEFT' } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('LineItemRow — no per-row Save button; Resubmit, Add, and Delete only', () => {
  it('does not render a per-row Save button for an editable open-path row (Save Draft covers it)', () => {
    renderRow();
    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument();
  });

  it('registers its save function so the sheet-level Save Draft can batch it', () => {
    const registerSave = vi.fn();
    renderRow({ registerSave });
    expect(registerSave).toHaveBeenCalledWith('item-1', expect.any(Function));
  });

  it('shows an explicit Resubmit button for a Returned for Correction row (sheet no longer Open)', () => {
    renderRow({
      item: { ...baseItem, requisition_status: 'Returned for Correction' },
      sheetStatus: 'Submitted'
    });
    expect(screen.getByRole('button', { name: /resubmit/i })).toBeInTheDocument();
  });

  // Regression: a Returned-for-Correction item's status alone used to make
  // the row editable regardless of which page rendered it. On HO's review
  // page (which never passes onResubmit — HO can't resubmit an Accounts
  // item), that rendered the full editable form anyway, including
  // BeneficiaryAutofill, which calls an Accounts/Admin-only lookup endpoint
  // and 403s for an HO user.
  it('falls back to the read-only collapsed view for Returned for Correction when onResubmit is not supplied', () => {
    renderRow({
      item: { ...baseItem, requisition_status: 'Returned for Correction' },
      sheetStatus: 'Submitted',
      onResubmit: undefined
    });
    expect(screen.queryByRole('button', { name: /resubmit/i })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('A/C No.')).not.toBeInTheDocument();
    expect(screen.getByText('Returned for Correction')).toBeInTheDocument();
  });

  it('renders delete as an icon-only button with an accessible label', () => {
    const { onDelete } = renderRow();
    const deleteButton = screen.getByRole('button', { name: /delete line item/i });
    expect(deleteButton).toBeInTheDocument();
    expect(deleteButton).not.toHaveTextContent(/delete/i);
    fireEvent.click(deleteButton);
    expect(onDelete).toHaveBeenCalledWith('item-1');
  });

  it('hides the Add/Delete actions cell entirely when showActionsCell is false (HO review page)', () => {
    renderRow({ showActionsCell: false });
    expect(screen.queryByRole('button', { name: /delete line item/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add line item/i })).not.toBeInTheDocument();
  });

  it('renders a per-row add-item icon button that calls onAddItem', () => {
    const { onAddItem } = renderRow();
    const addButton = screen.getByRole('button', { name: /add line item/i });
    expect(addButton).toBeInTheDocument();
    fireEvent.click(addButton);
    expect(onAddItem).toHaveBeenCalled();
  });
});

describe('LineItemRow — optimistic "pending" placeholder row (temp- id, awaiting the real create response)', () => {
  it('shows a Creating… badge and disables its fields', () => {
    renderRow({ item: { ...baseItem, id: 'temp-abc123' }, pending: true });
    expect(screen.getByText(/creating/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search or add particulars...')).toBeDisabled();
  });

  it('does not render Delete/Add buttons while pending, and does not register a save function', () => {
    const registerSave = vi.fn();
    renderRow({ item: { ...baseItem, id: 'temp-abc123' }, pending: true, registerSave });
    expect(screen.queryByRole('button', { name: /delete line item/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add line item/i })).not.toBeInTheDocument();
    expect(registerSave).not.toHaveBeenCalledWith('temp-abc123', expect.any(Function));
  });
});

// The HO Approval Queue needs an extra "Decision" column (HoDecisionPanel)
// appended to the same table row, without hardcoding anything HO-specific
// into LineItemRow itself — renderExtraCell is a generic escape hatch for
// that, used only by pages that pass it.
describe('LineItemRow — renderExtraCell appends a trailing cell for callers that need one', () => {
  it('renders the extra cell on an editable (openPath) row', () => {
    renderRow({ renderExtraCell: (item) => <span>Decision for {item.id}</span> });
    expect(screen.getByText('Decision for item-1')).toBeInTheDocument();
  });

  it('renders the extra cell on the collapsed, non-editable row (e.g. HO reviewing a Submitted sheet)', () => {
    renderRow({
      sheetStatus: 'Submitted',
      item: { ...baseItem, requisition_status: 'Pending HO Review' },
      renderExtraCell: (item) => <span>Decision for {item.id}</span>
    });
    expect(screen.getByText('Decision for item-1')).toBeInTheDocument();
  });

  it('also hides the actions cell on the collapsed, non-editable row when showActionsCell is false', () => {
    renderRow({
      sheetStatus: 'Submitted',
      item: { ...baseItem, requisition_status: 'Pending HO Review' },
      showActionsCell: false,
      selectable: true
    });
    expect(screen.queryByText(/^select$/i)).not.toBeInTheDocument();
  });

  it('adds no extra cell when renderExtraCell is not supplied (unaffected existing pages)', () => {
    renderRow();
    expect(screen.queryByText(/^Decision for/)).not.toBeInTheDocument();
  });
});

// The Status column otherwise keeps showing the item's real DB status while
// HO is still staging a decision — picking "Hold" in the panel would look
// like nothing happened until "Submit Decisions" is clicked.
describe('LineItemRow — statusOverride previews a staged-but-unsubmitted decision', () => {
  it('shows the overridden status instead of the real requisition_status, with a staged hint', () => {
    renderRow({
      sheetStatus: 'Submitted',
      item: { ...baseItem, requisition_status: 'Pending HO Review' },
      statusOverride: 'On Hold'
    });
    expect(screen.getByText('On Hold')).toBeInTheDocument();
    expect(screen.queryByText('Pending HO Review')).not.toBeInTheDocument();
    expect(screen.getByText(/staged, not yet submitted/i)).toBeInTheDocument();
  });

  it('falls back to the real requisition_status when no decision is staged', () => {
    renderRow({
      sheetStatus: 'Submitted',
      item: { ...baseItem, requisition_status: 'Pending HO Review' }
    });
    expect(screen.getByText('Pending HO Review')).toBeInTheDocument();
    expect(screen.queryByText(/staged, not yet submitted/i)).not.toBeInTheDocument();
  });
});

// The collapsed/view-only row (Already Decided, Rejected, Submitted-sheet
// display) used to merge Particulars and Account Sub-title into one cell via
// colSpan, which silently dropped account_sub_title_text from view — now
// each gets its own cell under its own header column.
describe('LineItemRow — collapsed row shows particulars and account sub-title in separate cells', () => {
  it('renders both particulars and account_sub_title_text', () => {
    renderRow({
      sheetStatus: 'Submitted',
      item: { ...baseItem, requisition_status: 'Approved', account_sub_title_text: 'Advertisement Expenses' }
    });
    expect(screen.getByText('Test item')).toBeInTheDocument();
    expect(screen.getByText('Advertisement Expenses')).toBeInTheDocument();
  });
});

// LastHoActionTag only ever shows last_ho_remarks — a snapshot of a PRIOR,
// already-superseded HO cycle populated by resubmit/reopen. On a first-time
// Return/Hold, nothing has been superseded yet, so last_ho_remarks stays
// empty and Accounts never saw HO's actual reason. The live ho_remarks field
// (set the moment HO returns/holds) must be shown directly instead.
describe('LineItemRow — shows the live ho_remarks for a Returned/On Hold item', () => {
  it('shows ho_remarks for a Returned for Correction row (editable/full-form path)', () => {
    renderRow({
      sheetStatus: 'Submitted',
      item: { ...baseItem, requisition_status: 'Returned for Correction', ho_remarks: 'Wrong beneficiary account.' }
    });
    expect(screen.getByText('"Wrong beneficiary account."')).toBeInTheDocument();
  });

  it('shows ho_remarks for an On Hold row (collapsed path)', () => {
    renderRow({
      sheetStatus: 'Submitted',
      item: { ...baseItem, requisition_status: 'On Hold', ho_remarks: 'Awaiting budget confirmation.' }
    });
    expect(screen.getByText('"Awaiting budget confirmation."')).toBeInTheDocument();
  });

  it('does not show ho_remarks on a plain open-path draft row', () => {
    renderRow({ item: { ...baseItem, ho_remarks: 'Should not appear.' } });
    expect(screen.queryByText('"Should not appear."')).not.toBeInTheDocument();
  });

  it('shows the live ho_remarks for a Rejected row (collapsed path) on a first-time reject', () => {
    renderRow({
      sheetStatus: 'Submitted',
      item: { ...baseItem, requisition_status: 'Rejected', ho_remarks: 'Duplicate payment request.' }
    });
    expect(screen.getByText('"Duplicate payment request."')).toBeInTheDocument();
  });
});

// A Partially Approved item only ever showed the originally requested amount
// in the collapsed view — the actual approved figure (ho_pass_amount, which
// can differ) was nowhere visible without opening HO's decision history.
describe('LineItemRow — shows the approved amount for a Partially Approved row', () => {
  it('shows both the requested and approved amounts', () => {
    renderRow({
      sheetStatus: 'Submitted',
      item: { ...baseItem, requisition_status: 'Partially Approved', req_amount: 1000, ho_pass_amount: 750 }
    });
    expect(screen.getByText(/₹\s*1,000\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Approved ₹\s*750\.00/)).toBeInTheDocument();
  });

  it('also shows the approved-amount line for a fully Approved row', () => {
    renderRow({
      sheetStatus: 'Submitted',
      item: { ...baseItem, requisition_status: 'Approved', req_amount: 1000, ho_pass_amount: 1000 }
    });
    expect(screen.getByText(/Approved ₹\s*1,000\.00/)).toBeInTheDocument();
  });

  it('does not show an approved-amount line when ho_pass_amount is not yet set', () => {
    renderRow({
      sheetStatus: 'Submitted',
      item: { ...baseItem, requisition_status: 'Pending HO Review', req_amount: 1000, ho_pass_amount: null }
    });
    expect(screen.queryByText(/Approved ₹/)).not.toBeInTheDocument();
  });
});

// "Already Decided" tables (HO's own, and the Accounts sheet view once it's
// no longer Open) have nothing left to stage in the Decision/Actions
// column — opt-in props swap it for a dedicated Approved Amount column and
// an HO Remarks column instead, rather than showing dead space.
describe('LineItemRow — showApprovedAmountColumn / showHoRemarksColumn (dedicated columns, not inline)', () => {
  it('renders a separate Approved Amount cell instead of the inline note, when opted in', () => {
    renderRow({
      sheetStatus: 'Submitted',
      showApprovedAmountColumn: true,
      item: { ...baseItem, requisition_status: 'Partially Approved', req_amount: 1000, ho_pass_amount: 750 }
    });
    // The inline "Approved ₹750.00" note under Requested Amount is suppressed...
    expect(screen.queryByText(/Approved ₹\s*750\.00/)).not.toBeInTheDocument();
    // ...in favor of a plain amount in its own column.
    expect(screen.getByText(/₹\s*750\.00/)).toBeInTheDocument();
  });

  it('shows a dash in the Approved Amount column for a row with no ho_pass_amount', () => {
    renderRow({
      sheetStatus: 'Submitted',
      showApprovedAmountColumn: true,
      item: {
        ...baseItem,
        requisition_status: 'Pending HO Review',
        ho_pass_amount: null,
        debit_bank_ac_type: 'CANARA SNP CA',
        beneficiary_name: 'Test Beneficiary',
        account_sub_title_text: 'AMC Charges',
        payment_mode: 'NEFT'
      }
    });
    // Only the Approved Amount cell should be a bare dash — everything else
    // on this row has a real value.
    expect(screen.getAllByText('—')).toHaveLength(1);
  });

  it('shows the live ho_remarks in its own column when opted in', () => {
    renderRow({
      sheetStatus: 'Submitted',
      showHoRemarksColumn: true,
      item: { ...baseItem, requisition_status: 'Approved', ho_remarks: 'Approved with reduced amount.' }
    });
    expect(screen.getByText('"Approved with reduced amount."')).toBeInTheDocument();
  });

  it('does not render either dedicated column when not opted in (unaffected existing pages)', () => {
    renderRow({
      sheetStatus: 'Submitted',
      item: { ...baseItem, requisition_status: 'Approved', ho_pass_amount: 1000, ho_remarks: 'Should not appear as a column.' }
    });
    expect(screen.queryByText('"Should not appear as a column."')).not.toBeInTheDocument();
  });
});

// After "+ Add Line Item" reconciles the optimistic placeholder with the
// real created item, the sheet page flags that row's id so its Particulars
// field grabs focus without the user reaching for the mouse.
describe('LineItemRow — autoFocusParticulars focuses the Particulars field on mount', () => {
  it('focuses the Particulars input when autoFocusParticulars is true', () => {
    renderRow({ autoFocusParticulars: true });
    expect(screen.getByPlaceholderText('Search or add particulars...')).toHaveFocus();
  });

  it('does not steal focus when autoFocusParticulars is false (default)', () => {
    renderRow();
    expect(screen.getByPlaceholderText('Search or add particulars...')).not.toHaveFocus();
  });
});

// Particulars is now a master-based SearchableSelect (mirrors Account
// Sub-title) instead of a plain free-text Input.
describe('LineItemRow — Particulars is a searchable, creatable master-data field', () => {
  const particulars = [
    { id: 'p1', title: 'AMC Charges' },
    { id: 'p2', title: 'Advertisement Expenses' }
  ];

  it('selecting an existing particular sets both particulars and particulars_id', async () => {
    const { onSave, triggerSaveDraft } = renderRow({ particulars, item: { ...baseItem, particulars: '' } });
    const input = screen.getByPlaceholderText('Search or add particulars...');
    fireEvent.focus(input);
    fireEvent.click(screen.getByText('AMC Charges'));

    await triggerSaveDraft();
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, payload] = onSave.mock.calls[onSave.mock.calls.length - 1];
    expect(payload.particulars).toBe('AMC Charges');
    expect(payload.particulars_id).toBe('p1');
  });

  it('creating a new particular calls onCreateParticular and selects the result', async () => {
    const onCreateParticular = vi.fn().mockResolvedValue({ id: 'p3', title: 'Freight Charges' });
    renderRow({ particulars, onCreateParticular });
    const input = screen.getByPlaceholderText('Search or add particulars...');
    fireEvent.change(input, { target: { value: 'Freight Charges' } });

    fireEvent.click(screen.getByText('+ Add "Freight Charges" as new'));
    await waitFor(() => expect(onCreateParticular).toHaveBeenCalledWith('Freight Charges'));
    expect(await screen.findByDisplayValue('Freight Charges')).toBeInTheDocument();
  });

  it('does not offer create when onCreateParticular is not supplied (e.g. HO read-only view)', () => {
    renderRow({ particulars, onCreateParticular: undefined });
    const input = screen.getByPlaceholderText('Search or add particulars...');
    fireEvent.change(input, { target: { value: 'Something new' } });
    expect(screen.queryByText('+ Add "Something new" as new')).not.toBeInTheDocument();
  });
});

// beneficiary_ac_no / beneficiary_ifsc: trimmed client-side on every change
// and length-capped to match the tightened server-side validation (9-18
// digits for A/C No., 11 chars for IFSC).
describe('LineItemRow — beneficiary A/C No. and IFSC input constraints', () => {
  it('caps A/C No. to 18 chars and IFSC to 11 chars', () => {
    renderRow();
    expect(screen.getByPlaceholderText('A/C No.')).toHaveAttribute('maxLength', '18');
    expect(screen.getByPlaceholderText('IFSC')).toHaveAttribute('maxLength', '11');
  });

  it('trims and uppercases IFSC as typed', () => {
    renderRow();
    const ifscInput = screen.getByPlaceholderText('IFSC');
    fireEvent.change(ifscInput, { target: { value: '  hdfc0000106  ' } });
    expect(ifscInput).toHaveValue('HDFC0000106');
  });

  it('strips non-digit characters from A/C No. as typed', () => {
    renderRow();
    const acInput = screen.getByPlaceholderText('A/C No.');
    fireEvent.change(acInput, { target: { value: '12a 34-56b' } });
    expect(acInput).toHaveValue('123456');
  });
});
