import authApi from '../api/authApi';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import Requisitions from './Requisitions';
import {
  renderPage,
  describePageContract,
  mockApiScenario,
  readLocation
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
  it('keeps page-2 deep links and pagination until page size changes', async () => {
    const requisitions = Array.from({ length: 12 }, (_, index) => ({
      ...requisitionsFixture[0],
      requisition_id: `req-page-${index + 1}`,
      requisition_no: `REQ-PAGE-${index + 1}`
    }));
    const { readLocation } = renderPage(<Requisitions />, {
      role: 'admin',
      initialUrl: '/requisitions?tab=all&page=2&source=bookmark',
      customWrapper: (children) => <React.StrictMode>{children}</React.StrictMode>,
      overrides: { '/requisitions': { success: true, requisitions } }
    });

    expect(await screen.findByText('REQ-PAGE-11')).toBeInTheDocument();
    expect(screen.queryByText('REQ-PAGE-1')).not.toBeInTheDocument();
    expect(readLocation()).toContain('page=2');
    fireEvent.click(screen.getByRole('button', { name: /^1$/ }));
    await waitFor(() => expect(readLocation()).not.toContain('page='));
    fireEvent.click(screen.getByRole('button', { name: /^2$/ }));
    await waitFor(() => expect(readLocation()).toContain('page=2'));
    expect(screen.getByText('REQ-PAGE-11')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('10 / pg'), { target: { value: '5' } });
    await waitFor(() => {
      expect(readLocation()).not.toContain('page=');
      expect(readLocation()).toContain('source=bookmark');
      expect(screen.getByText('REQ-PAGE-1')).toBeInTheDocument();
    });
  });

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

  it('hydrates legacy search alias and writes canonical q while resetting page', async () => {
    mockApiScenario(authApi, { scenario: 'populated' });

    const { readLocation } = renderPage(<Requisitions />, {
      role: 'admin',
      initialUrl: '/requisitions?tab=all&search=REQ-502&page=2',
      routePath: '/requisitions'
    });

    await waitFor(() => {
      expect(screen.getByText('Requisition Management')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search requisitions/i);
    expect(searchInput).toHaveValue('REQ-502');

    fireEvent.change(searchInput, { target: { value: 'REQ-501' } });

    await waitFor(() => {
      const loc = readLocation();
      expect(loc).toContain('q=REQ-501');
      expect(loc).not.toContain('search=REQ-502');
      expect(loc).not.toContain('page=2');
    });
  });

  it('opens Create Requisition modal from deep link and preserves active tab and bookmark on close', async () => {
    mockApiScenario(authApi, { scenario: 'populated' });

    const { readLocation } = renderPage(<Requisitions />, {
      role: 'admin',
      initialUrl: '/requisitions?tab=approved&create=true&source=bookmark',
      routePath: '/requisitions'
    });

    await waitFor(() => {
      expect(screen.getByText('Create Requisition')).toBeInTheDocument();
    });

    const closeBtn = screen.getByTitle('Close');
    fireEvent.click(closeBtn);

    await waitFor(() => {
      const loc = readLocation();
      expect(loc).not.toContain('create=');
      expect(loc).toContain('tab=approved');
      expect(loc).toContain('source=bookmark');
    });
  });

  it('opens workflow action modal from deep link and closes cleanly', async () => {
    mockApiScenario(authApi, { scenario: 'populated' });

    const { readLocation } = renderPage(<Requisitions />, {
      role: 'admin',
      initialUrl: '/requisitions?tab=pending&req=REQ-501&action=review',
      routePath: '/requisitions'
    });

    await waitFor(() => {
      expect(screen.getByText('Take Workflow Action')).toBeInTheDocument();
    });

    const closeBtn = screen.getByTitle('Close');
    fireEvent.click(closeBtn);

    await waitFor(() => {
      const loc = readLocation();
      expect(loc).not.toContain('action=review');
      expect(loc).not.toContain('req=');
      expect(loc).toContain('tab=pending');
    });
  });

  it('safely handles invalid tab, negative page, and unknown requisition without crashing', async () => {
    mockApiScenario(authApi, { scenario: 'populated' });

    renderPage(<Requisitions />, {
      role: 'admin',
      initialUrl: '/requisitions?tab=invalid_tab&page=-9&req=UNKNOWN_REQ&action=review',
      routePath: '/requisitions'
    });

    await waitFor(() => {
      expect(screen.getByText('Requisition Management')).toBeInTheDocument();
    });

    // Unknown requisition should not render the action modal dialog
    expect(screen.queryByText('Take Workflow Action')).not.toBeInTheDocument();
    // Admin default tab should be 'pending'
    const pendingTabBtn = screen.getByRole('button', { name: /Pending \(/i });
    expect(pendingTabBtn.className).toContain('bg-white/10');
  });
});
