import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderPage, renderAppRoute } from './renderHelpers';
import { mockApiScenario } from '../mocks/mockApiScenario';
import authApi from '../../api/authApi';

/**
 * Normalizes inputs to describePageContract to support both:
 * 1. describePageContract(PageComponent, options)
 * 2. describePageContract({ PageUnderContract, ...options })
 */
function normalizeContractArgs(arg1, arg2) {
  let PageComponent;
  let options;

  if (typeof arg1 === 'function') {
    PageComponent = arg1;
    options = arg2 || {};
  } else if (arg1 && typeof arg1 === 'object') {
    if (!arg1.PageUnderContract && !arg1.PageComponent) {
      throw new Error(
        'Invalid describePageContract call: When passing a single options object, ' +
        '"PageUnderContract" or "PageComponent" must be specified.'
      );
    }
    PageComponent = arg1.PageUnderContract || arg1.PageComponent;
    options = { ...arg1 };
  } else {
    throw new Error(
      'Invalid describePageContract call: Expected (PageComponent, options) or (optionsObject).'
    );
  }

  const {
    name = options.pageName || options.title || PageComponent.displayName || PageComponent.name || 'Page',
    route = '/',
    routePath = null,
    allowedRoles = options.requiredRole ? [options.requiredRole] : ['admin'],
    unauthorizedRole = options.unauthorizedRole || null,
    headingMatch = options.headingText ? (typeof options.headingText === 'string' ? new RegExp(options.headingText, 'i') : options.headingText) : null,
    emptyTextMatch = options.emptyScenarioText ? (typeof options.emptyScenarioText === 'string' ? new RegExp(options.emptyScenarioText, 'i') : options.emptyScenarioText) : null,
    errorTextMatch = options.errorScenarioText ? (typeof options.errorScenarioText === 'string' ? new RegExp(options.errorScenarioText, 'i') : options.errorScenarioText) : null,
    expectDom = options.expectDom || null,
    customProps = options.customProps || {},
    scenarioOverrides = options.initialScenario || options.scenarioOverrides || {}
  } = options;

  return {
    PageComponent,
    name,
    route,
    routePath,
    allowedRoles,
    unauthorizedRole,
    headingMatch,
    emptyTextMatch,
    errorTextMatch,
    expectDom,
    customProps,
    scenarioOverrides
  };
}

/**
 * Executes standard DOM and Route contracts for an operational page.
 */
export function describePageContract(arg1, arg2) {
  const {
    PageComponent,
    name,
    route,
    routePath,
    allowedRoles,
    unauthorizedRole,
    headingMatch,
    emptyTextMatch,
    errorTextMatch,
    expectDom,
    customProps,
    scenarioOverrides
  } = normalizeContractArgs(arg1, arg2);

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

      // Validate that the page-owned DOM landmark or heading is genuinely present!
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
