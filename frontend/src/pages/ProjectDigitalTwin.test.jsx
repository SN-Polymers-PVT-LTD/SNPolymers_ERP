import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ProjectDigitalTwin from './ProjectDigitalTwin';
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
            <MemoryRouter initialEntries={['/projects/WO-101/digital-twin']}>
              <Routes>
                <Route path="/projects/:work_order_no/digital-twin" element={ui} />
              </Routes>
            </MemoryRouter>
          </AuthProvider>
        </ModalProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('ProjectDigitalTwin Page Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders authorized direct mount via App with correct heading and controls', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'ho' });

    window.history.pushState({}, 'Digital Twin', '/projects/WO-101/digital-twin');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Substation Alpha, North District/i })).toBeInTheDocument();
    }, { timeout: 4000 });

    expect(screen.getByText(/Project Performance Twin/i)).toBeInTheDocument();
  });

  it('renders tabs and allows switching to Financials & Materials tab', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    renderWithProviders(<ProjectDigitalTwin />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Substation Alpha, North District/i })).toBeInTheDocument();
    }, { timeout: 4000 });

    const finTab = screen.getByRole('button', { name: /Financials & Materials/i });
    expect(finTab).toBeInTheDocument();
    await userEvent.click(finTab);
  });

  it('redirects unauthorized accounts role away from project digital twin route', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'accounts' });

    window.history.pushState({}, 'Digital Twin', '/projects/WO-101/digital-twin');
    render(<App />);

    await waitFor(() => {
      expect(screen.queryByText(/Project Performance Twin/i)).not.toBeInTheDocument();
    });
  });
});

describe('ProjectDigitalTwin URL State, Tabs & Modals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hydrates active tab and modal=forecast_entry from deep link', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    renderPage(<ProjectDigitalTwin />, {
      role: 'admin',
      initialUrl: '/projects/WO-101/digital-twin?tab=financials&modal=forecast_entry&source=bookmark',
      routePath: '/projects/:work_order_no/digital-twin'
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: /Estimated Bill Entry/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Financials & Materials/i })).toBeInTheDocument();
    });

    const finTab = screen.getByRole('button', { name: /Financials & Materials/i });
    expect(finTab).toHaveClass('text-amber-400');
  });

  it('switches tab and updates URL to canonical parameter', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    const { readLocation } = renderPage(<ProjectDigitalTwin />, {
      role: 'admin',
      initialUrl: '/projects/WO-101/digital-twin?tab=financials&source=bookmark',
      routePath: '/projects/:work_order_no/digital-twin'
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Substation Alpha, North District/i })).toBeInTheDocument();
    });

    const progressTab = screen.getByRole('button', { name: /Progress & Timeline/i });
    fireEvent.click(progressTab);

    await waitFor(() => {
      const loc = readLocation();
      expect(loc).toContain('tab=progress');
      expect(loc).not.toContain('tab=financials');
      expect(loc).toContain('source=bookmark');
    });
  });

  it('closes forecast modal while preserving active tab and bookmark', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    const { readLocation } = renderPage(<ProjectDigitalTwin />, {
      role: 'admin',
      initialUrl: '/projects/WO-101/digital-twin?tab=financials&modal=forecast_entry&source=bookmark',
      routePath: '/projects/:work_order_no/digital-twin'
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: /Estimated Bill Entry/i })).toBeInTheDocument();
    });

    const closeBtn = screen.getByTitle('Close');
    fireEvent.click(closeBtn);

    await waitFor(() => {
      const loc = readLocation();
      expect(loc).not.toContain('modal=');
      expect(loc).toContain('tab=financials');
      expect(loc).toContain('source=bookmark');
    });
  });

  it('safely handles invalid tab fallback to overview and invalid modal', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    renderPage(<ProjectDigitalTwin />, {
      role: 'admin',
      initialUrl: '/projects/WO-101/digital-twin?tab=invalid_tab&modal=corrupted_modal',
      routePath: '/projects/:work_order_no/digital-twin'
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Substation Alpha, North District/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Overview & Media/i })).toBeInTheDocument();
    });

    expect(screen.queryByRole('heading', { level: 2, name: /Estimated Bill Entry/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const overviewTab = screen.getByRole('button', { name: /Overview & Media/i });
    expect(overviewTab).toHaveClass('text-amber-400');
  });
});
