import { fireEvent, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { readLocation } from '../routerTestUtils';

/**
 * Extracts query parameters from the active test router location or window.location.
 * @param {string} [testId='router-location']
 * @returns {Record<string, string>}
 */
export function readUrlParams(testId = 'router-location') {
  const current = readLocation(testId) || (typeof window !== 'undefined' ? (window.location.search || '') : '');
  const searchPart = current.includes('?') ? current.split('?')[1].split('#')[0] : (current.startsWith('?') ? current.slice(1) : '');
  const searchParams = new URLSearchParams(searchPart);
  const result = {};

  for (const [key, value] of searchParams.entries()) {
    result[key] = value;
  }
  return result;
}

/**
 * Asserts the presence, absence, and values of query parameters.
 * @param {Record<string, string|number|boolean|undefined|null>} expectedParams
 * @param {{ testId?: string }} [options]
 */
export function assertUrlParams(expectedParams, { testId = 'router-location' } = {}) {
  const current = readLocation(testId) || (typeof window !== 'undefined' ? (window.location.pathname + window.location.search) : '');
  const searchPart = current.includes('?') ? current.split('?')[1].split('#')[0] : '';
  const params = new URLSearchParams(searchPart);

  for (const [key, expectedValue] of Object.entries(expectedParams)) {
    if (expectedValue === undefined || expectedValue === null) {
      if (params.has(key)) {
        throw new Error(
          `Expected query param "${key}" to be absent, but found "${params.get(key)}" in "${current}"`
        );
      }
    } else {
      if (!params.has(key)) {
        throw new Error(
          `Expected query param "${key}" to be "${expectedValue}", but it was missing from "${current}"`
        );
      }
      const actualValue = params.get(key);
      if (actualValue !== String(expectedValue)) {
        throw new Error(
          `Expected query param "${key}" to be "${expectedValue}", but got "${actualValue}" in "${current}"`
        );
      }
    }
  }
}

/**
 * Simulates clicking browser Back button inside MemoryRouter or window history.
 */
export function triggerRouterBack() {
  const backBtn = screen.queryByTestId('router-back');
  if (backBtn) {
    fireEvent.click(backBtn);
  } else if (typeof window !== 'undefined' && window.history?.back) {
    window.history.back();
  }
}

/**
 * Simulates clicking browser Forward button inside MemoryRouter or window history.
 */
export function triggerRouterForward() {
  const fwdBtn = screen.queryByTestId('router-forward');
  if (fwdBtn) {
    fireEvent.click(fwdBtn);
  } else if (typeof window !== 'undefined' && window.history?.forward) {
    window.history.forward();
  }
}

/**
 * Executes a callback within isolated Vitest fake timers and safely restores real timers.
 * @param {(tools: { advanceTimers: (ms: number) => Promise<void>|void, runAllTimers: () => void }) => Promise<void>|void} fn
 */
export async function withFakeTimers(fn) {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    await fn({
      advanceTimers: (ms) => vi.advanceTimersByTime(ms),
      runAllTimers: () => vi.runAllTimers()
    });
  } finally {
    vi.useRealTimers();
  }
}
