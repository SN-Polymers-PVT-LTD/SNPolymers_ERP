import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AdminPanel from './AdminPanel';
import App from '../../App';
import authApi from '../../api/authApi';
import { mockApiScenario } from '../../test/mocks/mockApiScenario';
import { AuthProvider } from '../../components/AuthContext';
import { ModalProvider } from '../../components/ModalContext';
import { ThemeProvider } from '../../components/ThemeContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../api/authApi');

function renderWithProviders(ui) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ModalProvider>
          <AuthProvider>
            <MemoryRouter initialEntries={['/admin']}>
              {ui}
            </MemoryRouter>
          </AuthProvider>
        </ModalProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('AdminPanel Page Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders authorized direct mount via App with correct heading and controls', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    window.history.pushState({}, 'Admin Panel', '/admin');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Authorized Access Whitelist/i })).toBeInTheDocument();
    });

    expect(screen.getByText(/Console System Policies/i)).toBeInTheDocument();
  });

  it('renders controls and interacts with add account modal trigger', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    renderWithProviders(<AdminPanel />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Authorized Access Whitelist/i })).toBeInTheDocument();
    });

    const addBtn = screen.getByRole('button', { name: /Authorize User Credentials/i });
    expect(addBtn).toBeInTheDocument();
    await userEvent.click(addBtn);

    expect(screen.getByText(/Authorize New Account/i)).toBeInTheDocument();
  });

  it('redirects unauthorized JE away from /admin route', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'je' });

    window.history.pushState({}, 'Admin Panel', '/admin');
    render(<App />);

    await waitFor(() => {
      expect(screen.queryByRole('heading', { level: 1, name: /Authorized Access Whitelist/i })).not.toBeInTheDocument();
    });
  });
});
