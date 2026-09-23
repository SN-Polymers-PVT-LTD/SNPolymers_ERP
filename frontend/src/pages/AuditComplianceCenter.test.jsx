import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AuditComplianceCenter from './AuditComplianceCenter';
import App from '../App';
import authApi from '../api/authApi';
import { mockApiScenario } from '../test/mocks/mockApiScenario';
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
