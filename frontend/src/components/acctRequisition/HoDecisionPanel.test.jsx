import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import HoDecisionPanel from './HoDecisionPanel';

const pendingItem = { id: 'item-1', requisition_status: 'Pending HO Review' };

// HoDecisionPanel is a controlled staging form now — it never submits
// anything itself. Every field change is reported to the parent via
// onDecisionChange, and the parent (AcctHoSheetView) owns the actual batch
// submit. A decision review queue must never default to Approve either —
// that turns an under-thought "stage this row" into a real money-movement
// decision — so it starts unselected and forces the reviewer to actively
// choose.
function renderPanel(props = {}) {
  const onDecisionChange = vi.fn();
  render(
    <HoDecisionPanel
      item={pendingItem}
      decision={undefined}
      onDecisionChange={onDecisionChange}
      {...props}
    />
  );
  return { onDecisionChange };
}

describe('HoDecisionPanel — a controlled staging form, not a per-row submitter', () => {
  it('renders with "Select a decision..." chosen, not Approve', () => {
    renderPanel();
    expect(screen.getByRole('combobox')).toHaveValue('');
    expect(screen.getByRole('option', { name: /select a decision/i })).toBeInTheDocument();
  });

  it('has no Submit button of its own — decisions are batched by the parent', () => {
    renderPanel();
    expect(screen.queryByRole('button', { name: /submit/i })).not.toBeInTheDocument();
  });

  it('reports the picked action up via onDecisionChange instead of submitting', () => {
    const { onDecisionChange } = renderPanel();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Approve' } });
    expect(onDecisionChange).toHaveBeenCalledWith('item-1', expect.objectContaining({ action: 'Approve' }));
  });

  it('shows a "Staged" badge once a decision has been picked', () => {
    renderPanel({ decision: { action: 'Approve', ho_pass_amount: '', ho_remarks: '' } });
    expect(screen.getByText(/staged/i)).toBeInTheDocument();
  });

  it('does not show "Staged" when nothing has been picked yet', () => {
    renderPanel();
    expect(screen.queryByText(/staged/i)).not.toBeInTheDocument();
  });

  it('shows the Pass Amount field only for Partially Approve', () => {
    renderPanel({ decision: { action: 'PartiallyApprove', ho_pass_amount: '', ho_remarks: '' } });
    expect(screen.getByText(/pass amount/i)).toBeInTheDocument();
  });

  it('disables all inputs while a batch submit is in flight (disabled prop)', () => {
    renderPanel({ disabled: true });
    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  it('shows a per-item error passed back after a failed batch submit', () => {
    renderPanel({ error: 'Approval would drive balance below zero.' });
    expect(screen.getByText(/balance below zero/i)).toBeInTheDocument();
  });

  it('does not render a decision form for an already-decided item (e.g. Approved)', () => {
    renderPanel({ item: { id: 'item-2', requisition_status: 'Approved' } });
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  // On Hold and Rejected are both terminal on their original sheet
  // (037_terminal_hold_and_rejected.sql) — re-importing into a new sheet is
  // the only way forward from either, so neither gets a decision form here.
  it('does not render a decision form for an On Hold item', () => {
    renderPanel({ item: { id: 'item-3', requisition_status: 'On Hold' } });
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('does not render a decision form for a Rejected item', () => {
    renderPanel({ item: { id: 'item-4', requisition_status: 'Rejected' } });
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
