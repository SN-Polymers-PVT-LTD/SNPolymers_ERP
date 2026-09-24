import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ZoDashboard from './ZoDashboard';
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

describe('ZoDashboard URL State, Modals & Filters', () => {
  it('hydrates date range, ZO filter, and preserves filters when closing zoom modal', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    const { readLocation } = renderPage(<ZoDashboard />, {
      role: 'admin',
      initialUrl: '/analytics/zo?from=2026-09-01&to=2026-09-30&zo=zo-1&source=bookmark&zoom=physical_progress',
      routePath: '/analytics/zo'
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Zonal Control Room/i })).toBeInTheDocument();
    });

    // Close zoom modal
    const closeBtn = await screen.findByTitle('Close (ESC)');
    expect(closeBtn).toBeInTheDocument();
    await userEvent.click(closeBtn);

    await waitFor(() => {
      const loc = readLocation();
      expect(loc).not.toContain('zoom=');
      expect(loc).toContain('from=2026-09-01');
      expect(loc).toContain('to=2026-09-30');
      expect(loc).toContain('zo=zo-1');
      expect(loc).toContain('source=bookmark');
    });
  });

  it('handles invalid zoom key safely without crashing', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'zo' });

    renderPage(<ZoDashboard />, {
      role: 'zo',
      initialUrl: '/analytics/zo?zoom=invalid_chart_key',
      routePath: '/analytics/zo'
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Zonal Control Room/i })).toBeInTheDocument();
    });
  });
});
