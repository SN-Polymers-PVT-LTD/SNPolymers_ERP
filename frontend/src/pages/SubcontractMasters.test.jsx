import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import SubcontractMasters from './SubcontractMasters';
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
describePageContract(SubcontractMasters, {
  name: 'SubcontractMasters',
  route: '/subcontract-masters',
  allowedRoles: ['je', 'zo', 'ho', 'admin'],
  unauthorizedRole: 'accounts',
  headingMatch: /Subcontract Work Master/i,
  emptyTextMatch: /0 records/i,
  expectDom: async (screen) => {
    expect(await screen.findByRole('button', { name: /Subcontract Work Master/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Subcontractor Master/i })).toBeInTheDocument();
  }
});

// 2. Layer 3 & Domain Interactions Proof
describe('SubcontractMasters Page Domain & URL Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiScenario(authApi, { scenario: 'populated' });
  });

  it('renders subcontract works from populated domain fixture on default work tab', async () => {
    renderPage(<SubcontractMasters />, {
      initialUrl: '/subcontract-masters',
      role: 'admin'
    });

    expect(await screen.findByText('Earthwork Excavation')).toBeInTheDocument();
    expect(screen.getByText('RCC Works')).toBeInTheDocument();
  });

  it('switches to subcontractor tab when button is clicked and writes ?tab=subcontractor', async () => {
    const { readLocation } = renderPage(<SubcontractMasters />, {
      initialUrl: '/subcontract-masters',
      role: 'admin'
    });

    const subTabBtn = await screen.findByRole('button', { name: /Subcontractor Master/i });
    fireEvent.click(subTabBtn);

    expect(await screen.findByText('Apex Infrastructure Ltd')).toBeInTheDocument();
    assertUrlState({ tab: 'subcontractor' });
    expect(readLocation()).toContain('tab=subcontractor');
  });

  it('hydrates subcontractor tab directly from deep-link ?tab=subcontractor', async () => {
    renderPage(<SubcontractMasters />, {
      initialUrl: '/subcontract-masters?tab=subcontractor',
      role: 'admin'
    });

    expect(await screen.findByText('Apex Infrastructure Ltd')).toBeInTheDocument();
    expect(screen.getByText('BuildWell Constructions')).toBeInTheDocument();
    assertUrlState({ tab: 'subcontractor' });
  });
});
