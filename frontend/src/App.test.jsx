import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { unauthenticatedMock } from './test/mocks/authApiMockFactory';
import App from './App';

vi.mock('./api/authApi', () => ({ default: unauthenticatedMock }));

function setAuthenticatedRole(role) {
  unauthenticatedMock.get.mockImplementation((url) => {
    if (url === '/me') {
      return Promise.resolve({
        data: {
          success: true,
          user: { display_name: 'Test Operator', role, mobile_number: '+919876543210' }
        }
      });
    }
    if (url === '/admin/users') return Promise.resolve({ data: { success: true, users: [] } });
    if (url === '/admin/sessions') return Promise.resolve({ data: { success: true, sessions: [] } });
    return Promise.resolve({ data: { success: true, data: [] } });
  });
}

function setUnauthenticated() {
  unauthenticatedMock.get.mockImplementation((url) => {
    if (url === '/me') return Promise.resolve({ data: { success: false, user: null } });
    return Promise.resolve({ data: { success: false } });
  });
}

// Each row is a real BrowserRouter/App/AuthProvider mount.  It proves a URL-state
// page has rendered its own DOM (rather than merely surviving route resolution).
// Keep page-specific data assertions in the page tests; this is the reusable
// route/auth/deep-link contract for every URL-state page.
const urlStateRouteCases = [
  ['profile', 'je', '/profile?tab=appearance', /User Profile/i],
  ['fund reports', 'je', '/fund-reports?status=Submitted&q=WO-1&page=2', /Fund Reports/i],
  ['material master', 'admin', '/materials?q=pipe&main_head=Civil&page=2&modal=create', /Material Master/i],
  ['estimates', 'je', '/estimates?tab=history&status=Final%20Approved&q=WO-1&page=2', /Cost Estimate Sheets/i],
  ['subcontract estimates', 'je', '/subcontract-estimates?tab=history&status=Final%20Approved&q=WO-1&page=2', /Subcontract Estimates/i],
  ['requisitions', 'je', '/requisitions?tab=approved&q=REQ-1&page=2&req=req-1&action=review', /Requisition Management/i],
  ['fund-request create flow', 'zo', '/fund-requests?q=FR-1&page=2&filter=pendingOnly&create=true&wo=WO-1', /Fund Request Management/i],
  ['daily progress', 'je', '/daily-progress?tab=directory&wo=WO-1&search_wo=WO&dept=Projects&page=2&modal=create', /Daily Work Progress/i],
  ['subcontractor ledger', 'je', '/subcontractor-ledger?tab=ledger&wo=WO-1&q=SC&page=2&modal=view&id=entry-1', /Subcontractor Ledger/i],
  ['accounts requisitions', 'accounts', '/acct-requisitions?status=Open&q=SHEET-1&from=2026-09-01&to=2026-09-30&page=2', /Requisition Sheets/i],
  ['accounts HO queue', 'ho', '/acct-requisitions/ho-queue?status=Submitted&q=SHEET-1&from=2026-09-01&to=2026-09-30&page=2', /HO Approval Queue/i],
  ['estimated bills', 'zo', '/estimated-bills?zone=North&wo=WO-1&status=Pending&surety=10&from=2026-09-01&to=2026-09-30&modal=new', /Estimated Bill Module/i],
  ['estimated-bill ledger', 'zo', '/estimated-bills/ledger/WO-1?from=2026-09-01&to=2026-09-30&sort=payment_date&dir=asc&modal=new', /Work Order Ledger Sheet/i],
  ['RA/final bills', 'zo', '/ra-final-bills?tab=directory&wo=WO-1&search=WO&dir_dept=Projects&dir_zone=North&page=2&modal=create&create_wo=WO-1', /RA \/ Final Bill Entry/i],
  ['user mappings', 'zo', '/user-mappings?zo=zo-1&q=JE&page=2', /JE-to-ZO User Mappings/i],
  ['work-order mappings', 'zo', '/work-order-mappings?zo=zo-1&q=WO&page=2', /Work Order Mappings/i],
  ['zonal balances', 'zo', '/zonal-balances?zo=zo-1&q=North&zo_page=2&page=2', /Zonal Office Credit Control/i],
  ['excess fund returns', 'zo', '/excess-fund-returns?status=completed&q=RET-1&modal=action&id=return-1', /Excess Fund Returns/i],
  ['admin panel', 'admin', '/admin?tab=users&q=operator&page=2', /Authorized Access Whitelist/i],
  ['master data', 'admin', '/admin/master-data?tab=projects&q=WO-1&page=2', /Master Data Sheet/i],
  ['purchase options', 'admin', '/admin/purchase-options?tab=categories&q=pipe&page=2', /Purchase Options/i],
  ['HO dashboard', 'ho', '/analytics/ho?from=2026-09-01&to=2026-09-30&zone=North', /Portfolio Performance Analytics/i],
  ['audit compliance', 'ho', '/analytics/audit?q=WO-1&status=open&page=2', /Audit Search Center/i],
  ['ZO dashboard', 'zo', '/analytics/zo?zo=zo-1&from=2026-09-01&to=2026-09-30', /Zonal Control Room/i],
  ['digital twin hub', 'je', '/analytics/digital-twin?q=WO-1&zone=North&page=2', /Project Digital Twin Hub/i],
  ['project digital twin', 'je', '/projects/WO-1/digital-twin?tab=overview&from=2026-09-01&to=2026-09-30', /Digital Twin Monitor/i],
  ['JE leaderboard', 'je', '/analytics/leaderboard?range=month&zone=North', /Junior Engineer Performance Leaderboards/i],
];

describe('App Smoke Tests', () => {
  beforeEach(() => {
    setUnauthenticated();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
  });
  it('renders Home page with expected content at /', () => {
    window.history.pushState({}, '', '/');
    render(<App />);
    expect(screen.getAllByText(/SN Polymers Pvt LTD/i)[0]).toBeInTheDocument();
  });

  it('renders Portal Authentication heading at /login', () => {
    window.history.pushState({}, '', '/login');
    render(<App />);
    expect(screen.getByText(/Portal Authentication/i)).toBeInTheDocument();
  });

  it('redirects unauthenticated user from /dashboard to /login', async () => {
    window.history.pushState({}, '', '/dashboard');
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(/Portal Authentication/i)).toBeInTheDocument();
    });
  });

  it('catch-all redirects unknown paths to /', () => {
    window.history.pushState({}, '', '/this-does-not-exist-at-all');
    render(<App />);
    expect(screen.getAllByText(/SN Polymers Pvt LTD/i)[0]).toBeInTheDocument();
  });

  it('mounts the admin audit-session deep link through the full protected route tree', async () => {
    setAuthenticatedRole('admin');
    window.history.pushState({}, '', '/admin/sessions?status=active&page=2&modal=inspect&sessionId=missing');
    render(<App />);

    expect(await screen.findByText('Session Audit & Integrity Trails', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/admin/sessions');
    expect(window.location.search).toContain('status=active');
    expect(window.location.search).toContain('sessionId=missing');
  });

  it('redirects an authenticated but unauthorized ZO away from the admin audit-session route', async () => {
    setAuthenticatedRole('zo');
    window.history.pushState({}, '', '/admin/sessions?status=active');
    render(<App />);

    await waitFor(() => expect(window.location.pathname).toBe('/dashboard'));
  });

  it.each(urlStateRouteCases)('renders the %s URL-state page DOM through App for the %s role', async (_label, role, url, heading) => {
    setAuthenticatedRole(role);
    window.history.pushState({}, '', url);
    render(<App />);

    await waitFor(() => expect(window.location.pathname + window.location.search).toBe(url));
    expect((await screen.findAllByRole('heading', { name: heading }, { timeout: 4000 })).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Portal Authentication/i)).not.toBeInTheDocument();
  });
});
