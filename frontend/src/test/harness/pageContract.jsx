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
  routePath = null,
  allowedRoles = ['admin'],
  unauthorizedRole = null,
  headingMatch = null,
  emptyTextMatch = null,
  errorTextMatch = null,
  expectDom = null,
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
          routePath: routePath || (route.includes('/') ? route : '/'),
          role: allowedRoles[0],
          overrides: scenarioOverrides
        });

        const headings = await screen.findAllByText(headingMatch);
        expect(headings[0]).toBeInTheDocument();
      });
    }

    if (emptyTextMatch) {
      it('renders empty state guidance when API returns empty dataset', async () => {
        mockApiScenario(authApi, { scenario: 'empty', overrides: scenarioOverrides });

        renderPage(<PageComponent {...customProps} />, {
          initialUrl: route,
          routePath: routePath || (route.includes('/') ? route : '/'),
          role: allowedRoles[0],
          scenario: 'empty',
          overrides: scenarioOverrides
        });

        const emptyMessage = await screen.findByText(emptyTextMatch);
        expect(emptyMessage).toBeInTheDocument();
      });
    }

    if (errorTextMatch) {
      it('renders error alert or fallback when API request fails', async () => {
        renderPage(<PageComponent {...customProps} />, {
          initialUrl: route,
          routePath: routePath || (route.includes('/') ? route : '/'),
          role: allowedRoles[0],
          scenario: 'apiError',
          errorMessage: 'Server unavailable',
          overrides: scenarioOverrides
        });

        const errorMessage = await screen.findByText(errorTextMatch, {}, { timeout: 4000 });
        expect(errorMessage).toBeInTheDocument();
      });
    }

    it.each(allowedRoles)('mounts through App.jsx route tree for authorized role "%s" and renders page DOM', async (role) => {
      const { currentLocation } = await renderAppRoute(route, {
        role,
        scenario: 'populated',
        overrides: scenarioOverrides
      });

      await waitFor(() => {
        expect(currentLocation()).toContain(route.split('?')[0]);
      });
      expect(screen.queryByText(/Portal Authentication/i)).not.toBeInTheDocument();

      // P1: Validate that the page-owned DOM landmark or heading is genuinely present!
      if (expectDom) {
        await expectDom(screen);
      } else if (headingMatch) {
        expect((await screen.findAllByRole('heading', { name: headingMatch }, { timeout: 4000 })).length).toBeGreaterThan(0);
      }
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
