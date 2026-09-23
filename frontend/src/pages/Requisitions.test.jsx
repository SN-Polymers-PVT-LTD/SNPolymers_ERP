import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import Requisitions from './Requisitions';
import {
  renderPage,
  describePageContract,
  mockApiScenario
} from '../test';
import { requisitionsFixture, projectsFixture } from '../test/fixtures/domainFixtures';

vi.mock('../services/api', async () => {
  const actual = await vi.importActual('../test/mocks/mockApiScenario');
  return {
    default: actual.mockAxios,
    api: actual.mockAxios,
  };
});

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
    mockApiScenario({
      requisitions: requisitionsFixture,
      projects: projectsFixture,
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
