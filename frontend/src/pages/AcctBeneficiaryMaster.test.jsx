import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import AcctBeneficiaryMaster from './AcctBeneficiaryMaster';
import {
  renderPage,
  describePageContract,
  mockApiScenario
} from '../test';
import authApi from '../api/authApi';

vi.mock('../api/authApi', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    interceptors: { response: { use: vi.fn() } }
  }
}));

// 1. Layer 1 & 2 Page Contract Proof
describePageContract(AcctBeneficiaryMaster, {
  name: 'AcctBeneficiaryMaster',
  route: '/acct-requisitions/beneficiary-master',
  allowedRoles: ['accounts', 'admin'],
  unauthorizedRole: 'je',
  headingMatch: /Beneficiary & Bank Master/i,
  emptyTextMatch: /No matching beneficiaries found/i
});

// 2. Layer 3 & Domain Interactions Proof
describe('AcctBeneficiaryMaster Page Domain & URL Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiScenario(authApi, { scenario: 'populated' });
  });

  it('renders beneficiary records from populated domain fixture', async () => {
    renderPage(<AcctBeneficiaryMaster />, {
      initialUrl: '/acct-requisitions/beneficiary-master',
      role: 'accounts'
    });

    expect(await screen.findByText('National Suppliers Corp')).toBeInTheDocument();
    expect(screen.getByText('123456789012')).toBeInTheDocument();
    expect(screen.getByText('SBIN0001234')).toBeInTheDocument();
  });

  it('switches to Indian Banks tab and displays banks list', async () => {
    renderPage(<AcctBeneficiaryMaster />, {
      initialUrl: '/acct-requisitions/beneficiary-master',
      role: 'accounts'
    });

    const banksTabBtn = await screen.findByRole('button', { name: /^Indian Banks$/i });
    fireEvent.click(banksTabBtn);

    expect(await screen.findByText('State Bank of India')).toBeInTheDocument();
    expect(screen.getByText('HDFC Bank')).toBeInTheDocument();
  });

  it('opens Add Beneficiary modal when clicking + Add Beneficiary button', async () => {
    renderPage(<AcctBeneficiaryMaster />, {
      initialUrl: '/acct-requisitions/beneficiary-master',
      role: 'accounts'
    });

    const addBtn = await screen.findByRole('button', { name: /\+ Add Beneficiary/i });
    fireEvent.click(addBtn);

    expect(await screen.findByRole('heading', { name: /Add Beneficiary/i })).toBeInTheDocument();
  });
});
