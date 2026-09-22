import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../../components/ThemeContext';
import { ModalProvider } from '../../components/ModalContext';
import { AuthProvider } from '../../components/AuthContext';
import { LocationProbe, HistoryControls, readLocation } from '../routerTestUtils';
import { usersFixture } from '../fixtures/domainFixtures';
import { mockApiScenario } from '../mocks/mockApiScenario';
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
  scenario = 'populated',
  overrides = {},
  errorMessage = 'Server unavailable',
  queryClient = null,
  customWrapper = (children) => children
} = {}) {
  const activeUser = user || usersFixture[role] || usersFixture.admin;
  const client = queryClient || createTestQueryClient();

  mockApiScenario(authApi, {
    scenario,
    role,
    user: activeUser,
    overrides,
    errorMessage
  });

  const renderResult = render(
    <QueryClientProvider client={client}>
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
    queryClient: client,
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
 * Renders full App.jsx with protected route trees and role-based permissions,
 * fully connected to scenario mock fixtures.
 */
export async function renderAppRoute(url, {
  role = 'admin',
  user = null,
  scenario = 'populated',
  overrides = {},
  errorMessage = 'API Error occurred'
} = {}) {
  const activeUser = user || (role ? usersFixture[role] : null);

  mockApiScenario(authApi, {
    scenario,
    role,
    user: activeUser,
    overrides,
    errorMessage
  });

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
