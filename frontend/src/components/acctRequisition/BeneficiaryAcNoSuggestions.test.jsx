import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import BeneficiaryAcNoSuggestions from './BeneficiaryAcNoSuggestions';
import { searchBeneficiariesByAcNo } from '../../api/acctRequisitionsApi';

vi.mock('../../api/acctRequisitionsApi', () => ({
  searchBeneficiariesByAcNo: vi.fn()
}));

const sampleResult = {
  account_number: '112023052202',
  ifsc: 'HDFC0000106',
  beneficiary_name: 'shreyan ghosh',
  beneficiary_bank_name: 'HDFC Bank'
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Comfortably longer than the component's own 300ms debounce, so a
// reopened-but-still-fetching menu has time to fully resolve before an
// assertion checks for its absence.
const DEBOUNCE_MS_FOR_TEST = 500;

beforeEach(() => {
  vi.mocked(searchBeneficiariesByAcNo).mockReset();
});

// Regression: focusing once and then typing continuously (1 char, 2 chars,
// 3+ chars) without ever refocusing used to leave the dropdown permanently
// closed — the under-3-chars branch called setOpen(false) on every one of
// those early keystrokes, stomping on the initial onFocus's setOpen(true),
// and nothing ever reopened it once the prefix became long enough to
// actually fetch. It only "worked" if the field was blurred and refocused
// after already having 3+ characters, not the natural typing flow.
describe('BeneficiaryAcNoSuggestions — reopens as a user types continuously without refocusing', () => {
  it('shows results after typing from 0 up through 3+ characters in one continuous session', async () => {
    vi.mocked(searchBeneficiariesByAcNo).mockResolvedValue({ data: { beneficiaries: [sampleResult] } });
    const { rerender } = render(<BeneficiaryAcNoSuggestions value="" onChange={vi.fn()} />);
    fireEvent.focus(screen.getByRole('textbox'));

    rerender(<BeneficiaryAcNoSuggestions value="1" onChange={vi.fn()} />);
    rerender(<BeneficiaryAcNoSuggestions value="11" onChange={vi.fn()} />);
    rerender(<BeneficiaryAcNoSuggestions value="112" onChange={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('112023052202')).toBeInTheDocument());
  });
});

describe('BeneficiaryAcNoSuggestions — only searches once a real prefix is typed', () => {
  it('does not fetch while the value is under 3 characters', async () => {
    render(<BeneficiaryAcNoSuggestions value="11" onChange={vi.fn()} />);
    fireEvent.focus(screen.getByRole('textbox'));
    await wait(400);
    expect(searchBeneficiariesByAcNo).not.toHaveBeenCalled();
  });

  it('fetches (after the debounce) once the value reaches 3 characters', async () => {
    vi.mocked(searchBeneficiariesByAcNo).mockResolvedValue({ data: { beneficiaries: [sampleResult] } });
    render(<BeneficiaryAcNoSuggestions value="112" onChange={vi.fn()} />);
    fireEvent.focus(screen.getByRole('textbox'));
    await waitFor(() => expect(searchBeneficiariesByAcNo).toHaveBeenCalledWith('112'));
  });

  it('re-fetches with the new prefix as more digits are typed', async () => {
    vi.mocked(searchBeneficiariesByAcNo).mockResolvedValue({ data: { beneficiaries: [] } });
    const { rerender } = render(<BeneficiaryAcNoSuggestions value="112" onChange={vi.fn()} />);
    fireEvent.focus(screen.getByRole('textbox'));
    await waitFor(() => expect(searchBeneficiariesByAcNo).toHaveBeenCalledWith('112'));

    rerender(<BeneficiaryAcNoSuggestions value="1120" onChange={vi.fn()} />);
    await waitFor(() => expect(searchBeneficiariesByAcNo).toHaveBeenCalledWith('1120'));
  });
});

describe('BeneficiaryAcNoSuggestions — renders and picks a result', () => {
  it('shows the account number, name, and bank for each result', async () => {
    vi.mocked(searchBeneficiariesByAcNo).mockResolvedValue({ data: { beneficiaries: [sampleResult] } });
    render(<BeneficiaryAcNoSuggestions value="112" onChange={vi.fn()} />);
    fireEvent.focus(screen.getByRole('textbox'));

    await waitFor(() => expect(screen.getByText('112023052202')).toBeInTheDocument());
    expect(screen.getByText(/shreyan ghosh/i)).toBeInTheDocument();
    expect(screen.getByText(/hdfc bank/i)).toBeInTheDocument();
  });

  it('calls onSelect with the picked result and closes the dropdown', async () => {
    vi.mocked(searchBeneficiariesByAcNo).mockResolvedValue({ data: { beneficiaries: [sampleResult] } });
    const onSelect = vi.fn();
    render(<BeneficiaryAcNoSuggestions value="112" onChange={vi.fn()} onSelect={onSelect} />);
    fireEvent.focus(screen.getByRole('textbox'));

    const option = await screen.findByText('112023052202');
    fireEvent.click(option);

    expect(onSelect).toHaveBeenCalledWith(sampleResult);
    await waitFor(() => expect(screen.queryByText('112023052202')).not.toBeInTheDocument());
  });

  // Regression: the real parent (LineItemRow) updates `value` to the picked
  // suggestion's full account number on select — completing a still-partial
  // prefix. That value change used to re-trigger the fetch effect's
  // setOpen(true), immediately reopening the menu right after handlePick's
  // own setOpen(false). A static `value` prop in the tests above can't catch
  // this — it needs a real stateful wrapper like the one here.
  it('stays closed after picking, even though the value prop changes as a result (completing a partial prefix)', async () => {
    vi.mocked(searchBeneficiariesByAcNo).mockResolvedValue({ data: { beneficiaries: [sampleResult] } });

    function StatefulWrapper() {
      const [value, setValue] = React.useState('112');
      return (
        <BeneficiaryAcNoSuggestions
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onSelect={(b) => setValue(b.account_number)}
        />
      );
    }

    render(<StatefulWrapper />);
    fireEvent.focus(screen.getByRole('textbox'));

    const option = await screen.findByText('112023052202');
    fireEvent.click(option);

    // The value prop is now the full "112023052202" (different from the
    // typed "112"), which used to re-open the menu right here. Wait out a
    // full debounce + fetch cycle (the mock always resolves the same
    // sampleResult) before asserting — otherwise a reopened-but-still-
    // debouncing menu would false-pass this check.
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('112023052202'));
    await wait(DEBOUNCE_MS_FOR_TEST);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText(/searching/i)).not.toBeInTheDocument();
  });

  it('shows "No matches" when the search resolves empty', async () => {
    vi.mocked(searchBeneficiariesByAcNo).mockResolvedValue({ data: { beneficiaries: [] } });
    render(<BeneficiaryAcNoSuggestions value="999" onChange={vi.fn()} />);
    fireEvent.focus(screen.getByRole('textbox'));
    await waitFor(() => expect(screen.getByText(/no matches/i)).toBeInTheDocument());
  });
});

// A fast typer can dispatch a new search before the previous one resolves —
// the earlier, slower response must never overwrite the newer one's results.
describe('BeneficiaryAcNoSuggestions — race protection', () => {
  it('ignores a stale response that resolves after a newer request has already started', async () => {
    let resolveFirst;
    vi.mocked(searchBeneficiariesByAcNo).mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; })
    );
    const { rerender } = render(<BeneficiaryAcNoSuggestions value="112" onChange={vi.fn()} />);
    fireEvent.focus(screen.getByRole('textbox'));
    await waitFor(() => expect(searchBeneficiariesByAcNo).toHaveBeenCalledTimes(1));

    vi.mocked(searchBeneficiariesByAcNo).mockResolvedValueOnce({
      data: { beneficiaries: [{ ...sampleResult, account_number: '112023052999' }] }
    });
    rerender(<BeneficiaryAcNoSuggestions value="1120" onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('112023052999')).toBeInTheDocument());

    // The stale first request finally resolves — must not replace the
    // already-rendered, newer result.
    resolveFirst({ data: { beneficiaries: [sampleResult] } });
    await wait(50);
    expect(screen.getByText('112023052999')).toBeInTheDocument();
    expect(screen.queryByText('112023052202')).not.toBeInTheDocument();
  });
});

describe('BeneficiaryAcNoSuggestions — closes on outside click', () => {
  it('hides the dropdown when clicking outside', async () => {
    vi.mocked(searchBeneficiariesByAcNo).mockResolvedValue({ data: { beneficiaries: [sampleResult] } });
    render(
      <div>
        <BeneficiaryAcNoSuggestions value="112" onChange={vi.fn()} />
        <button type="button">outside</button>
      </div>
    );
    fireEvent.focus(screen.getByRole('textbox'));
    await waitFor(() => expect(screen.getByText('112023052202')).toBeInTheDocument());

    fireEvent.mouseDown(screen.getByText('outside'));
    await waitFor(() => expect(screen.queryByText('112023052202')).not.toBeInTheDocument());
  });
});
