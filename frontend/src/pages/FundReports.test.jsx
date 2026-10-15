import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import FundReports from './FundReports';
import {
  renderPage,
  describePageContract,
  mockApiScenario,
  withFakeTimers
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

describe('FundReports Page', () => {
  describePageContract({
    title: 'FundReports Page Contract',
    pageName: 'FundReports',
    PageUnderContract: FundReports,
    route: '/fund-reports',
    routePath: '/fund-reports',
    requiredRole: 'admin',
    headingText: 'Fund Reports',
    emptyScenarioText: 'No active fund reports. Create one to get started.',
    actionControlText: 'New Report',
    initialScenario: {
      fundReports: [
        {
          fund_report_id: 'rep-001',
          report_id: 'rep-001',
          work_order_no: 'WO-101',
          amount: 150000,
          remarks: 'Material purchase tranche',
          created_at: '2026-08-10T10:00:00Z',
          project_name: 'Substation Expansion'
        }
      ]
    },
    emptyScenario: {
      fundReports: []
    }
  });

  it('opens submit report modal on clicking New Report button', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'admin',
      overrides: {
        fundReports: [
          {
            fund_report_id: 'rep-001',
            report_id: 'rep-001',
            work_order_no: 'WO-101',
            amount: 150000,
            remarks: 'Material purchase tranche',
            created_at: '2026-08-10T10:00:00Z',
            project_name: 'Substation Expansion'
          }
        ]
      }
    });

    renderPage(<FundReports />, {
      role: 'admin',
      initialUrl: '/fund-reports',
      routePath: '/fund-reports',
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Fund Reports/i })).toBeInTheDocument();
    });

    const newBtn = screen.getByText('New Report');
    fireEvent.click(newBtn);

    await waitFor(() => {
      expect(screen.getByText('Submit Fund Report')).toBeInTheDocument();
    });
  });
});

describe('FundReports URL State, Aliases, Modals & Debounce', () => {
  it('hydrates legacy search alias, tab, and modal from deep link', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    renderPage(<FundReports />, {
      role: 'admin',
      initialUrl: '/fund-reports?tab=deleted&search=WO-101&modal=create&source=bookmark',
      routePath: '/fund-reports'
    });

    await waitFor(() => {
      expect(screen.getByText('Submit Fund Report')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search reports/i);
    expect(searchInput).toHaveValue('WO-101');
  });

  it('closes create modal while preserving filters and bookmark parameter', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    const { readLocation } = renderPage(<FundReports />, {
      role: 'admin',
      initialUrl: '/fund-reports?q=WO-101&modal=create&source=bookmark',
      routePath: '/fund-reports'
    });

    await waitFor(() => {
      expect(screen.getByText('Submit Fund Report')).toBeInTheDocument();
    });

    const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      const loc = readLocation();
      expect(loc).not.toContain('modal=create');
      expect(loc).toContain('q=WO-101');
      expect(loc).toContain('source=bookmark');
    });
  });

  it('debounces live search input and drops legacy search alias while resetting page', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    await withFakeTimers(async ({ advanceTimers }) => {
      const { readLocation } = renderPage(<FundReports />, {
        role: 'admin',
        initialUrl: '/fund-reports?search=WO-old&page=2',
        routePath: '/fund-reports'
      });

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1, name: /Fund Reports/i })).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(/Search reports/i);
      fireEvent.change(searchInput, { target: { value: 'WO-new' } });

      await act(async () => { advanceTimers(150); });
      expect(readLocation()).not.toContain('q=WO-new');

      await act(async () => { advanceTimers(200); });
      const loc = readLocation();
      expect(loc).toContain('q=WO-new');
      expect(loc).not.toContain('search=WO-old');
      expect(loc).not.toContain('page=2');
    });
  });

  it('handles invalid modal params and negative page safely with modal closed', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    renderPage(<FundReports />, {
      role: 'admin',
      initialUrl: '/fund-reports?modal=invalid_modal_type&page=-10',
      routePath: '/fund-reports'
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Fund Reports/i })).toBeInTheDocument();
    });

    expect(screen.queryByText('Submit Fund Report')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
