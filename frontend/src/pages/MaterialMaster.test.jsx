import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import MaterialMaster from './MaterialMaster';
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
describePageContract(MaterialMaster, {
  name: 'MaterialMaster',
  route: '/materials',
  allowedRoles: ['admin', 'je'],
  headingMatch: /Material Master/i,
  emptyTextMatch: /No materials found matching criteria/i,
  errorTextMatch: /Server unavailable|Failed to load/i
});

// 2. Layer 3 & Domain Interactions Proof
describe('MaterialMaster Page Domain & URL Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiScenario(authApi, { scenario: 'populated' });
  });

  it('renders material records from populated domain fixture', async () => {
    renderPage(<MaterialMaster />, {
      initialUrl: '/materials',
      role: 'admin'
    });

    expect(await screen.findByText('Portland Pozzolana Cement Grade 53')).toBeInTheDocument();
    expect(screen.getByText('4-Core 16 sq mm Armoured Copper Cable')).toBeInTheDocument();
    expect(screen.getByText('110mm PVC Drainage Pipe Class 4')).toBeInTheDocument();
  });

  it('hydrates filter and search deep-links into inputs and URL state', async () => {
    const { readLocation } = renderPage(<MaterialMaster />, {
      initialUrl: '/materials?q=Copper&main_head=Electrical&page=1',
      role: 'admin'
    });

    expect(await screen.findByDisplayValue('Copper')).toBeInTheDocument();
    assertUrlState({ q: 'Copper', main_head: 'Electrical' });
    expect(readLocation()).toContain('q=Copper');
  });

  it('opens Create Material modal when deep-linked with ?modal=create', async () => {
    renderPage(<MaterialMaster />, {
      initialUrl: '/materials?modal=create',
      role: 'admin'
    });

    expect(await screen.findByText('Create Material Record')).toBeInTheDocument();
    expect(screen.getByText('Add New Catalog Entry')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create Record/i })).toBeInTheDocument();
  });
});
