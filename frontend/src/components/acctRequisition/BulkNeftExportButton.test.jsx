import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import BulkNeftExportButton from './BulkNeftExportButton';
import { exportBulkNeft } from '../../api/acctRequisitionsApi';

vi.mock('../../api/acctRequisitionsApi', () => ({
  exportBulkNeft: vi.fn()
}));

beforeEach(() => {
  vi.mocked(exportBulkNeft).mockReset();
  global.URL.createObjectURL = vi.fn(() => 'blob:mock');
  global.URL.revokeObjectURL = vi.fn();
});

// The backend's Bulk NEFT letter is inherently single-bank — it's a real
// authorization letter addressed to one branch/account — and rejects a
// mixed-bank request outright. So a sheet with items across N different
// debit banks must never be sent as one batch; it needs one export call per
// bank, and (since there's no manual per-bank selection anymore) those N
// results get bundled into one zip instead of erroring out.
describe('BulkNeftExportButton — groups by debit bank instead of sending one mixed-bank batch', () => {
  it('calls exportBulkNeft once, for the single bank, when every item shares one debit bank', async () => {
    vi.mocked(exportBulkNeft).mockResolvedValue({ data: new Blob(['xlsx-bytes']) });
    const items = [
      { id: 'i1', debit_bank_ac_type: 'CANARA SNP CA' },
      { id: 'i2', debit_bank_ac_type: 'CANARA SNP CA' }
    ];
    render(<BulkNeftExportButton sheetId="sheet-1" items={items} />);

    fireEvent.click(screen.getByRole('button', { name: /export bulk neft/i }));

    await waitFor(() => expect(exportBulkNeft).toHaveBeenCalledTimes(1));
    expect(exportBulkNeft).toHaveBeenCalledWith('sheet-1', { item_ids: ['i1', 'i2'] });
    await waitFor(() => expect(screen.getByText(/exported 2 item\(s\) across 1 bank/i)).toBeInTheDocument());
  });

  it('calls exportBulkNeft once per bank when items span multiple debit banks, and zips the results', async () => {
    vi.mocked(exportBulkNeft).mockResolvedValue({ data: new Blob(['xlsx-bytes']) });
    const items = [
      { id: 'i1', debit_bank_ac_type: 'CANARA SNP CA' },
      { id: 'i2', debit_bank_ac_type: 'CANARA SNP CC' },
      { id: 'i3', debit_bank_ac_type: 'TEST BANK 001' }
    ];
    render(<BulkNeftExportButton sheetId="sheet-1" items={items} />);

    fireEvent.click(screen.getByRole('button', { name: /export bulk neft/i }));

    await waitFor(() => expect(exportBulkNeft).toHaveBeenCalledTimes(3));
    const calledBanks = exportBulkNeft.mock.calls.map(([, body]) => body.item_ids[0]);
    expect(calledBanks.sort()).toEqual(['i1', 'i2', 'i3']);
    await waitFor(() => expect(screen.getByText(/exported 3 item\(s\) across 3 bank/i)).toBeInTheDocument());
  });

  it('is disabled with no item count when there are no eligible items', () => {
    render(<BulkNeftExportButton sheetId="sheet-1" items={[]} />);
    const button = screen.getByRole('button', { name: /^export bulk neft$/i });
    expect(button).toBeDisabled();
  });

  it('shows an error message if one of the per-bank export calls fails', async () => {
    vi.mocked(exportBulkNeft).mockRejectedValue({ response: { data: new Blob([JSON.stringify({ message: 'No account number on file.' })]) } });
    const items = [{ id: 'i1', debit_bank_ac_type: 'CANARA SNP CA' }];
    render(<BulkNeftExportButton sheetId="sheet-1" items={items} />);

    fireEvent.click(screen.getByRole('button', { name: /export bulk neft/i }));

    await waitFor(() => expect(screen.getByText(/no account number on file/i)).toBeInTheDocument());
  });
});
