import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import JeLeaderboard from './JeLeaderboard';
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

describe('JeLeaderboard URL State, Timeframe & Pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hydrates timeframe, legacy search alias, and legacy limit alias from deep link', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    renderPage(<JeLeaderboard />, {
      role: 'admin',
      initialUrl: '/analytics/leaderboard?timeframe=monthly&search=Rohan&limit=10&source=bookmark',
      routePath: '/analytics/leaderboard'
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Junior Engineer Performance Leaderboards/i })).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search engineer/i);
    expect(searchInput).toHaveValue('Rohan');

    const monthlyBtn = screen.getByRole('button', { name: /Monthly/i });
    expect(monthlyBtn).toHaveClass('bg-amber-500');
  });

  it('switches timeframe resetting page and updating URL', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    const { readLocation } = renderPage(<JeLeaderboard />, {
      role: 'admin',
      initialUrl: '/analytics/leaderboard?timeframe=monthly&page=2&source=bookmark',
      routePath: '/analytics/leaderboard'
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Junior Engineer Performance Leaderboards/i })).toBeInTheDocument();
    });

    const allTimeBtn = screen.getByRole('button', { name: /All Time/i });
    fireEvent.click(allTimeBtn);

    await waitFor(() => {
      const loc = readLocation();
      expect(loc).toContain('timeframe=lifetime');
      expect(loc).not.toContain('timeframe=monthly');
      expect(loc).not.toContain('page=2');
      expect(loc).toContain('source=bookmark');
    });
  });

  it('safely falls back on invalid timeframe parameter', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    renderPage(<JeLeaderboard />, {
      role: 'admin',
      initialUrl: '/analytics/leaderboard?timeframe=invalid_tf',
      routePath: '/analytics/leaderboard'
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Junior Engineer Performance Leaderboards/i })).toBeInTheDocument();
    });

    const weeklyBtn = screen.getByRole('button', { name: /Weekly/i });
    expect(weeklyBtn).toHaveClass('bg-amber-500');
  });

  it('resets filters while preserving bookmark', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    const { readLocation } = renderPage(<JeLeaderboard />, {
      role: 'admin',
      initialUrl: '/analytics/leaderboard?timeframe=monthly&q=Rohan&source=bookmark',
      routePath: '/analytics/leaderboard'
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Junior Engineer Performance Leaderboards/i })).toBeInTheDocument();
    });

    const resetBtn = screen.getByRole('button', { name: /Reset Filters/i });
    fireEvent.click(resetBtn);

    await waitFor(() => {
      const loc = readLocation();
      expect(loc).not.toContain('q=');
      expect(loc).not.toContain('timeframe=');
      expect(loc).toContain('source=bookmark');
    });
  });
});
