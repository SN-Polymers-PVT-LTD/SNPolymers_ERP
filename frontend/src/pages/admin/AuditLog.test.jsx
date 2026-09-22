import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AuditLog from './AuditLog';
import { ModalProvider } from '../../components/ModalContext';

const mockUsers = [
  { id: 'usr_1', display_name: 'Alice Officer', mobile_number: '9876543210', role: 'zo' },
  { id: 'usr_2', display_name: 'Bob Admin', mobile_number: '9123456780', role: 'admin' },
];

const mockSessions = [
  {
    id: 'sess_1',
    user_id: 'usr_1',
    login_at: '2026-09-22T08:00:00.000Z',
    logout_at: null,
    is_active: true,
    duration_seconds: null,
    ip_address: '192.168.1.10',
    user_agent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    authorised_users: {
      display_name: 'Alice Officer',
      mobile_number: '9876543210',
      role: 'zo'
    }
  },
  {
    id: 'sess_2',
    user_id: 'usr_2',
    login_at: '2026-09-21T10:00:00.000Z',
    logout_at: '2026-09-21T12:30:00.000Z',
    is_active: false,
    duration_seconds: 9000,
    ip_address: '10.0.0.5',
    user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/122.0',
    authorised_users: {
      display_name: 'Bob Admin',
      mobile_number: '9123456780',
      role: 'admin'
    }
  }
];

vi.mock('../../api/authApi', () => ({
  default: {
    get: vi.fn((url) => {
      if (url === '/admin/users') {
        return Promise.resolve({ data: { success: true, users: mockUsers } });
      }
      if (url === '/admin/sessions') {
        return Promise.resolve({ data: { success: true, sessions: mockSessions } });
      }
      return Promise.resolve({ data: { success: true } });
    })
  }
}));

const renderAuditLog = (initialEntry = '/admin/sessions') => {
  return render(
    <ModalProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/admin/sessions" element={<AuditLog />} />
        </Routes>
      </MemoryRouter>
    </ModalProvider>
  );
};

describe('AuditLog Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders header, quick KPIs, and loads sessions table', async () => {
    renderAuditLog('/admin/sessions');

    expect(screen.getByText('Session Audit & Integrity Trails')).toBeInTheDocument();
    expect(screen.getByText('Console Verification Ledger')).toBeInTheDocument();

    // Verify session data rendered
    expect(await screen.findByText('Alice Officer')).toBeInTheDocument();
    expect(screen.getByText('Bob Admin')).toBeInTheDocument();
    expect(screen.getByText('192.168.1.10')).toBeInTheDocument();
    expect(screen.getByText('10.0.0.5')).toBeInTheDocument();

    // Verify KPIs
    expect(screen.getByText('Total Logged')).toBeInTheDocument();
    expect(screen.getByText('Active Now')).toBeInTheDocument();
  });

  it('filters by status when clicking Active Only or Terminated pills', async () => {
    renderAuditLog('/admin/sessions');

    expect(await screen.findByText('Alice Officer')).toBeInTheDocument();
    expect(screen.getByText('Bob Admin')).toBeInTheDocument();

    // Click Active Only
    const activeBtn = screen.getByRole('button', { name: 'Active Only' });
    fireEvent.click(activeBtn);

    // Only active session (Alice) should show
    expect(screen.getByText('Alice Officer')).toBeInTheDocument();
    expect(screen.queryByText('Bob Admin')).not.toBeInTheDocument();

    // Click Terminated
    const terminatedBtn = screen.getByRole('button', { name: 'Terminated' });
    fireEvent.click(terminatedBtn);

    // Only terminated session (Bob) should show
    expect(screen.getByText('Bob Admin')).toBeInTheDocument();
    expect(screen.queryByText('Alice Officer')).not.toBeInTheDocument();
  });

  it('filters live when typing in the search box', async () => {
    renderAuditLog('/admin/sessions');

    expect(await screen.findByText('Alice Officer')).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText(/Search Operator, Mobile, IP, or Browser/i);
    fireEvent.change(searchInput, { target: { value: 'Firefox' } });

    // Bob Admin is on Firefox, Alice is on Chrome
    expect(screen.getByText('Bob Admin')).toBeInTheDocument();
    expect(screen.queryByText('Alice Officer')).not.toBeInTheDocument();
  });

  it('opens inspect modal on clicking Inspect button and closes cleanly', async () => {
    renderAuditLog('/admin/sessions');

    expect(await screen.findByText('Alice Officer')).toBeInTheDocument();

    const inspectButtons = screen.getAllByRole('button', { name: /Inspect/i });
    fireEvent.click(inspectButtons[0]);

    // Inspect modal should open
    expect(await screen.findByText('Session Integrity & Network Telemetry')).toBeInTheDocument();
    expect(screen.getByText('Session ID: sess_1')).toBeInTheDocument();
    expect(screen.getByText('Origin IP Address')).toBeInTheDocument();
    expect(screen.getAllByText('192.168.1.10').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Mozilla\/5\.0/).length).toBeGreaterThanOrEqual(1);

    // Close modal
    const closeBtn = screen.getByRole('button', { name: /Close Telemetry/i });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByText('Session ID: sess_1')).not.toBeInTheDocument();
    });
  });

  it('opens inspect modal immediately when deep linked with ?modal=inspect&sessionId=sess_2', async () => {
    renderAuditLog('/admin/sessions?modal=inspect&sessionId=sess_2');

    expect(await screen.findByText('Session Integrity & Network Telemetry')).toBeInTheDocument();
    expect(screen.getByText('Session ID: sess_2')).toBeInTheDocument();
    expect(screen.getByText('Origin IP Address')).toBeInTheDocument();
    expect(screen.getAllByText('10.0.0.5').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Firefox\/122\.0/).length).toBeGreaterThanOrEqual(1);
  });
});
