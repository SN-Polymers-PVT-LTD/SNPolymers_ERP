import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import PurchaseOptions from './PurchaseOptions';
import App from '../../App';
import authApi from '../../api/authApi';
import { mockApiScenario } from '../../test/mocks/mockApiScenario';
import { renderPage } from '../../test';
import { AuthProvider } from '../../components/AuthContext';
import { ModalProvider } from '../../components/ModalContext';
import { ThemeProvider } from '../../components/ThemeContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../api/authApi');

function renderWithProviders(ui) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ModalProvider>
          <AuthProvider>
            <MemoryRouter initialEntries={['/admin/purchase-options']}>
              {ui}
            </MemoryRouter>
          </AuthProvider>
        </ModalProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('PurchaseOptions Page Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders authorized direct mount via App with correct heading and controls', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    window.history.pushState({}, 'Purchase Options', '/admin/purchase-options');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Purchase Options/i })).toBeInTheDocument();
    });

    expect(screen.getByText(/System Configurations/i)).toBeInTheDocument();
  });

  it('renders controls and interacts with add option modal trigger', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    renderWithProviders(<PurchaseOptions />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Purchase Options/i })).toBeInTheDocument();
    });

    const addOptionBtn = screen.getByRole('button', { name: /Add Purchase Option/i });
    expect(addOptionBtn).toBeInTheDocument();
    await userEvent.click(addOptionBtn);

    expect(screen.getByRole('heading', { name: /Add Purchase Option/i })).toBeInTheDocument();
  });

  it('redirects unauthorized JE away from /admin/purchase-options route', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'je' });

    window.history.pushState({}, 'Purchase Options', '/admin/purchase-options');
    render(<App />);

    await waitFor(() => {
      expect(screen.queryByRole('heading', { level: 1, name: /Purchase Options/i })).not.toBeInTheDocument();
    });
  });
});

describe('PurchaseOptions URL State, Modals & Aliases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hydrates legacy search alias, status filter, and modal=add from deep link', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    renderPage(<PurchaseOptions />, {
      role: 'admin',
      initialUrl: '/admin/purchase-options?search=Market&status=active&modal=add&source=bookmark',
      routePath: '/admin/purchase-options'
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: /Add Purchase Option/i })).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search purchase options/i);
    expect(searchInput).toHaveValue('Market');
  });

  it('closes add modal while preserving search, status, and bookmark', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    const { readLocation } = renderPage(<PurchaseOptions />, {
      role: 'admin',
      initialUrl: '/admin/purchase-options?q=Market&status=active&modal=add&source=bookmark',
      routePath: '/admin/purchase-options'
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: /Add Purchase Option/i })).toBeInTheDocument();
    });

    const closeBtn = screen.getByTitle('Close');
    fireEvent.click(closeBtn);

    await waitFor(() => {
      const loc = readLocation();
      expect(loc).not.toContain('modal=');
      expect(loc).toContain('q=Market');
      expect(loc).toContain('status=active');
      expect(loc).toContain('source=bookmark');
    });
  });

  it('safely handles invalid modal parameter without opening dialog', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    renderPage(<PurchaseOptions />, {
      role: 'admin',
      initialUrl: '/admin/purchase-options?modal=corrupted_modal&id=fake_id',
      routePath: '/admin/purchase-options'
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Purchase Options/i })).toBeInTheDocument();
    });

    expect(screen.queryByRole('heading', { level: 2, name: /Add Purchase Option|Edit Purchase Option/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('resets filters while preserving bookmark', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    const { readLocation } = renderPage(<PurchaseOptions />, {
      role: 'admin',
      initialUrl: '/admin/purchase-options?q=Market&status=active&source=bookmark',
      routePath: '/admin/purchase-options'
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Purchase Options/i })).toBeInTheDocument();
    });

    const resetBtn = screen.getByRole('button', { name: /Reset/i });
    fireEvent.click(resetBtn);

    await waitFor(() => {
      const loc = readLocation();
      expect(loc).not.toContain('q=');
      expect(loc).not.toContain('status=');
      expect(loc).toContain('source=bookmark');
    });
  });
});
