import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import DigitalTwinHub from './DigitalTwinHub';
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
            <MemoryRouter initialEntries={['/analytics/digital-twin']}>
              {ui}
            </MemoryRouter>
          </AuthProvider>
        </ModalProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('DigitalTwinHub Page Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders authorized direct mount via App with correct heading and controls', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'ho' });

    window.history.pushState({}, 'Digital Twin Hub', '/analytics/digital-twin');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Project Digital Twin Hub/i })).toBeInTheDocument();
    }, { timeout: 4000 });

    expect(screen.getByText(/Regional Portfolios/i)).toBeInTheDocument();
  });

  it('renders controls and interacts with project search input', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    renderWithProviders(<DigitalTwinHub />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Project Digital Twin Hub/i })).toBeInTheDocument();
    }, { timeout: 4000 });

    const searchInput = screen.getByPlaceholderText(/Search by work order no, site, district/i);
    expect(searchInput).toBeInTheDocument();
    await userEvent.type(searchInput, 'WO-101');
  });

  it('redirects unauthorized accounts role away from digital twin hub route', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'accounts' });

    window.history.pushState({}, 'Digital Twin Hub', '/analytics/digital-twin');
    render(<App />);

    await waitFor(() => {
      expect(screen.queryByRole('heading', { level: 1, name: /Project Digital Twin Hub/i })).not.toBeInTheDocument();
    }, { timeout: 4000 });
  });
});
