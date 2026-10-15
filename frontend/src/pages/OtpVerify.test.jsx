import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import OtpVerify from './OtpVerify';
import App from '../App';
import authApi from '../api/authApi';

const mockNavigate = vi.fn();
const mockLogin = vi.fn();

vi.mock('../api/authApi', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn()
  }
}));

vi.mock('../components/AuthContext', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useAuth: () => ({
      login: mockLogin,
      user: null,
      isAuthenticated: false
    })
  };
});

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

function renderOtpVerify(initialState = { mobileNumber: '+919876543210' }) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/verify-otp', state: initialState }]}>
      <Routes>
        <Route path="/verify-otp" element={<OtpVerify />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('OtpVerify Page Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to /login if mobileNumber is missing in location state', async () => {
    renderOtpVerify(null);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
    });
  });

  it('renders verification heading, instructions, and target mobile number', async () => {
    renderOtpVerify({ mobileNumber: '+919876543210' });

    expect(screen.getByRole('heading', { level: 2, name: /Passcode Verification/i })).toBeInTheDocument();
    expect(screen.getByText('+919876543210')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Verify Authenticity & Access/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Change Input Number/i })).toBeInTheDocument();
  });

  it('enters OTP digits and successfully submits verification', async () => {
    authApi.post.mockResolvedValueOnce({
      data: {
        success: true,
        user: { id: 1, role: 'admin', name: 'Admin User' }
      }
    });

    const user = userEvent.setup();
    renderOtpVerify({ mobileNumber: '+919876543210' });

    const inputs = screen.getAllByRole('textbox');
    expect(inputs).toHaveLength(6);

    for (let i = 0; i < 6; i++) {
      await user.type(inputs[i], String(i + 1));
    }

    await waitFor(() => {
      expect(authApi.post).toHaveBeenCalledWith('/verify-otp', {
        mobileNumber: '+919876543210',
        otp: '123456'
      });
    });

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith({ id: 1, role: 'admin', name: 'Admin User' });
    });
  });

  it('shows error banner when OTP verification fails', async () => {
    authApi.post.mockRejectedValueOnce({
      response: { data: { message: 'Invalid or expired passcode' } }
    });

    const user = userEvent.setup();
    renderOtpVerify({ mobileNumber: '+919876543210' });

    const inputs = screen.getAllByRole('textbox');
    for (let i = 0; i < 6; i++) {
      await user.type(inputs[i], '9');
    }

    await waitFor(() => {
      expect(screen.getByText(/Invalid or expired passcode/i)).toBeInTheDocument();
    });
  });

  it('mounts through App and redirects unauthenticated direct visit without state to /login', async () => {
    window.history.pushState({}, 'Verify OTP', '/verify-otp');
    render(<App />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
    }, { timeout: 4000 });
  });
});
