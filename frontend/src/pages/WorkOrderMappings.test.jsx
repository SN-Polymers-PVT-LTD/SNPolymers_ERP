import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import WorkOrderMappings from './WorkOrderMappings';
import {
  renderPage,
  assertUrlState,
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
describePageContract(WorkOrderMappings, {
  name: 'WorkOrderMappings',
  route: '/work-order-mappings',
  allowedRoles: ['zo', 'ho', 'admin'],
  unauthorizedRole: 'je',
  headingMatch: /Work Order Mappings/i,
  emptyTextMatch: /No active work order assignments found/i
});

// 2. Layer 3 & Domain Interactions Proof
describe('WorkOrderMappings Page Domain & URL Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiScenario(authApi, { scenario: 'populated' });
  });

  it('renders work order mapping records from populated domain fixture', async () => {
    renderPage(<WorkOrderMappings />, {
      initialUrl: '/work-order-mappings',
      role: 'admin'
    });

    expect(await screen.findByText('WO-101')).toBeInTheDocument();
    expect(screen.getByText('Vikram JE')).toBeInTheDocument();
  });

  it('switches to history tab when button is clicked and writes ?tab=history', async () => {
    const { readLocation } = renderPage(<WorkOrderMappings />, {
      initialUrl: '/work-order-mappings',
      role: 'admin'
    });

    const historyTabBtn = await screen.findByRole('button', { name: /^History$/i });
    fireEvent.click(historyTabBtn);

    await waitFor(() => {
      assertUrlState({ tab: 'history' });
    });
    expect(readLocation()).toContain('tab=history');
  });

  it('opens Assign JE modal when clicking Assign JE to Work Order button', async () => {
    renderPage(<WorkOrderMappings />, {
      initialUrl: '/work-order-mappings',
      role: 'admin'
    });

    const assignBtn = await screen.findByRole('button', { name: /Map JE to Work Order/i });
    fireEvent.click(assignBtn);

    const modalTitles = await screen.findAllByText(/Map JE to Work Order/i);
    expect(modalTitles.length).toBeGreaterThanOrEqual(2);
  });
});
