import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AdminPanel from './AdminPanel';
import App from '../../App';
import authApi from '../../api/authApi';
import { mockApiScenario, renderPage } from '../../test';
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
            <MemoryRouter initialEntries={['/admin']}>
              {ui}
            </MemoryRouter>
          </AuthProvider>
        </ModalProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('AdminPanel Page Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders authorized direct mount via App with correct heading and controls', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    window.history.pushState({}, 'Admin Panel', '/admin');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Authorized Access Whitelist/i })).toBeInTheDocument();
    });

    expect(screen.getByText(/Console System Policies/i)).toBeInTheDocument();
  });

  it('renders loading state when users request is pending', async () => {
    mockApiScenario(authApi, { scenario: 'loading', role: 'admin' });

    const { container } = renderWithProviders(<AdminPanel />);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThanOrEqual(1);
  });

  it('renders empty state guidance when no users are authorized', async () => {
    mockApiScenario(authApi, { scenario: 'empty', role: 'admin' });

    renderWithProviders(<AdminPanel />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Authorized Access Whitelist/i })).toBeInTheDocument();
    });

    expect(await screen.findByText(/No authorized system credentials discovered/i)).toBeInTheDocument();
  });

  it('renders error alert when user fetch fails', async () => {
    mockApiScenario(authApi, { scenario: 'apiError', errorMessage: 'Admin directory offline', role: 'admin' });

    renderWithProviders(<AdminPanel />);

    expect(await screen.findByText(/Admin directory offline/i)).toBeInTheDocument();
  });

  it('renders controls and interacts with add account modal trigger', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    renderWithProviders(<AdminPanel />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Authorized Access Whitelist/i })).toBeInTheDocument();
    });

    const addBtn = screen.getByRole('button', { name: /Authorize User Credentials/i });
    expect(addBtn).toBeInTheDocument();
    await userEvent.click(addBtn);

    expect(screen.getByText(/Authorize New Account/i)).toBeInTheDocument();
  });

  it('redirects unauthorized JE away from /admin route to /dashboard', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'je' });

    window.history.pushState({}, 'Admin Panel', '/admin');
    render(<App />);

    await waitFor(() => {
      expect(screen.queryByRole('heading', { level: 1, name: /Authorized Access Whitelist/i })).not.toBeInTheDocument();
      expect(window.location.pathname).toBe('/dashboard');
    });
  });
});

describe('AdminPanel URL State, Modals & Aliases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hydrates search query, role filter, and modal=add from deep link', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    renderPage(<AdminPanel />, {
      role: 'admin',
      initialUrl: '/admin?role=je&search=operator&modal=add&source=bookmark',
      routePath: '/admin'
    });

    await waitFor(() => {
      expect(screen.getByText('Authorize New Account')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search by display name or mobile number/i);
    expect(searchInput).toHaveValue('operator');
  });

  it('closes add modal while preserving search, role, and bookmark parameter', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    const { readLocation } = renderPage(<AdminPanel />, {
      role: 'admin',
      initialUrl: '/admin?role=je&q=operator&modal=add&source=bookmark',
      routePath: '/admin'
    });

    await waitFor(() => {
      expect(screen.getByText('Authorize New Account')).toBeInTheDocument();
    });

    const closeBtn = screen.getByTitle('Close');
    fireEvent.click(closeBtn);

    await waitFor(() => {
      const loc = readLocation();
      expect(loc).not.toContain('modal=');
      expect(loc).toContain('role=je');
      expect(loc).toContain('q=operator');
      expect(loc).toContain('source=bookmark');
    });
  });

  it('safely handles invalid modal parameter without opening dialog', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    renderPage(<AdminPanel />, {
      role: 'admin',
      initialUrl: '/admin?modal=corrupted_modal&userId=fake_user_id',
      routePath: '/admin'
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Authorized Access Whitelist/i })).toBeInTheDocument();
    });

    expect(screen.queryByText('Authorize New Account')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
