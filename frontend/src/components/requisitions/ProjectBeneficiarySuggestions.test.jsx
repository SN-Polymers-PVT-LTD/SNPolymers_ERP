import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ProjectBeneficiarySuggestions from './ProjectBeneficiarySuggestions';
import { searchProjectsBeneficiaries } from '../../api/requisitionsApi';

vi.mock('../../api/requisitionsApi', () => ({
  searchProjectsBeneficiaries: vi.fn()
}));

const sampleBeneficiary = {
  id: 'b-123',
  beneficiary_ac_no: '9876543210',
  beneficiary_name: 'Acme Infra Solutions',
  beneficiary_ifsc: 'HDFC0001234',
  beneficiary_bank_id: 'bank-1',
  beneficiary_bank_name: 'HDFC Bank',
  beneficiary_bank: {
    id: 'bank-1',
    bank_name: 'HDFC Bank'
  }
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  vi.mocked(searchProjectsBeneficiaries).mockReset();
});

describe('ProjectBeneficiarySuggestions — conditional activation via enabled prop', () => {
  it('does NOT fetch or open dropdown when enabled is false, even with 3+ characters', async () => {
    vi.mocked(searchProjectsBeneficiaries).mockResolvedValue({ data: { beneficiaries: [sampleBeneficiary] } });
    render(
      <ProjectBeneficiarySuggestions
        value="Acme"
        enabled={false}
        searchBy="name"
        onChange={vi.fn()}
      />
    );

    fireEvent.focus(screen.getByRole('textbox'));
    await wait(400);

    expect(searchProjectsBeneficiaries).not.toHaveBeenCalled();
    expect(screen.queryByText('Acme Infra Solutions')).not.toBeInTheDocument();
  });

  it('fetches and opens dropdown when enabled is true and prefix >= 3 chars', async () => {
    vi.mocked(searchProjectsBeneficiaries).mockResolvedValue({ data: { beneficiaries: [sampleBeneficiary] } });
    render(
      <ProjectBeneficiarySuggestions
        value="Acm"
        enabled={true}
        searchBy="name"
        primaryField="name"
        onChange={vi.fn()}
      />
    );

    fireEvent.focus(screen.getByRole('textbox'));

    await waitFor(() => {
      expect(searchProjectsBeneficiaries).toHaveBeenCalledWith('Acm', 8, 'name');
    });

    await waitFor(() => {
      expect(screen.getByText('Acme Infra Solutions')).toBeInTheDocument();
      expect(screen.getByText(/A\/C: 9876543210/)).toBeInTheDocument();
    });
  });
});

describe('ProjectBeneficiarySuggestions — selection handling', () => {
  it('calls onSelect with the full beneficiary object and closes the menu', async () => {
    vi.mocked(searchProjectsBeneficiaries).mockResolvedValue({ data: { beneficiaries: [sampleBeneficiary] } });
    const onSelect = vi.fn();

    render(
      <ProjectBeneficiarySuggestions
        value="Acm"
        enabled={true}
        searchBy="name"
        primaryField="name"
        onChange={vi.fn()}
        onSelect={onSelect}
      />
    );

    fireEvent.focus(screen.getByRole('textbox'));

    await waitFor(() => expect(screen.getByText('Acme Infra Solutions')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Acme Infra Solutions'));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(sampleBeneficiary);

    await waitFor(() => {
      expect(screen.queryByText('Acme Infra Solutions')).not.toBeInTheDocument();
    });
  });

  it('supports clearing the selected beneficiary', () => {
    const onClearSelection = vi.fn();
    render(
      <ProjectBeneficiarySuggestions
        value="Acme Infra Solutions"
        enabled={true}
        onChange={vi.fn()}
        onClearSelection={onClearSelection}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clear beneficiary selection' }));
    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });
});
