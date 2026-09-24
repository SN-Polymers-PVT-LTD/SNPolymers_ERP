import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import EstimateView from './EstimateView';
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
describePageContract(EstimateView, {
  name: 'EstimateView',
  route: '/estimates/1',
  routePath: '/estimates/:id',
  allowedRoles: ['staff', 'admin', 'je', 'zo', 'ho', 'accounts'],
  headingMatch: /Estimate Detail Console/i
});

// 2. Layer 3 & Domain Interactions Proof
describe('EstimateView Page Domain & URL Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiScenario(authApi, { scenario: 'populated' });
  });

  it('renders estimate details and line items from populated domain fixture', async () => {
    renderPage(<EstimateView />, {
      initialUrl: '/estimates/1',
      routePath: '/estimates/:id',
      role: 'admin'
    });

    expect(await screen.findByText(/Estimate Detail Console/i)).toBeInTheDocument();
    expect(screen.getByText('EST-101')).toBeInTheDocument();
    expect(screen.getByText('Trench Excavation and Conduit Laying')).toBeInTheDocument();
  });
});
