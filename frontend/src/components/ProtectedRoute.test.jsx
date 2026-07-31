import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import ProtectedRoute from './ProtectedRoute';

vi.mock('./AuthContext', () => ({
  useAuth: () => ({ user: null, loading: false }),
}));

describe('ProtectedRoute Smoke Test', () => {
  it('redirects to /login when user is null and loading is false', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route element={<ProtectedRoute allowedRoles={['admin']} />}>
            <Route path="/dashboard" element={<div>Protected Console Content</div>} />
          </Route>
          <Route path="/login" element={<div>Login Page Target</div>} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText(/Login Page Target/i)).toBeInTheDocument();
    expect(screen.queryByText(/Protected Console Content/i)).not.toBeInTheDocument();
  });
});
