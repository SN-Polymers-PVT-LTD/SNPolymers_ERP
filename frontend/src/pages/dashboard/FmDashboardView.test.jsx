import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import FmDashboardView from './FmDashboardView';
import * as hrAttendanceApi from '../../api/hrAttendanceApi';

vi.mock('../../api/hrAttendanceApi');

function renderWithProviders(ui) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false
      }
    }
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        {ui}
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('FmDashboardView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state initially', async () => {
    hrAttendanceApi.getFmAttendanceSummary.mockReturnValue(new Promise(() => {}));

    renderWithProviders(<FmDashboardView />);

    expect(screen.getByRole('status')).toHaveTextContent(/Loading today's roster statuses/i);
    expect(screen.getByText(/Today's Attendance Rosters/i)).toBeInTheDocument();
    expect(screen.getByText(/Master Configuration Hub/i)).toBeInTheDocument();
  });

  it('renders error alert when summary API call fails', async () => {
    hrAttendanceApi.getFmAttendanceSummary.mockRejectedValue(new Error('Network error'));

    renderWithProviders(<FmDashboardView />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Unable to load attendance summary/i);
    });

    // Failed reads must not claim that persisted sheets do not exist.
    expect(screen.getAllByText('Unavailable')).toHaveLength(4);
    expect(screen.queryByText('Not Created')).not.toBeInTheDocument();
    expect(screen.getByText('Fabric Factory Permanent Employees')).toBeInTheDocument();
    expect(screen.getByText('SNP Casual Factory Labour')).toBeInTheDocument();
  });

  it('renders all 4 factory categories with their status and action buttons', async () => {
    hrAttendanceApi.getFmAttendanceSummary.mockResolvedValue({
      data: {
        returned_sheets: [],
        today_sheets: [
          {
            id: 101,
            employee_category: 'Fabric Factory Permanent Employees',
            status: 'Draft',
            submission_count: 1,
            total_ot_hours: 4.5
          },
          {
            id: 102,
            employee_category: 'SNP Casual Factory Labour',
            status: 'Submitted',
            submission_count: 1,
            total_ot_hours: 0
          },
          {
            id: 103,
            employee_category: 'SNP Permanent Factory Labour',
            status: 'Locked',
            submission_count: 2,
            total_ot_hours: 8
          }
          // 'Local Daily-Wage Workers' is omitted to test 'Not Created'
        ]
      }
    });

    renderWithProviders(<FmDashboardView />);

    // Wait until loading indicator disappears
    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    // Fabric Factory Permanent Employees -> Draft
    expect(screen.getByText('Draft in progress · Round 1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Continue Entry/i })).toHaveAttribute(
      'href',
      expect.stringContaining('/factory-attendance?category=Fabric%20Factory%20Permanent%20Employees')
    );
    expect(screen.getByText('OT: 4.50h')).toBeInTheDocument();

    // SNP Casual Factory Labour -> Submitted
    expect(screen.getByText('Submitted to Head Office for review.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View Submission/i })).toBeInTheDocument();

    // SNP Permanent Factory Labour -> Locked
    expect(screen.getByText('Locked & verified by Head Office.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View Locked/i })).toBeInTheDocument();

    // Local Daily-Wage Workers -> Not Created
    expect(screen.getByText('No attendance sheet initiated for today.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Start Roster/i })).toBeInTheDocument();

    // No returned alert when returned_sheets is empty
    expect(screen.queryByLabelText(/Returned Sheets Alert/i)).not.toBeInTheDocument();
  });

  it('renders high-priority returned sheets banner when returned sheets exist', async () => {
    hrAttendanceApi.getFmAttendanceSummary.mockResolvedValue({
      data: {
        returned_sheets: [
          {
            id: 99,
            attendance_date: '2026-09-28',
            employee_category: 'Local Daily-Wage Workers',
            status: 'Returned for Correction',
            submission_count: 2,
            return_remarks: 'Discrepancy in OT hours for Line 3 workers. Please verify.'
          }
        ],
        today_sheets: []
      }
    });

    renderWithProviders(<FmDashboardView />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Returned Sheets Alert/i)).toBeInTheDocument();
    });

    const alertSection = screen.getByLabelText(/Returned Sheets Alert/i);
    expect(within(alertSection).getByRole('heading', { level: 2, name: /Action Required: 1 Sheet\(s\) Returned by Head Office/i })).toBeInTheDocument();
    expect(within(alertSection).getByText('Local Daily-Wage Workers')).toBeInTheDocument();
    expect(within(alertSection).getByText(/Duty Date: 2026-09-28/i)).toBeInTheDocument();
    expect(within(alertSection).getByText(/Discrepancy in OT hours for Line 3 workers\. Please verify\./i)).toBeInTheDocument();

    const correctLink = within(alertSection).getByRole('link', { name: /Correct & Resubmit/i });
    expect(correctLink).toHaveAttribute(
      'href',
      '/factory-attendance?category=Local%20Daily-Wage%20Workers&date=2026-09-28'
    );
  });

  it('renders master configuration hub with links to Daily Wage Master and Attendance Rules', async () => {
    hrAttendanceApi.getFmAttendanceSummary.mockResolvedValue({
      data: {
        returned_sheets: [],
        today_sheets: []
      }
    });

    renderWithProviders(<FmDashboardView />);

    await waitFor(() => {
      expect(screen.getByText('Daily Wage Master')).toBeInTheDocument();
    });

    const wageMasterLink = screen.getByRole('link', { name: /Daily Wage Master/i });
    expect(wageMasterLink).toHaveAttribute('href', '/factory-masters?tab=wages');

    const payRulesLink = screen.getByRole('link', { name: /Attendance & Pay Rules/i });
    expect(payRulesLink).toHaveAttribute('href', '/factory-masters?tab=rules');
  });

  it('calls refetch when Refresh Status button is clicked', async () => {
    const user = userEvent.setup();
    hrAttendanceApi.getFmAttendanceSummary.mockResolvedValue({
      data: {
        returned_sheets: [],
        today_sheets: []
      }
    });

    renderWithProviders(<FmDashboardView />);

    await waitFor(() => {
      expect(screen.getByText(/Today's Attendance Rosters/i)).toBeInTheDocument();
    });

    expect(hrAttendanceApi.getFmAttendanceSummary).toHaveBeenCalledTimes(1);

    const refreshBtn = screen.getByRole('button', { name: /Refresh Status/i });
    await user.click(refreshBtn);

    expect(hrAttendanceApi.getFmAttendanceSummary).toHaveBeenCalledTimes(2);
  });
});
