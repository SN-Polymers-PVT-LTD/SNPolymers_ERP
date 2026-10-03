import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import DigitalTwinHub from './DigitalTwinHub';
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

describe('DigitalTwinHub URL State, Modals & Aliases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hydrates legacy search alias, status filter, zone filter, and modal=pin_limit from deep link', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    renderPage(<DigitalTwinHub />, {
      role: 'admin',
      initialUrl: '/analytics/digital-twin?search=Substation&status=Warning&zone=North&modal=pin_limit&source=bookmark',
      routePath: '/analytics/digital-twin'
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: /Pin Limit Reached/i })).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search by work order no, site, district/i);
    expect(searchInput).toHaveValue('Substation');
  });

  it('closes pin limit modal while preserving search, status, zone, and bookmark', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    const { readLocation } = renderPage(<DigitalTwinHub />, {
      role: 'admin',
      initialUrl: '/analytics/digital-twin?q=Substation&status=Warning&zone=North&modal=pin_limit&source=bookmark',
      routePath: '/analytics/digital-twin'
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: /Pin Limit Reached/i })).toBeInTheDocument();
    });

    const closeBtn = screen.getByTitle('Close');
    fireEvent.click(closeBtn);

    await waitFor(() => {
      const loc = readLocation();
      expect(loc).not.toContain('modal=');
      expect(loc).toContain('status=Warning');
      expect(loc).toContain('zone=North');
      expect(loc).toContain('q=Substation');
      expect(loc).toContain('source=bookmark');
    });
  });

  it('safely handles invalid status fallback and invalid modal parameter', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    renderPage(<DigitalTwinHub />, {
      role: 'admin',
      initialUrl: '/analytics/digital-twin?status=UnknownStatus&modal=corrupted_modal',
      routePath: '/analytics/digital-twin'
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Project Digital Twin Hub/i })).toBeInTheDocument();
    });

    expect(screen.queryByRole('heading', { level: 2, name: /Pin Limit Reached/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('resets filters while preserving bookmark', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    const { readLocation } = renderPage(<DigitalTwinHub />, {
      role: 'admin',
      initialUrl: '/analytics/digital-twin?q=Substation&status=Warning&source=bookmark',
      routePath: '/analytics/digital-twin'
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Project Digital Twin Hub/i })).toBeInTheDocument();
    });

    const resetBtn = screen.getByRole('button', { name: /Reset Filters/i });
    fireEvent.click(resetBtn);

    await waitFor(() => {
      const loc = readLocation();
      expect(loc).not.toContain('q=');
      expect(loc).not.toContain('status=');
      expect(loc).toContain('source=bookmark');
    });
  });
});
