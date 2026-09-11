import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import TopNavbar from './TopNavbar';
import { ModalProvider } from './ModalContext';

let mockUser = { role: 'accounts', display_name: 'Accounts Operator' };

vi.mock('./AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    logout: vi.fn(),
  }),
}));

describe('TopNavbar Dock role permissions', () => {
  it('does NOT render the Finance button in the dock for accounts role', () => {
    mockUser = { role: 'accounts', display_name: 'Accounts Operator' };

    render(
      <ModalProvider>
        <MemoryRouter initialEntries={['/acct-requisitions']}>
          <TopNavbar />
        </MemoryRouter>
      </ModalProvider>
    );

    // Finance button should NOT be in the dock
    expect(screen.queryByRole('button', { name: 'Finance' })).not.toBeInTheDocument();

    // Accounts, Overview, Documentation buttons SHOULD be present
    expect(screen.getByRole('button', { name: 'Accounts' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Documentation' })).toBeInTheDocument();
  });

  it('renders the Finance button in the dock for admin role', () => {
    mockUser = { role: 'admin', display_name: 'System Admin' };

    render(
      <ModalProvider>
        <MemoryRouter initialEntries={['/dashboard']}>
          <TopNavbar />
        </MemoryRouter>
      </ModalProvider>
    );

    expect(screen.getByRole('button', { name: 'Finance' })).toBeInTheDocument();
  });

  it('renders the Finance button in the dock for zo role', () => {
    mockUser = { role: 'zo', display_name: 'Zonal Officer' };

    render(
      <ModalProvider>
        <MemoryRouter initialEntries={['/dashboard']}>
          <TopNavbar />
        </MemoryRouter>
      </ModalProvider>
    );

    expect(screen.getByRole('button', { name: 'Finance' })).toBeInTheDocument();
  });
});
