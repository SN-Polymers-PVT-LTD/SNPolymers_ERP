import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import BeneficiaryAcNoSuggestions from './BeneficiaryAcNoSuggestions';
import { searchBeneficiariesByAcNo } from '../../api/acctRequisitionsApi';

vi.mock('../../api/acctRequisitionsApi', () => ({ searchBeneficiariesByAcNo: vi.fn() }));

const beneficiary = {
  account_number: '9876543210', ifsc: 'HDFC0001234', beneficiary_name: 'Acme Infra',
  beneficiary_bank_name: 'HDFC Bank'
};

beforeEach(() => vi.mocked(searchBeneficiariesByAcNo).mockResolvedValue({ data: { beneficiaries: [beneficiary] } }));

describe('BeneficiaryAcNoSuggestions name search', () => {
  it('searches by beneficiary name and fills the selected record', async () => {
    const onSelect = vi.fn();
    render(<BeneficiaryAcNoSuggestions value="Acme" searchBy="name" primaryField="name" onChange={vi.fn()} onSelect={onSelect} />);
    fireEvent.focus(screen.getByRole('textbox'));
    await waitFor(() => expect(searchBeneficiariesByAcNo).toHaveBeenCalledWith('Acme', 8, 'name'));
    fireEvent.click(await screen.findByText('Acme Infra'));
    expect(onSelect).toHaveBeenCalledWith(beneficiary);
  });

  it('supports clearing the current selection', () => {
    const onClearSelection = vi.fn();
    render(<BeneficiaryAcNoSuggestions value="Acme Infra" onChange={vi.fn()} onClearSelection={onClearSelection} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear beneficiary selection' }));
    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });
});
