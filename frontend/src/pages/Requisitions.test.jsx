import authApi from '../api/authApi';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import Requisitions from './Requisitions';
import {
  renderPage,
  describePageContract,
  mockApiScenario,
  readLocation,
  assertUrlParams
} from '../test';
import { requisitionsFixture, projectsFixture } from '../test/fixtures/domainFixtures';

vi.mock('../api/authApi');

describe('Requisitions Page', () => {
  describePageContract({
    title: 'Requisitions Page Contract',
    pageName: 'Requisitions',
    PageUnderContract: Requisitions,
    route: '/requisitions',
    routePath: '/requisitions',
    requiredRole: 'operator',
    headingText: 'Requisition Management',
    emptyScenarioText: 'No requisitions matching parameters.',
    actionControlText: 'New Requisition',
    initialScenario: {
      requisitions: requisitionsFixture,
      projects: projectsFixture,
    },
    emptyScenario: {
      requisitions: [],
      projects: [],
    },
  });

  it('allows filtering by tab', async () => {
    mockApiScenario(authApi, {
      scenario: "populated"
    });

    renderPage(<Requisitions />, {
      role: 'admin',
      route: '/requisitions',
      routePath: '/requisitions',
    });

    await waitFor(() => {
      expect(screen.getByText('Requisition Management')).toBeInTheDocument();
    });

    const approvedTabBtn = await screen.findByRole('button', { name: /Approved \(/i });
    fireEvent.click(approvedTabBtn);

    await waitFor(() => {
      expect(screen.getByText('REQ-502')).toBeInTheDocument();
    });
  });
});

describe('Requisitions URL State Hydration & Canonical Writes', () => {
  it('visibly hydrates active tab and search input from deep link', async () => {
    mockApiScenario(authApi, {
      scenario: "populated"
    });

    renderPage(<Requisitions />, {
      role: 'admin',
      initialUrl: '/requisitions?tab=approved&q=REQ-502',
      routePath: '/requisitions'
    });

    await waitFor(() => {
      expect(screen.getByText('Requisition Management')).toBeInTheDocument();
    });

    const approvedBtn = screen.getByRole('button', { name: /Approved \(/i });
    expect(approvedBtn.className).toContain('bg-white/10');

    const searchInput = screen.getByPlaceholderText(/Search requisitions/i);
    expect(searchInput).toHaveValue('REQ-502');

    await waitFor(() => {
      expect(screen.getByText('REQ-502')).toBeInTheDocument();
    });
  });

  it('interactively writes canonical tab parameter to URL', async () => {
    mockApiScenario(authApi, {
      scenario: "populated"
    });

    renderPage(<Requisitions />, {
      role: 'admin',
      initialUrl: '/requisitions?tab=approved',
      routePath: '/requisitions'
    });

    await waitFor(() => {
      expect(screen.getByText('Requisition Management')).toBeInTheDocument();
    });

    const holdBtn = screen.getByRole('button', { name: /Hold \/ Rejected \(/i });
    fireEvent.click(holdBtn);

    await waitFor(() => {
      expect(readLocation()).toContain('tab=hold');
    });
  });
});
