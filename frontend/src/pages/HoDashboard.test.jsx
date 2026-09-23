import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import HoDashboard from './HoDashboard';
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
            <MemoryRouter initialEntries={['/analytics/ho']}>
              {ui}
            </MemoryRouter>
          </AuthProvider>
        </ModalProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('HoDashboard Page Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders authorized direct mount via App with correct heading and controls', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'ho' });

    window.history.pushState({}, 'HO Analytics', '/analytics/ho');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Portfolio Performance Analytics/i })).toBeInTheDocument();
    });

    expect(screen.getByText(/Consolidated portfolio KPIs, zonal performance benchmarking/i)).toBeInTheDocument();
  });

  it('renders controls and triggers refresh action', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    renderWithProviders(<HoDashboard />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Portfolio Performance Analytics/i })).toBeInTheDocument();
    });

    const refreshBtn = screen.getByRole('button', { name: /Refresh Views/i });
    expect(refreshBtn).toBeInTheDocument();
    await userEvent.click(refreshBtn);
  });

  it('redirects unauthorized JE away from HO analytics route', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'je' });

    window.history.pushState({}, 'HO Analytics', '/analytics/ho');
    render(<App />);

    await waitFor(() => {
      expect(screen.queryByRole('heading', { level: 1, name: /Portfolio Performance Analytics/i })).not.toBeInTheDocument();
    });
  });
});
