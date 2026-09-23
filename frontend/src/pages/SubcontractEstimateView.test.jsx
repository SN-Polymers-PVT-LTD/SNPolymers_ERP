import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import SubcontractEstimateView from './SubcontractEstimateView';
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
describePageContract(SubcontractEstimateView, {
  name: 'SubcontractEstimateView',
  route: '/subcontract-estimates/1',
  routePath: '/subcontract-estimates/:id',
  allowedRoles: ['je', 'zo', 'ho', 'admin'],
  unauthorizedRole: 'accounts',
  headingMatch: /Subcontract Estimate/i
});

// 2. Layer 3 & Domain Interactions Proof
describe('SubcontractEstimateView Page Domain & URL Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiScenario(authApi, { scenario: 'populated' });
  });

  it('renders subcontract estimate details and lines from populated domain fixture', async () => {
    renderPage(<SubcontractEstimateView />, {
      initialUrl: '/subcontract-estimates/1',
      routePath: '/subcontract-estimates/:id',
      role: 'admin'
    });

    const headings = await screen.findAllByText(/Subcontract Estimate/i);
    expect(headings.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Apex Infrastructure Ltd')).toBeInTheDocument();
    expect(screen.getByText('Soil excavation in trenches and foundation')).toBeInTheDocument();
  });
});
