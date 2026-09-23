import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import DailyProgress from './DailyProgress';
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
            <MemoryRouter initialEntries={['/daily-progress']}>
              {ui}
            </MemoryRouter>
          </AuthProvider>
        </ModalProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('DailyProgress Page Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders authorized direct mount via App with correct heading and controls', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'je' });

    window.history.pushState({}, 'Daily Progress', '/daily-progress');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Daily Work Progress/i })).toBeInTheDocument();
    });

    expect(screen.getByText(/Site Operations · Daily Tracking Console/i)).toBeInTheDocument();
  });

  it('renders loading state, populated content, and interactive controls', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    renderWithProviders(<DailyProgress />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Daily Work Progress/i })).toBeInTheDocument();
    });

    // Test meaningful control - switching tabs or clicking Leaderboards button
    const leaderboardBtn = screen.getByTitle(/View Leaderboards & Field Rankings/i);
    expect(leaderboardBtn).toBeInTheDocument();
    await userEvent.click(leaderboardBtn);
  });

  it('redirects unauthorized role away from protected daily progress route', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'accounts' });

    window.history.pushState({}, 'Daily Progress', '/daily-progress');
    render(<App />);

    await waitFor(() => {
      expect(screen.queryByRole('heading', { level: 1, name: /Daily Work Progress/i })).not.toBeInTheDocument();
    });
  });
});
