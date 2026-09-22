import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../../components/ThemeContext';
import { ModalProvider } from '../../components/ModalContext';
import { AuthProvider } from '../../components/AuthContext';
import { LocationProbe, HistoryControls, readLocation } from '../routerTestUtils';
import { usersFixture } from '../fixtures/domainFixtures';
import authApi from '../../api/authApi';
import App from '../../App';

/**
 * Creates a fresh, isolated QueryClient for testing.
 */
export function createTestQueryClient(overrides = {}) {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        refetchOnWindowFocus: false,
        ...overrides.queries
      },
      mutations: {
        retry: false,
        ...overrides.mutations
      }
    }
  });
}

/**
 * Renders an isolated page component with all required application providers.
 */
export function renderPage(component, {
  initialUrl = '/',
  routePath = initialUrl.split('?')[0].split('#')[0] || '/',
  role = 'admin',
  user = null,
  queryClient = createTestQueryClient(),
  customWrapper = (children) => children
} = {}) {
  const activeUser = user || usersFixture[role] || usersFixture.admin;

  // Mock /me endpoint for AuthProvider
  if (authApi?.get?.mockImplementation) {
    const existingImpl = authApi.get.getMockImplementation?.();
    authApi.get.mockImplementation((url, ...args) => {
      if (url === '/me') {
        return Promise.resolve({ data: { success: true, user: activeUser } });
      }
      return existingImpl ? existingImpl(url, ...args) : Promise.resolve({ data: { success: true } });
    });
  }

  const renderResult = render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ModalProvider>
          <AuthProvider initialUser={activeUser}>
            <MemoryRouter initialEntries={[initialUrl]}>
              <LocationProbe />
              <HistoryControls />
              {customWrapper(
                <Routes>
                  <Route path={routePath} element={component} />
                  {/* Catch-all for sub-routes or redirects */}
                  <Route path="*" element={component} />
                </Routes>
              )}
            </MemoryRouter>
          </AuthProvider>
        </ModalProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );

  return {
    ...renderResult,
    queryClient,
    activeUser,
    readLocation: () => readLocation(),
    goBack: () => {
      const backBtn = screen.getByTestId('router-back');
      fireEvent.click(backBtn);
    },
    goForward: () => {
      const fwdBtn = screen.getByTestId('router-forward');
      fireEvent.click(fwdBtn);
    }
  };
}

/**
 * Renders full App.jsx with protected route trees and role-based permissions.
 */
export async function renderAppRoute(url, {
  role = 'admin',
  user = null
} = {}) {
  const activeUser = user || (role ? usersFixture[role] : null);

  if (authApi?.get?.mockImplementation) {
    authApi.get.mockImplementation((endpoint) => {
      if (endpoint === '/me') {
        if (!activeUser) return Promise.resolve({ data: { success: false, user: null } });
        return Promise.resolve({ data: { success: true, user: activeUser } });
      }
      if (endpoint === '/admin/users') return Promise.resolve({ data: { success: true, users: [] } });
      if (endpoint === '/admin/sessions') return Promise.resolve({ data: { success: true, sessions: [] } });
      return Promise.resolve({ data: { success: true, data: [] } });
    });
  }

  window.history.pushState({}, '', url);
  const renderResult = render(<App />);

  return {
    ...renderResult,
    activeUser,
    currentLocation: () => window.location.pathname + window.location.search + window.location.hash
  };
}

/**
 * Asserts expected URL state query parameters against current location.
 */
export function assertUrlState(expectedParams, { testId = 'router-location' } = {}) {
  const current = readLocation(testId) || (typeof window !== 'undefined' ? window.location.search : '');
  const searchPart = current.includes('?') ? current.split('?')[1].split('#')[0] : '';
  const params = new URLSearchParams(searchPart);

  for (const [key, expectedValue] of Object.entries(expectedParams)) {
    if (expectedValue === undefined || expectedValue === null) {
      if (params.has(key)) {
        throw new Error(`Expected URL param "${key}" to be absent, but found "${params.get(key)}" in "${current}"`);
      }
    } else {
      const actualValue = params.get(key);
      if (actualValue !== String(expectedValue)) {
        throw new Error(`Expected URL param "${key}" to be "${expectedValue}", but got "${actualValue}" in "${current}"`);
      }
    }
  }
}

/**
 * Asserts exact canonical URL path, search, and hash.
 */
export function assertCanonicalUrl(expectedPathAndSearch, { testId = 'router-location' } = {}) {
  const current = readLocation(testId) || (typeof window !== 'undefined' ? (window.location.pathname + window.location.search) : '');
  if (current !== expectedPathAndSearch) {
    throw new Error(`Expected canonical URL "${expectedPathAndSearch}", but got "${current}"`);
  }
}
