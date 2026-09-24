import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import SystemPolicy from './SystemPolicy';
import App from '../App';

const mockNavigate = vi.fn();

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

describe('SystemPolicy Page', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
  });

  it('renders Privacy Policy heading, metadata, and sections', () => {
    render(
      <MemoryRouter>
        <SystemPolicy />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { level: 1, name: /Privacy Policy/i })).toBeInTheDocument();
    expect(screen.getByText(/Last updated: July 11, 2026/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /1\. Overview & Authorized Access Only/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /2\. Information We Collect/i })).toBeInTheDocument();
  });

  it('navigates back when Go Back button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SystemPolicy />
      </MemoryRouter>
    );

    const backBtn = screen.getByRole('button', { name: /Go Back/i });
    await user.click(backBtn);
    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });

  it('renders correctly via App direct mount route /privacy-policy', async () => {
    window.history.pushState({}, 'Privacy Policy', '/privacy-policy');
    render(<App />);

    expect(await screen.findByRole('heading', { level: 1, name: /Privacy Policy/i }, { timeout: 4000 })).toBeInTheDocument();
  });
});
