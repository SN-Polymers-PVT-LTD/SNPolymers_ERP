import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Login from './Login';

const mockNavigate = vi.fn();
const mockPost = vi.fn();

vi.mock('../api/authApi', () => ({
  default: {
    post: (...args) => mockPost(...args)
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

function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>
  );
}

describe('Login — phone normalization', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockPost.mockReset();
    mockPost.mockResolvedValue({ data: { success: true } });
  });

  it('submits 10-digit input as +91XXXXXXXXXX', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/Authorized Mobile Number/i), '9876543210');
    await user.click(screen.getByRole('button', { name: /Verify Whitelist/i }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/request-otp', {
        mobileNumber: '+919876543210'
      });
    });
    expect(mockNavigate).toHaveBeenCalledWith('/verify-otp', {
      state: { mobileNumber: '+919876543210' }
    });
  });

  it('normalizes 12-digit 91-prefixed input to +91 plus last 10 digits', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/Authorized Mobile Number/i), '919876543210');
    await user.click(screen.getByRole('button', { name: /Verify Whitelist/i }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/request-otp', {
        mobileNumber: '+919876543210'
      });
    });
  });

  it('strips formatting characters before normalizing', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/Authorized Mobile Number/i), '+91 98765 43210');
    await user.click(screen.getByRole('button', { name: /Verify Whitelist/i }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/request-otp', {
        mobileNumber: '+919876543210'
      });
    });
  });

  it('shows validation error and skips API call for invalid numbers', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/Authorized Mobile Number/i), '123');
    await user.click(screen.getByRole('button', { name: /Verify Whitelist/i }));

    expect(await screen.findByText(/valid 10-digit mobile number/i)).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('routes to telegram setup when needsTelegramSetup is true', async () => {
    mockPost.mockResolvedValueOnce({
      data: { success: true, needsTelegramSetup: true }
    });

    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/Authorized Mobile Number/i), '9876543210');
    await user.click(screen.getByRole('button', { name: /Verify Whitelist/i }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/telegram-setup', {
        state: { mobileNumber: '+919876543210' }
      });
    });
  });
});
