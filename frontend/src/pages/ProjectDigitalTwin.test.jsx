import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ProjectDigitalTwin from './ProjectDigitalTwin';
import App from '../App';
import authApi from '../api/authApi';
import { mockApiScenario } from '../test/mocks/mockApiScenario';
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
    });

    expect(screen.getByText(/Project Performance Twin/i)).toBeInTheDocument();
  });

  it('renders tabs and allows switching to Financials & Materials tab', async () => {
    mockApiScenario(authApi, { scenario: 'populated', role: 'admin' });

    renderWithProviders(<ProjectDigitalTwin />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Substation Alpha, North District/i })).toBeInTheDocument();
    });

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
