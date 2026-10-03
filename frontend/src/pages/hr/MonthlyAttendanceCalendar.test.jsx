import React from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MonthlyAttendanceCalendar from './MonthlyAttendanceCalendar';
import { getKolkataCurrentMonth } from '../../utils/dateUtils';
import authApi from '../../api/authApi';

vi.mock('../../api/authApi', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn()
  }
}));

const mockCalendarData = {
  success: true,
  month: '2026-09',
  from_date: '2026-09-01',
  to_date: '2026-09-30',
  days_in_month: 30,
  employee_category: 'SNP Casual Factory Labour',
  sheets: [
    { id: 'sheet-1', attendance_date: '2026-09-01', status: 'Locked', submission_count: 1 },
    { id: 'sheet-2', attendance_date: '2026-09-02', status: 'Locked', submission_count: 1 }
  ],
  employees: [
    { id: 'emp-1', employee_code: 'CAL-001', employee_name: 'Worker Ramesh', active_status: 'Active' },
    { id: 'emp-2', employee_code: 'CAL-002', employee_name: 'Worker Suresh', active_status: 'Inactive' }
  ],
  records: [
    {
      id: 'row-1',
      sheet_id: 'sheet-1',
      sheet_status: 'Locked',
      date: '2026-09-01',
      employee_id: 'emp-1',
      employee_code: 'CAL-001',
      employee_name: 'Worker Ramesh',
      attendance_status: 'Present',
      code: 'P',
      actual_hours: 8.5,
      ot_hours: 0.5,
      duty_type: null,
      holiday_pay_eligible: false,
      entry_timestamp: '2026-09-01T09:00:00+05:30',
      exit_timestamp: '2026-09-01T17:30:00+05:30',
      remarks: 'Normal shift'
    },
    {
      id: 'row-2',
      sheet_id: 'sheet-1',
      sheet_status: 'Locked',
      date: '2026-09-01',
      employee_id: 'emp-2',
      employee_code: 'CAL-002',
      employee_name: 'Worker Suresh',
      attendance_status: 'Compensatory Off',
      code: 'CO',
      actual_hours: 0,
      ot_hours: 0,
      duty_type: null,
      holiday_pay_eligible: false,
      remarks: 'Comp off duty'
    },
    {
      id: 'row-3',
      sheet_id: 'sheet-2',
      sheet_status: 'Locked',
      date: '2026-09-02',
      employee_id: 'emp-1',
      employee_code: 'CAL-001',
      employee_name: 'Worker Ramesh',
      attendance_status: 'Medical Leave',
      code: 'ML',
      actual_hours: 0,
      ot_hours: 0,
      remarks: 'Fever recovery'
    }
  ]
};

function renderCalendar(initialPath = '/factory-attendance/calendar?employee_category=SNP%20Casual%20Factory%20Labour&month=2026-09') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/factory-attendance/calendar" element={<MonthlyAttendanceCalendar />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('MonthlyAttendanceCalendar Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authApi.get.mockResolvedValue({ data: mockCalendarData });
  });

  it('renders the calendar view, legend fact codes, and employee rows', async () => {
    renderCalendar();

    expect(await screen.findByText('Monthly Attendance Calendar')).toBeInTheDocument();
    expect(screen.getByText('P = Present')).toBeInTheDocument();
    expect(screen.getByText('A = Absent')).toBeInTheDocument();
    expect(screen.getByText('ML = Medical Leave')).toBeInTheDocument();
    expect(screen.getByText('CO = Compensatory Off')).toBeInTheDocument();

    // Employees rendered in the table
    expect(await screen.findByText('Worker Ramesh')).toBeInTheDocument();
    expect(screen.getByText('Worker Suresh')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument(); // Suresh is inactive historical employee
  });

  it('displays correct code badges (P, CO, ML) on the respective days', async () => {
    renderCalendar();

    await screen.findByText('Worker Ramesh');

    // Ramesh on day 1 should have code 'P'
    const pBtns = screen.getAllByRole('button', { name: 'P' });
    expect(pBtns.length).toBeGreaterThan(0);

    // Suresh on day 1 should have code 'CO'
    const coBtns = screen.getAllByRole('button', { name: 'CO' });
    expect(coBtns.length).toBeGreaterThan(0);

    // Ramesh on day 2 should have code 'ML'
    const mlBtns = screen.getAllByRole('button', { name: 'ML' });
    expect(mlBtns.length).toBeGreaterThan(0);
  });

  it('clicking a day cell opens modal with stored attendance facts and daily sheet link', async () => {
    renderCalendar();

    await screen.findByText('Worker Ramesh');

    const pBtn = screen.getAllByRole('button', { name: 'P' })[0];
    fireEvent.click(pBtn);

    // Modal details
    expect(await screen.findByText('Attendance Fact Detail: 2026-09-01')).toBeInTheDocument();
    expect(screen.getByText('8.5h')).toBeInTheDocument(); // actual hours
    expect(screen.getByText('0.5h')).toBeInTheDocument(); // ot hours
    expect(screen.getByText('Normal shift')).toBeInTheDocument(); // remarks
    expect(screen.getByText('Locked')).toBeInTheDocument(); // sheet status

    // Link to daily sheet
    const sheetLink = screen.getByText('Open Daily Sheet →');
    expect(sheetLink.getAttribute('href')).toContain('/factory-attendance?date=2026-09-01');

    // Close modal
    const closeBtns = screen.getAllByRole('button', { name: 'Close' });
    fireEvent.click(closeBtns[0]);
    await waitFor(() => {
      expect(screen.queryByText('Attendance Fact Detail: 2026-09-01')).not.toBeInTheDocument();
    });
  });

  it('filters grid rows when search term is typed', async () => {
    renderCalendar();

    await screen.findByText('Worker Ramesh');

    const searchInput = screen.getByPlaceholderText('Search code or name...');
    fireEvent.change(searchInput, { target: { value: 'Suresh' } });

    expect(screen.getByText('Worker Suresh')).toBeInTheDocument();
    expect(screen.queryByText('Worker Ramesh')).not.toBeInTheDocument();
  });
});

 it('filters employee rows while retaining the full employee selector and clears selection on category change', async () => {
    authApi.get.mockResolvedValue({data:mockCalendarData});
    renderCalendar('/factory-attendance/calendar?employee_category=SNP%20Casual%20Factory%20Labour&month=2026-09&employee_id=emp-1');
    await screen.findByText('Worker Ramesh');
    expect(screen.queryByText('Worker Suresh')).not.toBeInTheDocument();
    expect(screen.getByRole('option',{name:/CAL-002 - Worker Suresh/})).toBeInTheDocument();
    fireEvent.change(screen.getAllByRole('combobox')[0],{target:{value:'Local Daily-Wage Workers'}});
    await waitFor(()=>expect(authApi.get).toHaveBeenLastCalledWith('/hr/attendance/calendar',{params:{employee_category:'Local Daily-Wage Workers',month:'2026-09'}}));
 });
 it('shows overnight timestamp dates on finalized locked facts with daily sheet link', async () => {
    const rec = {
      ...mockCalendarData.records[0],
      sheet_status: 'Locked',
      actual_hours: 24,
      entry_timestamp: '2026-09-01T09:00:13+05:30',
      exit_timestamp: '2026-09-02T09:00:13+05:30'
    };
    authApi.get.mockResolvedValue({
      data: {
        ...mockCalendarData,
        sheets: [{ ...mockCalendarData.sheets[0], status: 'Locked' }],
        records: [rec]
      }
    });
    renderCalendar();
    await screen.findByText('Worker Ramesh');
    expect(screen.getByLabelText('Locked')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'P' }));
    expect(screen.getByText(/01.*2026.*09:00:13/)).toBeInTheDocument();
    expect(screen.getByText(/02.*2026.*09:00:13/)).toBeInTheDocument();
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Daily Sheet →' })).toHaveAttribute(
      'href',
      '/factory-attendance?date=2026-09-01&category=SNP%20Casual%20Factory%20Labour'
    );
 });

 it('renders days without a stored sheet with a missing sheet indicator', async () => {
    renderCalendar();
    await screen.findByText('Worker Ramesh');

    // Day 3 has no locked sheet, header has title 'No attendance sheet'
    const unfinalizedHeaders = screen.getAllByTitle('No attendance sheet');
    expect(unfinalizedHeaders.length).toBeGreaterThan(0);
 });

 describe('getKolkataCurrentMonth IST Timezone Derivation', () => {
   it('correctly maps UTC dates across month boundaries to Asia/Kolkata business months', () => {
     // Sep 30 23:30 UTC is Oct 1 05:00 IST -> 2026-10
     expect(getKolkataCurrentMonth(new Date('2026-09-30T23:30:00Z'))).toBe('2026-10');

     // Oct 1 15:30 UTC is Oct 1 21:00 IST -> 2026-10
     expect(getKolkataCurrentMonth(new Date('2026-10-01T15:30:00Z'))).toBe('2026-10');

     // Mar 31 20:00 UTC is Apr 1 01:30 IST -> 2026-04
     expect(getKolkataCurrentMonth(new Date('2026-03-31T20:00:00Z'))).toBe('2026-04');

     // Dec 31 17:00 UTC is Dec 31 22:30 IST -> 2025-12
     expect(getKolkataCurrentMonth(new Date('2025-12-31T17:00:00Z'))).toBe('2025-12');
   });
 });

it('labels provisional sheet states and opens returned attendance for correction', async () => {
  authApi.get.mockResolvedValue({ data: { ...mockCalendarData,
    sheets: [...mockCalendarData.sheets,
      { id: 'draft', attendance_date: '2026-09-03', status: 'Draft' },
      { id: 'submitted', attendance_date: '2026-09-04', status: 'Submitted' },
      { id: 'returned', attendance_date: '2026-09-05', status: 'Returned for Correction' }],
    records: [...mockCalendarData.records, { ...mockCalendarData.records[0], id: 'returned-row',
      sheet_id: 'returned', date: '2026-09-05', sheet_status: 'Returned for Correction' }]
  } });
  renderCalendar();
  expect(await screen.findByLabelText('Draft')).toHaveTextContent('D');
  expect(screen.getByLabelText('Submitted')).toHaveTextContent('S');
  expect(screen.getByLabelText('Returned for Correction')).toHaveTextContent('R');
  fireEvent.click(screen.getByTitle(/2026-09-05.*Returned for Correction/));
  expect(screen.getByRole('link', { name: /Open Daily Sheet/ })).toHaveAttribute('href', expect.stringContaining('date=2026-09-05'));
});

it('shows an unmarked Draft row without inventing attendance facts', async () => {
  authApi.get.mockResolvedValue({ data: { ...mockCalendarData,
    sheets: [{ id: 'sheet-1', attendance_date: '2026-09-01', status: 'Draft' }],
    records: [{ ...mockCalendarData.records[0], sheet_status: 'Draft', attendance_status: null, code: '-', actual_hours: 0, ot_hours: 0 }]
  } });
  renderCalendar();
  fireEvent.click(await screen.findByTitle(/2026-09-01.*Unmarked.*Draft/));
  expect(screen.getByText('- - Unmarked')).toBeInTheDocument();
});
