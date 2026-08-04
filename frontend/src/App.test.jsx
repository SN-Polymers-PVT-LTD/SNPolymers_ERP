import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { unauthenticatedMock } from './test/mocks/authApiMockFactory';
import App from './App';

vi.mock('./api/authApi', () => ({ default: unauthenticatedMock }));

describe('App Smoke Tests', () => {
  it('renders Home page with expected content at /', () => {
    window.history.pushState({}, '', '/');
    render(<App />);
    expect(screen.getAllByText(/SN Polymers Pvt LTD/i)[0]).toBeInTheDocument();
  });

  it('renders Portal Authentication heading at /login', () => {
    window.history.pushState({}, '', '/login');
    render(<App />);
    expect(screen.getByText(/Portal Authentication/i)).toBeInTheDocument();
  });

  it('redirects unauthenticated user from /dashboard to /login', async () => {
    window.history.pushState({}, '', '/dashboard');
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(/Portal Authentication/i)).toBeInTheDocument();
    });
  });

  it('catch-all redirects unknown paths to /', () => {
    window.history.pushState({}, '', '/this-does-not-exist-at-all');
    render(<App />);
    expect(screen.getAllByText(/SN Polymers Pvt LTD/i)[0]).toBeInTheDocument();
  });
});
