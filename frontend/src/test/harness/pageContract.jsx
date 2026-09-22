import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderPage, renderAppRoute } from './renderHelpers';
import { mockApiScenario } from '../mocks/mockApiScenario';
import authApi from '../../api/authApi';

/**
 * Executes standard DOM and Route contracts for an operational page.
 */
export function describePageContract(PageComponent, {
  name = PageComponent.name || 'Page',
  route = '/',
  allowedRoles = ['admin'],
  unauthorizedRole = null,
  headingMatch = null,
  emptyTextMatch = null,
  errorTextMatch = null,
  customProps = {},
  scenarioOverrides = {}
} = {}) {
  describe(`${name} - Page DOM & Route Contract`, () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockApiScenario(authApi, { scenario: 'populated', overrides: scenarioOverrides });
    });

    if (headingMatch) {
      it(`renders primary page heading for authorized role (${allowedRoles[0]})`, async () => {
        renderPage(<PageComponent {...customProps} />, {
          initialUrl: route,
          role: allowedRoles[0]
        });

        const heading = await screen.findByText(headingMatch);
        expect(heading).toBeInTheDocument();
      });
    }

    if (emptyTextMatch) {
      it('renders empty state guidance when API returns empty dataset', async () => {
        mockApiScenario(authApi, { scenario: 'empty', overrides: scenarioOverrides });

        renderPage(<PageComponent {...customProps} />, {
          initialUrl: route,
          role: allowedRoles[0]
        });

        const emptyMessage = await screen.findByText(emptyTextMatch);
        expect(emptyMessage).toBeInTheDocument();
      });
    }

    if (errorTextMatch) {
      it('renders error alert or fallback when API request fails', async () => {
        mockApiScenario(authApi, {
          scenario: 'apiError',
          errorMessage: 'Server unavailable',
          overrides: scenarioOverrides
        });

        renderPage(<PageComponent {...customProps} />, {
          initialUrl: route,
          role: allowedRoles[0]
        });

        const errorMessage = await screen.findByText(errorTextMatch);
        expect(errorMessage).toBeInTheDocument();
      });
    }

    it.each(allowedRoles)('mounts through App.jsx route tree for authorized role "%s"', async (role) => {
      const { currentLocation } = await renderAppRoute(route, { role });
      await waitFor(() => {
        expect(currentLocation()).toContain(route.split('?')[0]);
      });
      expect(screen.queryByText(/Portal Authentication/i)).not.toBeInTheDocument();
    });

    if (unauthorizedRole) {
      it(`redirects unauthorized role "${unauthorizedRole}" away from ${route}`, async () => {
        const { currentLocation } = await renderAppRoute(route, { role: unauthorizedRole });
        await waitFor(() => {
          expect(currentLocation()).not.toBe(route);
          expect(currentLocation()).toBe('/dashboard');
        });
      });
    }
  });
}
