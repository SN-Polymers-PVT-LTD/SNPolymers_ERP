import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import BeneficiaryAutofill from './BeneficiaryAutofill';
import { lookupBeneficiary } from '../../api/acctRequisitionsApi';

vi.mock('../../api/acctRequisitionsApi', () => ({
  lookupBeneficiary: vi.fn().mockResolvedValue({
    data: { beneficiary: { beneficiary_name: 'shreyan ghosh', beneficiary_bank_name: 'HDFC Bank' } }
  })
}));

const match = { beneficiary_name: 'shreyan ghosh', beneficiary_bank_name: 'HDFC Bank' };

describe('BeneficiaryAutofill — dismissal is scoped to this row only', () => {
  it('shows the match banner when not yet dismissed on this row', async () => {
    render(<BeneficiaryAutofill accountNumber="112023052202" ifsc="HDFC0000106" />);
    await waitFor(() => expect(screen.getByText(/found beneficiary/i)).toBeInTheDocument());
  });

  it('hides the banner on this row after "Use this", but a fresh row instance still prompts', async () => {
    const onAutofill = vi.fn();
    render(<BeneficiaryAutofill accountNumber="112023052202" ifsc="HDFC0000106" onAutofill={onAutofill} />);
    const useThis = await screen.findByText(/use this/i);
    fireEvent.click(useThis);
    expect(onAutofill).toHaveBeenCalledWith(match);
    expect(screen.queryByText(/found beneficiary/i)).not.toBeInTheDocument();
  });

  it('hides the banner on this row after "Dismiss"', async () => {
    render(<BeneficiaryAutofill accountNumber="112023052202" ifsc="HDFC0000106" />);
    const dismiss = await screen.findByText(/^dismiss$/i);
    fireEvent.click(dismiss);
    expect(screen.queryByText(/found beneficiary/i)).not.toBeInTheDocument();
  });
});

// A failed lookup (network blip, expired session, server error) previously
// looked identical to "no match found" — silently showing nothing. That's
// what made a genuinely-matching beneficiary appear not to autofill with no
// clue why.
describe('BeneficiaryAutofill — a failed lookup is visible, not silently swallowed', () => {
  it('shows an inline error instead of nothing when the lookup request rejects', async () => {
    vi.mocked(lookupBeneficiary).mockRejectedValueOnce(new Error('Network Error'));
    render(<BeneficiaryAutofill accountNumber="112023052202" ifsc="HDFC0000106" />);
    await waitFor(() => expect(screen.getByText(/couldn't check for a matching beneficiary/i)).toBeInTheDocument());
    expect(screen.queryByText(/found beneficiary/i)).not.toBeInTheDocument();
  });
});

// A row that already has the exact matching name/bank typed in (whether by
// hand or from an earlier "Use this") gets nothing new from the prompt —
// showing it anyway is just repeated noise on every row sharing a beneficiary.
describe('BeneficiaryAutofill — suppressed when the row already has the matching values filled in', () => {
  it('does not show the banner when currentName/currentBankName already equal the match', async () => {
    render(
      <BeneficiaryAutofill
        accountNumber="112023052202"
        ifsc="HDFC0000106"
        currentName="shreyan ghosh"
        currentBankName="HDFC Bank"
      />
    );
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(screen.queryByText(/found beneficiary/i)).not.toBeInTheDocument();
  });

  it('is case/whitespace-insensitive when comparing against the match', async () => {
    render(
      <BeneficiaryAutofill
        accountNumber="112023052202"
        ifsc="HDFC0000106"
        currentName="  SHREYAN GHOSH  "
        currentBankName="hdfc bank"
      />
    );
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(screen.queryByText(/found beneficiary/i)).not.toBeInTheDocument();
  });

  it('still shows the banner when only the name matches but the bank differs', async () => {
    render(
      <BeneficiaryAutofill
        accountNumber="112023052202"
        ifsc="HDFC0000106"
        currentName="shreyan ghosh"
        currentBankName="ICICI Bank"
      />
    );
    await waitFor(() => expect(screen.getByText(/found beneficiary/i)).toBeInTheDocument());
  });
});
