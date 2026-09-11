import React from 'react';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ImportEligibleItemsModal from './ImportEligibleItemsModal';
import { getImportEligibleItems, importLineItem, dismissImportEligibleItem, getAccountSubTitles } from '../../api/acctRequisitionsApi';

vi.mock('../../api/acctRequisitionsApi', () => ({
  getImportEligibleItems: vi.fn(),
  importLineItem: vi.fn(),
  dismissImportEligibleItem: vi.fn(),
  getAccountSubTitles: vi.fn()
}));

const renderModal = (props = {}) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ImportEligibleItemsModal isOpen onClose={() => {}} targetSheetId="target-sheet-1" {...props} />
    </QueryClientProvider>
  );
};

const sampleItem = {
  id: 'item-1',
  sheet_number: '26082026-3',
  account_sub_title_text: 'AMC',
  particulars: 'AMC renewal',
  beneficiary_name: 'Person A',
  req_amount: 12200,
  payment_mode: 'Bulk NEFT',
  requisition_status: 'On Hold'
};

describe('ImportEligibleItemsModal — browse and act on On Hold/Rejected items', () => {
  beforeEach(() => {
    vi.mocked(getImportEligibleItems).mockReset();
    vi.mocked(importLineItem).mockReset();
    vi.mocked(dismissImportEligibleItem).mockReset();
    vi.mocked(getAccountSubTitles).mockReset();
    vi.mocked(getAccountSubTitles).mockResolvedValue({ data: { accountSubTitles: [] } });
  });

  it('shows an empty state when there are no eligible items', async () => {
    vi.mocked(getImportEligibleItems).mockResolvedValue({ data: { items: [] } });
    renderModal();

    await waitFor(() => expect(screen.getByText(/no on hold, rejected, or pending review items/i)).toBeInTheDocument());
  });

  it('lists eligible items with their source sheet, amount, and status', async () => {
    vi.mocked(getImportEligibleItems).mockResolvedValue({ data: { items: [sampleItem] } });
    renderModal();

    await waitFor(() => expect(screen.getByText('26082026-3')).toBeInTheDocument());
    expect(screen.getByText('AMC')).toBeInTheDocument();
    expect(screen.getByText('Person A')).toBeInTheDocument();
    expect(screen.getByText(/12,200/)).toBeInTheDocument();
    // 'On Hold' also appears as a Status filter option now, so scope to the table.
    expect(within(screen.getByRole('table')).getByText('On Hold')).toBeInTheDocument();
  });

  it('imports an item into the target sheet and refreshes the list', async () => {
    vi.mocked(getImportEligibleItems).mockResolvedValue({ data: { items: [sampleItem] } });
    vi.mocked(importLineItem).mockResolvedValue({ data: { item: { id: 'new-item' } } });
    const onImported = vi.fn();
    renderModal({ onImported });

    await waitFor(() => expect(screen.getByText('AMC')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^import$/i }));

    await waitFor(() => expect(importLineItem).toHaveBeenCalledWith('item-1', 'target-sheet-1'));
    await waitFor(() => expect(onImported).toHaveBeenCalled());
  });

  it('removes the item from the list immediately on import, before the request resolves', async () => {
    vi.mocked(getImportEligibleItems).mockResolvedValue({ data: { items: [sampleItem] } });
    let resolveImport;
    vi.mocked(importLineItem).mockReturnValue(new Promise((resolve) => { resolveImport = resolve; }));
    renderModal();

    await waitFor(() => expect(screen.getByText('AMC')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^import$/i }));

    // Optimistic: gone from the list even though importLineItem hasn't resolved yet.
    await waitFor(() => expect(screen.getByText(/no on hold, rejected, or pending review items/i)).toBeInTheDocument());
    resolveImport({ data: { item: { id: 'new-item' } } });
  });

  it('shows an error message, restores the item, and does not call onImported if import fails', async () => {
    vi.mocked(getImportEligibleItems).mockResolvedValue({ data: { items: [sampleItem] } });
    vi.mocked(importLineItem).mockRejectedValue({ response: { data: { message: 'Items can only be imported into an Open sheet.' } } });
    const onImported = vi.fn();
    renderModal({ onImported });

    await waitFor(() => expect(screen.getByText('AMC')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^import$/i }));

    await waitFor(() => expect(screen.getByText(/items can only be imported into an open sheet/i)).toBeInTheDocument());
    expect(onImported).not.toHaveBeenCalled();
    // Rolled back: the item is back in the list after the failure.
    expect(screen.getByText('AMC')).toBeInTheDocument();
  });

  it('dismisses an item and removes it from the list immediately, without importing it', async () => {
    vi.mocked(getImportEligibleItems).mockResolvedValue({ data: { items: [sampleItem] } });
    vi.mocked(dismissImportEligibleItem).mockResolvedValue({ data: { item: { id: 'item-1', import_dismissed: true } } });
    renderModal();

    await waitFor(() => expect(screen.getByText('AMC')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    await waitFor(() => expect(dismissImportEligibleItem).toHaveBeenCalledWith('item-1'));
    expect(importLineItem).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(/no on hold, rejected, or pending review items/i)).toBeInTheDocument());
  });

  it('restores the item to the list if dismiss fails', async () => {
    vi.mocked(getImportEligibleItems).mockResolvedValue({ data: { items: [sampleItem] } });
    vi.mocked(dismissImportEligibleItem).mockRejectedValue({ response: { data: { message: 'Item does not exist, or is already imported or dismissed.' } } });
    renderModal();

    await waitFor(() => expect(screen.getByText('AMC')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    await waitFor(() => expect(screen.getByText(/already imported or dismissed/i)).toBeInTheDocument());
    expect(screen.getByText('AMC')).toBeInTheDocument();
  });

  it('does not fetch eligible items while closed', () => {
    vi.mocked(getImportEligibleItems).mockResolvedValue({ data: { items: [] } });
    renderModal({ isOpen: false });
    expect(getImportEligibleItems).not.toHaveBeenCalled();
  });
});
