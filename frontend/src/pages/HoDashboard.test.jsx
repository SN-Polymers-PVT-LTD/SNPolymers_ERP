import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import HoDashboard from './HoDashboard';
import App from '../App';
import authApi from '../api/authApi';
import { mockApiScenario, renderPage } from '../test';
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

  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('renders authorized direct mount via App with correct heading and controls', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'ho' });

    window.history.pushState({}, 'HO Analytics', '/analytics/ho');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Portfolio Performance Analytics/i })).toBeInTheDocument();
    }, { timeout: 10000 });

    expect(screen.getByText(/Consolidated portfolio KPIs, zonal performance benchmarking/i)).toBeInTheDocument();
  });

  it('renders controls and triggers refresh action', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    renderWithProviders(<HoDashboard />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Portfolio Performance Analytics/i })).toBeInTheDocument();
    }, { timeout: 4000 });

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
    }, { timeout: 10000 });
  });
});

describe('HoDashboard URL State, Modals & Filters', () => {
  it('hydrates perspective view, date range, and preserves filters when closing zoom modal', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'ho' });

    const { readLocation } = renderPage(<HoDashboard />, {
      role: 'ho',
      initialUrl: '/analytics/ho?view=zo&from=2026-09-01&to=2026-09-30&zone=North&source=bookmark&zoom=physical_progress',
      routePath: '/analytics/ho'
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Portfolio Performance Analytics/i })).toBeInTheDocument();
    });

    // Close zoom modal
    const closeBtn = await screen.findByTitle('Close (ESC)');
    expect(closeBtn).toBeInTheDocument();
    await userEvent.click(closeBtn);

    await waitFor(() => {
      const loc = readLocation();
      expect(loc).not.toContain('zoom=');
      expect(loc).toContain('zone=North');
      expect(loc).toContain('from=2026-09-01');
      expect(loc).toContain('to=2026-09-30');
      expect(loc).toContain('source=bookmark');
    });
  });

  it('handles invalid zoom key safely without crashing', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'ho' });

    renderPage(<HoDashboard />, {
      role: 'ho',
      initialUrl: '/analytics/ho?zoom=nonexistent_chart',
      routePath: '/analytics/ho'
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Portfolio Performance Analytics/i })).toBeInTheDocument();
    });
  });
});
