import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import MasterData from './MasterData';
import App from '../../App';
import authApi from '../../api/authApi';
import { mockApiScenario } from '../../test/mocks/mockApiScenario';
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
