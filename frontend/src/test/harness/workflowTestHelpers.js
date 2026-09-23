import { expect, vi } from 'vitest';
import { waitFor } from '@testing-library/react';

/**
 * Creates a controllable deferred Promise with exposed resolve and reject functions.
 * Useful for asserting loading/disabled UI states while an API call is in flight.
 */
export function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Attaches a spy handler to a specific HTTP method on an authApi instance.
 * Supports intercepting calls matching a URL pattern or predicate function,
 * optionally returning a deferred promise or custom response payload.
 *
 * @param {object} authApiTarget - The authApi instance (or mocked authApi)
 * @param {'get'|'post'|'put'|'patch'|'delete'} method - HTTP method
 * @param {string|RegExp|Function} [matcher] - URL string pattern, RegExp, or predicate fn
 * @param {object} [options]
 * @param {object} [options.deferred] - Optional deferred promise created with createDeferred()
 * @param {any} [options.response] - Default response if deferred is not provided
 * @param {boolean} [options.isError] - Whether default response should reject
 */
export function interceptApiCall(authApiTarget, method, matcher, options = {}) {
  const originalMethod = authApiTarget[method] || vi.fn();
  const calls = [];

  const checkMatch = (url, body, config) => {
    if (!matcher) return true;
    if (typeof matcher === 'string') return url.includes(matcher);
    if (matcher instanceof RegExp) return matcher.test(url);
    if (typeof matcher === 'function') return matcher(url, body, config);
    return false;
  };

  const handler = vi.fn().mockImplementation((url, body, config) => {
    if (checkMatch(url, body, config)) {
      const record = { url, body, config, timestamp: Date.now() };
      calls.push(record);

      if (options.deferred) {
        return options.deferred.promise;
      }
      if (options.isError) {
        const error = new Error(options.response?.message || 'API Mutation Error');
        error.response = { status: options.status || 500, data: options.response || { success: false } };
        return Promise.reject(error);
      }
      if (options.response !== undefined) {
        return Promise.resolve({ data: options.response });
      }
      return Promise.resolve({ data: { success: true, ...(body && typeof body === 'object' ? body : {}) } });
    }
    return originalMethod(url, body, config);
  });

  authApiTarget[method] = handler;

  return {
    handler,
    calls,
    get lastCall() {
      return calls[calls.length - 1];
    },
    restore() {
      authApiTarget[method] = originalMethod;
    }
  };
}

/**
 * Asserts that an intercepted API call or mock function was invoked with the expected parameters.
 *
 * @param {object|Function} target - Interceptor object returned by interceptApiCall or a vi.fn()
 * @param {object} expected
 * @param {string|RegExp} [expected.url] - Expected URL match
 * @param {any} [expected.body] - Expected exact body
 * @param {any} [expected.partialBody] - Expected partial body match
 * @param {number} [expected.callIndex] - Call index to inspect (defaults to latest)
 */
export function assertApiCalledWith(target, { url, body, partialBody, callIndex = null } = {}) {
  const calls = target.calls ? target.calls : (target.mock ? target.mock.calls.map(c => ({ url: c[0], body: c[1], config: c[2] })) : []);

  if (calls.length === 0) {
    throw new Error('assertApiCalledWith failed: No matching API calls were recorded.');
  }

  const idx = callIndex !== null ? callIndex : calls.length - 1;
  const call = calls[idx];

  if (!call) {
    throw new Error(`assertApiCalledWith failed: No API call found at index ${idx}. Total calls: ${calls.length}`);
  }

  if (url !== undefined) {
    if (typeof url === 'string') {
      expect(call.url).toContain(url);
    } else if (url instanceof RegExp) {
      expect(call.url).toMatch(url);
    }
  }

  if (body !== undefined) {
    expect(call.body).toEqual(body);
  }

  if (partialBody !== undefined) {
    expect(call.body).toMatchObject(partialBody);
  }
}

/**
 * Waits until an active query key in TanStack Query has completed refetching.
 */
export async function waitForQueryRefresh(queryClient, queryKey) {
  await waitFor(() => {
    const isFetching = queryClient.isFetching(queryKey ? { queryKey } : undefined);
    expect(isFetching).toBe(0);
  });
}
