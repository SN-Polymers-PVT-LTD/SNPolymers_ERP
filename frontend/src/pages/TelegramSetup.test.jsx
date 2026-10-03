import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import TelegramSetup from './TelegramSetup';
import App from '../App';
import authApi from '../api/authApi';

const mockNavigate = vi.fn();

vi.mock('../api/authApi', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn()
  }
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

vi.mock('../components/BackgroundShapes', () => ({
  default: () => null
}));

function renderTelegramSetup(initialState = { mobileNumber: '+919876543210' }) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/telegram-setup', state: initialState }]}>
      <Routes>
        <Route path="/telegram-setup" element={<TelegramSetup />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('TelegramSetup Page Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to /login if mobileNumber is missing in location state', async () => {
    renderTelegramSetup(null);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
    });
  });

  it('renders heading, step-by-step instructions, and target mobile number', async () => {
    authApi.get.mockResolvedValueOnce({ data: { success: true, linked: false } });

    renderTelegramSetup({ mobileNumber: '+919876543210' });

    expect(screen.getByRole('heading', { level: 2, name: /One-Time Telegram Setup/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open Telegram Bot/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /I shared my contact — Send OTP/i })).toBeInTheDocument();
  });

  it('manually checks link status and navigates to verify-otp upon success', async () => {
    authApi.get.mockResolvedValue({ data: { success: true, linked: true } });
    authApi.post.mockResolvedValueOnce({ data: { success: true } });

    const user = userEvent.setup();
    renderTelegramSetup({ mobileNumber: '+919876543210' });

    const checkBtn = screen.getByRole('button', { name: /I shared my contact — Send OTP/i });
    await user.click(checkBtn);

    await waitFor(() => {
      expect(authApi.get).toHaveBeenCalledWith('/link-status', {
        params: { mobileNumber: '+919876543210' }
      });
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/verify-otp', {
        state: { mobileNumber: '+919876543210' }
      });
    });
  });

  it('shows error message if manual link check reveals account is not linked yet', async () => {
    authApi.get.mockResolvedValue({ data: { success: true, linked: false } });

    const user = userEvent.setup();
    renderTelegramSetup({ mobileNumber: '+919876543210' });

    const checkBtn = screen.getByRole('button', { name: /I shared my contact — Send OTP/i });
    await user.click(checkBtn);

    await waitFor(() => {
      expect(screen.getByText(/Connection not found yet/i)).toBeInTheDocument();
    });
  });

  it('mounts through App and redirects unauthenticated direct visit without state to /login', async () => {
    window.history.pushState({}, 'Telegram Setup', '/telegram-setup');
    render(<App />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
    }, { timeout: 4000 });
  });
});
