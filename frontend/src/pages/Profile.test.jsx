import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Profile from './Profile';

const mockUser = {
  display_name: 'Test Operator',
  mobile_number: '9876543210',
  role: 'je',
  telegram_chat_id: '123456789',
  is_active: true,
  daily_streak: 5
};

vi.mock('../components/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    logout: vi.fn(),
  }),
}));

const mockToggleTheme = vi.fn();
const mockSetDarkBg = vi.fn();
const mockSetLightBg = vi.fn();

vi.mock('../components/ThemeContext', () => ({
  useTheme: () => ({
    theme: 'dark',
    toggleTheme: mockToggleTheme,
    darkBg: 'slate-mesh',
    setDarkBg: mockSetDarkBg,
    lightBg: 'pure-white',
    setLightBg: mockSetLightBg,
    DARK_BACKGROUNDS: [
      { id: 'slate-mesh', name: 'Slate Mesh', style: 'background: #0f172a' },
      { id: 'obsidian-glow', name: 'Obsidian Glow', style: 'background: #020617' }
    ],
    LIGHT_BACKGROUNDS: [
      { id: 'pure-white', name: 'Pure White', style: 'background: #ffffff' },
      { id: 'cream-paper', name: 'Cream Paper', style: 'background: #fefce8' }
    ]
  }),
}));

vi.mock('../api/authApi', () => ({
  default: {
    get: vi.fn().mockResolvedValue({
      data: {
        success: true,
        profile: {
          display_name: 'Test Operator',
          mobile_number: '9876543210',
          role: 'je',
          telegram_chat_id: '123456789',
          is_active: true,
          daily_streak: 5
        }
      }
    })
  }
}));

const renderProfile = (initialEntry = '/profile') => {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/profile" element={<Profile />} />
      </Routes>
    </MemoryRouter>
  );
};

describe('Profile component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders default Profile & Activity tab on clean /profile URL', async () => {
    renderProfile('/profile');

    expect(screen.getByText('User Profile')).toBeInTheDocument();
    expect(screen.getByText('Profile & Activity')).toBeInTheDocument();
    expect(screen.getByText('Appearance & Settings')).toBeInTheDocument();

    // Check user info rendered
    expect(screen.getByText('Test Operator')).toBeInTheDocument();
    expect(screen.getByText('je')).toBeInTheDocument();
    expect(await screen.findByText(/5 Day Streak/)).toBeInTheDocument();
    expect(screen.getByText('Account Active')).toBeInTheDocument();
    expect(screen.getByText(/Telegram ID: 123456789/)).toBeInTheDocument();

    // Appearance section should NOT be visible on default profile tab
    expect(screen.queryByText('Appearance & Custom Backgrounds')).not.toBeInTheDocument();
  });

  it('switches to Appearance & Settings tab when tab button clicked', async () => {
    renderProfile('/profile');

    const appearanceTabBtn = screen.getByRole('button', { name: /Appearance & Settings/i });
    fireEvent.click(appearanceTabBtn);

    // Now Appearance section should be visible
    expect(await screen.findByText('Appearance & Custom Backgrounds')).toBeInTheDocument();
    expect(screen.getByText('Dark Theme Background')).toBeInTheDocument();
    expect(screen.getByText('Light Theme Background')).toBeInTheDocument();
    expect(screen.getByText('Slate Mesh')).toBeInTheDocument();
    expect(screen.getByText('Pure White')).toBeInTheDocument();

    // Identity card should NOT be visible on appearance tab
    expect(screen.queryByText('Test Operator')).not.toBeInTheDocument();
  });

  it('renders Appearance & Settings immediately when deep-linked with ?tab=appearance', async () => {
    renderProfile('/profile?tab=appearance');

    expect(await screen.findByText('Appearance & Custom Backgrounds')).toBeInTheDocument();
    expect(screen.getByText('Dark Theme Background')).toBeInTheDocument();
    expect(screen.getByText('Light Theme Background')).toBeInTheDocument();

    // Clicking Back button returns to Profile tab
    const backBtn = screen.getByRole('button', { name: /Back to Profile & Activity/i });
    fireEvent.click(backBtn);

    expect(await screen.findByText('Test Operator')).toBeInTheDocument();
  });

  it('triggers theme toggle and background changes', async () => {
    renderProfile('/profile?tab=appearance');

    const toggleThemeBtn = await screen.findByRole('button', { name: /Switch to Light Mode/i });
    fireEvent.click(toggleThemeBtn);
    expect(mockToggleTheme).toHaveBeenCalledTimes(1);

    const obsidianBgBtn = screen.getByRole('button', { name: /Obsidian Glow/i });
    fireEvent.click(obsidianBgBtn);
    expect(mockSetDarkBg).toHaveBeenCalledWith('obsidian-glow');

    const creamBgBtn = screen.getByRole('button', { name: /Cream Paper/i });
    fireEvent.click(creamBgBtn);
    expect(mockSetLightBg).toHaveBeenCalledWith('cream-paper');
  });
});
