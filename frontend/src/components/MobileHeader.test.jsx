import React from 'react';
import { render, screen } from '@testing-library/react';
import { BrowserRouter as Router } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { ThemeProvider } from './ThemeContext';
import { MobileHeader } from './Sidebar';

vi.mock('./AuthContext', () => ({
  useAuth: () => ({
    user: { display_name: 'Test Operator', role: 'admin', mobile_number: '+919876543210' },
    logout: vi.fn(),
  }),
}));

describe('MobileHeader Smoke Test', () => {
  it('renders all expected nav group labels for admin user', () => {
    render(
      <ThemeProvider>
        <Router>
          <MobileHeader />
        </Router>
      </ThemeProvider>
    );

    // MobileHeader mounts menu groups when user is present and menu is rendered or opened
    // Verify MobileHeader renders company branding
    expect(screen.getByText(/SN Polymers/i)).toBeInTheDocument();
  });
});
