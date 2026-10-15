import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AuditComplianceCenter from './AuditComplianceCenter';
import App from '../App';
import authApi from '../api/authApi';
import { mockApiScenario } from '../test/mocks/mockApiScenario';
import { renderPage } from '../test';
import { AuthProvider } from '../components/AuthContext';
import { ModalProvider } from '../components/ModalContext';
import { ThemeProvider } from '../components/ThemeContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../api/authApi');

function renderWithProviders(ui) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ModalProvider>
          <AuthProvider>
            <MemoryRouter initialEntries={['/analytics/audit']}>
              {ui}
            </MemoryRouter>
          </AuthProvider>
        </ModalProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('AuditComplianceCenter Page Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders authorized direct mount via App with correct heading and controls', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'ho' });

    window.history.pushState({}, 'Audit Center', '/analytics/audit');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Audit Search Center/i })).toBeInTheDocument();
    }, { timeout: 4000 });

    expect(screen.getByText(/Security & Compliance Log/i)).toBeInTheDocument();
  });

  it('renders controls and filters audit logs', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    renderWithProviders(<AuditComplianceCenter />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Audit Search Center/i })).toBeInTheDocument();
    }, { timeout: 4000 });

    const searchInput = screen.getByPlaceholderText(/e\.g\. ZO_USER/i);
    expect(searchInput).toBeInTheDocument();
    await userEvent.type(searchInput, 'admin');

    const filterBtn = screen.getByRole('button', { name: /Filter Ledger/i });
    expect(filterBtn).toBeInTheDocument();
    await userEvent.click(filterBtn);
  });

  it('redirects unauthorized JE away from audit analytics route', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'je' });

    window.history.pushState({}, 'Audit Center', '/analytics/audit');
    render(<App />);

    await waitFor(() => {
      expect(screen.queryByRole('heading', { level: 1, name: /Audit Search Center/i })).not.toBeInTheDocument();
    }, { timeout: 4000 });
  });
});

describe('AuditComplianceCenter URL State, Filters & Pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hydrates module, user_id, record, and page from deep link', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    renderPage(<AuditComplianceCenter />, {
      role: 'admin',
      initialUrl: '/analytics/audit?module=Requisitions&user_id=usr_12&record=REQ-001&page=2&source=bookmark',
      routePath: '/analytics/audit'
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Audit Search Center/i })).toBeInTheDocument();
    });

    expect(screen.getByDisplayValue('usr_12')).toBeInTheDocument();
    expect(screen.getByDisplayValue('REQ-001')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Requisitions')).toBeInTheDocument();
  });

  it('clears filters while preserving bookmark parameter', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    const { readLocation } = renderPage(<AuditComplianceCenter />, {
      role: 'admin',
      initialUrl: '/analytics/audit?module=Requisitions&user_id=usr_12&record=REQ-001&source=bookmark',
      routePath: '/analytics/audit'
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Audit Search Center/i })).toBeInTheDocument();
    });

    const clearBtn = screen.getByRole('button', { name: /Clear/i });
    fireEvent.click(clearBtn);

    await waitFor(() => {
      const loc = readLocation();
      expect(loc).not.toContain('module=');
      expect(loc).not.toContain('user_id=');
      expect(loc).not.toContain('record=');
      expect(loc).toContain('source=bookmark');
    });
  });

  it('safely falls back to page 1 on invalid page parameter', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    renderPage(<AuditComplianceCenter />, {
      role: 'admin',
      initialUrl: '/analytics/audit?page=-5',
      routePath: '/analytics/audit'
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Audit Search Center/i })).toBeInTheDocument();
    });

    expect(screen.getByText(/Security & Compliance Log/i)).toBeInTheDocument();
  });
});
