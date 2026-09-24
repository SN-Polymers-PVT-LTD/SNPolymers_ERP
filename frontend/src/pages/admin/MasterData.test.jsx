import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import MasterData from './MasterData';
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
            <MemoryRouter initialEntries={['/admin/master-data']}>
              {ui}
            </MemoryRouter>
          </AuthProvider>
        </ModalProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('MasterData Page Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders authorized direct mount via App with correct heading and controls', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    window.history.pushState({}, 'Master Data', '/admin/master-data');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Master Data Sheet/i })).toBeInTheDocument();
    });

    expect(screen.getByText(/Project Management Module/i)).toBeInTheDocument();
  });

  it('renders controls and interacts with project creation modal trigger', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    renderWithProviders(<MasterData />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Master Data Sheet/i })).toBeInTheDocument();
    });

    const newProjectBtn = screen.getByRole('button', { name: /New Project/i });
    expect(newProjectBtn).toBeInTheDocument();
    await userEvent.click(newProjectBtn);
  });

  it('redirects unauthorized JE away from /admin/master-data route', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'je' });

    window.history.pushState({}, 'Master Data', '/admin/master-data');
    render(<App />);

    await waitFor(() => {
      expect(screen.queryByRole('heading', { level: 1, name: /Master Data Sheet/i })).not.toBeInTheDocument();
    });
  });
});

describe('MasterData URL State, Modals & Aliases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hydrates tab=archive, legacy department alias, legacy search alias, and modal=create from deep link', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    renderPage(<MasterData />, {
      role: 'admin',
      initialUrl: '/admin/master-data?tab=archive&department=Civil&search=WO-102&modal=create&source=bookmark',
      routePath: '/admin/master-data'
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: /Create Project/i })).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search projects/i);
    expect(searchInput).toHaveValue('WO-102');
  });

  it('closes create modal while preserving tab, search, department, and bookmark', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    const { readLocation } = renderPage(<MasterData />, {
      role: 'admin',
      initialUrl: '/admin/master-data?tab=archive&dept=Civil&q=WO-102&modal=create&source=bookmark',
      routePath: '/admin/master-data'
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: /Create Project/i })).toBeInTheDocument();
    });

    const closeBtn = screen.getByTitle('Close');
    fireEvent.click(closeBtn);

    await waitFor(() => {
      const loc = readLocation();
      expect(loc).not.toContain('modal=');
      expect(loc).toContain('tab=archive');
      expect(loc).toContain('dept=Civil');
      expect(loc).toContain('q=WO-102');
      expect(loc).toContain('source=bookmark');
    });
  });

  it('safely handles invalid modal parameter without opening dialog', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    renderPage(<MasterData />, {
      role: 'admin',
      initialUrl: '/admin/master-data?modal=corrupted_modal&wo=fake_wo',
      routePath: '/admin/master-data'
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Master Data Sheet/i })).toBeInTheDocument();
    });

    expect(screen.queryByRole('heading', { level: 2, name: /Create Project|Edit Project/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('resets filters while preserving tab and bookmark', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    const { readLocation } = renderPage(<MasterData />, {
      role: 'admin',
      initialUrl: '/admin/master-data?tab=archive&dept=Civil&q=WO-102&source=bookmark',
      routePath: '/admin/master-data'
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Master Data Sheet/i })).toBeInTheDocument();
    });

    const resetBtn = screen.getByRole('button', { name: /Reset/i });
    fireEvent.click(resetBtn);

    await waitFor(() => {
      const loc = readLocation();
      expect(loc).not.toContain('q=');
      expect(loc).not.toContain('dept=');
      expect(loc).toContain('tab=archive');
      expect(loc).toContain('source=bookmark');
    });
  });
});
