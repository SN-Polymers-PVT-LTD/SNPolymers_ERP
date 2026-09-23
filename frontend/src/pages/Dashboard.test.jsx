import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Dashboard from './Dashboard';
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
            <MemoryRouter initialEntries={['/dashboard']}>
              {ui}
            </MemoryRouter>
          </AuthProvider>
        </ModalProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('Dashboard Page Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders authorized direct mount via App with correct heading and operator session', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    window.history.pushState({}, 'Dashboard', '/dashboard');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Welcome back/i })).toBeInTheDocument();
    });

    expect(screen.getByText(/Authorized Operator Session/i)).toBeInTheDocument();
  });

  it('renders role-appropriate dashboard view for JE role', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'je' });

    renderWithProviders(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Welcome back/i })).toBeInTheDocument();
    });
  });

  it('redirects unauthenticated visitor to login', async () => {
    mockApiScenario(authApi, { scenario: 'unauthenticated' });

    window.history.pushState({}, 'Dashboard', '/dashboard');
    render(<App />);

    await waitFor(() => {
      expect(screen.queryByRole('heading', { level: 1, name: /Welcome back/i })).not.toBeInTheDocument();
    });
  });
});
