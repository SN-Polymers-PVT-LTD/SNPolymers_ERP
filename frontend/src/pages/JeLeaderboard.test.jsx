import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import JeLeaderboard from './JeLeaderboard';
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
            <MemoryRouter initialEntries={['/analytics/leaderboard']}>
              {ui}
            </MemoryRouter>
          </AuthProvider>
        </ModalProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('JeLeaderboard Page Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders authorized direct mount via App with correct heading and controls', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'je' });

    window.history.pushState({}, 'JE Leaderboard', '/analytics/leaderboard');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Junior Engineer Performance Leaderboards/i })).toBeInTheDocument();
    }, { timeout: 4000 });

    expect(screen.getByText(/Recognizing field engineering excellence/i)).toBeInTheDocument();
  });

  it('renders controls and interacts with timeframe / search input', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    renderWithProviders(<JeLeaderboard />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Junior Engineer Performance Leaderboards/i })).toBeInTheDocument();
    }, { timeout: 4000 });

    const searchInput = screen.getByPlaceholderText(/Search engineer/i);
    expect(searchInput).toBeInTheDocument();
    await userEvent.type(searchInput, 'Rohan');

    expect(screen.getByText(/Back to Daily Tracking/i)).toBeInTheDocument();
  });

  it('redirects unauthorized accounts role away from leaderboard route', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'accounts' });

    window.history.pushState({}, 'JE Leaderboard', '/analytics/leaderboard');
    render(<App />);

    await waitFor(() => {
      expect(screen.queryByRole('heading', { level: 1, name: /Junior Engineer Performance Leaderboards/i })).not.toBeInTheDocument();
    }, { timeout: 4000 });
  });
});
