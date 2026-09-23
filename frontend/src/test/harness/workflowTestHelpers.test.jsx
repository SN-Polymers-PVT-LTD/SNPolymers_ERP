import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createDeferred,
  interceptApiCall,
  assertApiCalledWith,
  waitForQueryRefresh,
  createTestQueryClient
} from '../index';

describe('Workflow Test Helpers Suite', () => {
  let mockApi;

  beforeEach(() => {
    mockApi = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn()
    };
  });

  describe('createDeferred', () => {
    it('creates a controllable promise that resolves when resolve() is called', async () => {
      const deferred = createDeferred();
      let resolvedValue = null;

      deferred.promise.then((val) => {
        resolvedValue = val;
      });

      expect(resolvedValue).toBeNull();
      deferred.resolve('success_data');
      await deferred.promise;
      expect(resolvedValue).toBe('success_data');
    });

    it('creates a controllable promise that rejects when reject() is called', async () => {
      const deferred = createDeferred();
      let rejectedError = null;

      deferred.promise.catch((err) => {
        rejectedError = err;
      });

      expect(rejectedError).toBeNull();
      deferred.reject(new Error('failure_reason'));
      await expect(deferred.promise).rejects.toThrow('failure_reason');
      expect(rejectedError.message).toBe('failure_reason');
    });
  });

  describe('interceptApiCall & assertApiCalledWith', () => {
    it('intercepts matching calls and captures payload', async () => {
      const interceptor = interceptApiCall(mockApi, 'post', '/test-endpoint');

      const payload = { amount: 500, note: 'Sample' };
      const response = await mockApi.post('/api/test-endpoint', payload);

      expect(response.data).toMatchObject({ success: true, amount: 500 });
      expect(interceptor.calls).toHaveLength(1);
      assertApiCalledWith(interceptor, {
        url: '/test-endpoint',
        body: payload,
        partialBody: { amount: 500 }
      });
    });

    it('supports deferred promise responses for in-flight state verification', async () => {
      const deferred = createDeferred();
      const interceptor = interceptApiCall(mockApi, 'patch', '/action', { deferred });

      let completed = false;
      const promise = mockApi.patch('/items/123/action', { status: 'APPROVED' }).then(() => {
        completed = true;
      });

      expect(completed).toBe(false);
      expect(interceptor.calls).toHaveLength(1);

      deferred.resolve({ data: { success: true } });
      await promise;
      expect(completed).toBe(true);
    });

    it('supports simulated error responses', async () => {
      interceptApiCall(mockApi, 'put', '/update', {
        isError: true,
        status: 400,
        response: { message: 'Validation failed' }
      });

      await expect(mockApi.put('/update', { foo: 'bar' })).rejects.toMatchObject({
        response: {
          status: 400,
          data: { message: 'Validation failed' }
        }
      });
    });

    it('restores original method upon calling restore()', () => {
      const originalPost = mockApi.post;
      const interceptor = interceptApiCall(mockApi, 'post', '/target');
      expect(mockApi.post).not.toBe(originalPost);

      interceptor.restore();
      expect(mockApi.post).toBe(originalPost);
    });
  });

  describe('waitForQueryRefresh', () => {
    it('resolves once the target query is not fetching', async () => {
      const client = createTestQueryClient({ queries: { gcTime: 10000 } });
      const deferred = createDeferred();

      const fetchPromise = client.fetchQuery({
        queryKey: ['test-key'],
        queryFn: () => deferred.promise
      });

      expect(client.isFetching({ queryKey: ['test-key'] })).toBe(1);

      deferred.resolve({ val: 42 });
      await fetchPromise;
      await waitForQueryRefresh(client, ['test-key']);
      expect(client.getQueryData(['test-key'])).toEqual({ val: 42 });
    });
  });
});
