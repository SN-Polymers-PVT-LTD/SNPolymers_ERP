import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import FundReports from './FundReports';
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
