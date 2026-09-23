import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ZoDashboard from './ZoDashboard';
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
            <MemoryRouter initialEntries={['/analytics/zo']}>
              {ui}
            </MemoryRouter>
          </AuthProvider>
        </ModalProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('ZoDashboard Page Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders authorized direct mount via App with correct heading and controls', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'zo' });

    window.history.pushState({}, 'ZO Analytics', '/analytics/zo');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Zonal Control Room/i })).toBeInTheDocument();
    }, { timeout: 4000 });

    expect(screen.getByText(/Consolidated Zonal Office \(ZO\) KPIs/i)).toBeInTheDocument();
  });

  it('renders dashboard content in standalone provider context', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    renderWithProviders(<ZoDashboard />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Zonal Control Room/i })).toBeInTheDocument();
    }, { timeout: 4000 });
  });

  it('redirects unauthorized JE away from ZO analytics route', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'je' });

    window.history.pushState({}, 'ZO Analytics', '/analytics/zo');
    render(<App />);

    await waitFor(() => {
      expect(screen.queryByRole('heading', { level: 1, name: /Zonal Control Room/i })).not.toBeInTheDocument();
    }, { timeout: 4000 });
  });
});
