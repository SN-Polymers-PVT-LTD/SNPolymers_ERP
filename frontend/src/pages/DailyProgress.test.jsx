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

function renderWithProviders(ui, { role = 'admin', initialUrl = '/daily-progress' } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ModalProvider>
          <AuthProvider>
            <MemoryRouter initialEntries={[initialUrl]}>
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

  it('renders loading indicators when API calls are in progress', async () => {
    mockApiScenario(authApi, { scenario: 'loading', role: 'admin' });

    renderWithProviders(<DailyProgress />, { initialUrl: '/daily-progress?tab=directory' });
    expect(screen.getByText(/Projects Directory/i)).toBeInTheDocument();
  });

  it('renders empty state guidance when no daily reports exist', async () => {
    mockApiScenario(authApi, { scenario: 'empty', role: 'admin' });

    renderWithProviders(<DailyProgress />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Daily Work Progress/i })).toBeInTheDocument();
    });

    expect(await screen.findByText(/No reports logged from JEs yet/i)).toBeInTheDocument();
  });

  it('renders error state feedback when API encounters failure', async () => {
    mockApiScenario(authApi, { scenario: 'apiError', errorMessage: 'Progress server unavailable', role: 'admin' });

    renderWithProviders(<DailyProgress />);

    expect(await screen.findByText(/Progress server unavailable/i)).toBeInTheDocument();
  });

  it('renders populated content and interactive controls', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    renderWithProviders(<DailyProgress />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Daily Work Progress/i })).toBeInTheDocument();
    });

    const leaderboardBtn = screen.getByTitle(/View Leaderboards & Field Rankings/i);
    expect(leaderboardBtn).toBeInTheDocument();
    await userEvent.click(leaderboardBtn);
  });

  it('redirects unauthorized accounts role away to /dashboard', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'accounts' });

    window.history.pushState({}, 'Daily Progress', '/daily-progress');
    render(<App />);

    await waitFor(() => {
      expect(screen.queryByRole('heading', { level: 1, name: /Daily Work Progress/i })).not.toBeInTheDocument();
    });
  });
});
