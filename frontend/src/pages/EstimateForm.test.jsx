import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import EstimateForm from './EstimateForm';
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
describePageContract(EstimateForm, {
  name: 'EstimateForm',
  route: '/estimates/new',
  allowedRoles: ['staff', 'admin', 'je', 'zo', 'ho', 'accounts'],
  headingMatch: /New Cost Estimate/i
});

// 2. Layer 3 & Domain Interactions Proof
describe('EstimateForm Page Domain & URL Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiScenario(authApi, { scenario: 'populated' });
  });

  it('renders estimate creation form with work order select dropdown', async () => {
    renderPage(<EstimateForm />, {
      initialUrl: '/estimates/new',
      role: 'admin'
    });

    expect(await screen.findByText(/New Cost Estimate/i)).toBeInTheDocument();
    expect(screen.getByText(/Estimate Header/i)).toBeInTheDocument();
    expect(screen.getByText(/Select Work Order/i)).toBeInTheDocument();
  });
});
