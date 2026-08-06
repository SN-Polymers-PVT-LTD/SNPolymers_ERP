import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const mockAuthPost = vi.fn();
  const mockAuthRequest = vi.fn();
  let interceptorRejected;

  function createMockAxiosInstance() {
    const instance = (...args) => mockAuthRequest(...args);
    instance.interceptors = {
      response: {
        use: vi.fn((_fulfilled, rejected) => {
          interceptorRejected = rejected;
        })
      }
    };
    instance.post = (...args) => mockAuthPost(...args);
    instance.request = (...args) => mockAuthRequest(...args);
    return instance;
  }

  return {
    mockAuthPost,
    mockAuthRequest,
    getInterceptorRejected: () => interceptorRejected,
    createMockAxiosInstance
  };
});

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => mocks.createMockAxiosInstance()),
    post: vi.fn()
  }
}));

import axios from 'axios';
import authApi from './authApi';

function make401Error(url, retry = false) {
  return {
    response: { status: 401 },
    config: { url, _retry: retry }
  };
}

describe('authApi — 401 interceptor behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockAuthPost.mockReset();
    mocks.mockAuthRequest.mockReset();
    mocks.mockAuthRequest.mockResolvedValue({ status: 200, data: { success: true } });
    axios.post.mockResolvedValue({ status: 200 });
    vi.spyOn(window, 'dispatchEvent').mockImplementation(() => true);
  });

  it('rejects /request-otp 401 immediately without refresh', async () => {
    const interceptorRejected = mocks.getInterceptorRejected();
    await expect(interceptorRejected(make401Error('/request-otp'))).rejects.toMatchObject({
      response: { status: 401 }
    });
    expect(axios.post).not.toHaveBeenCalled();
    expect(window.dispatchEvent).not.toHaveBeenCalled();
  });

  it('dispatches auth-failure on /me 401 without refresh retry', async () => {
    const interceptorRejected = mocks.getInterceptorRejected();
    await expect(interceptorRejected(make401Error('/me'))).rejects.toMatchObject({
      response: { status: 401 }
    });
    expect(window.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'auth-failure' }));
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('refreshes once then retries the original protected request', async () => {
    const interceptorRejected = mocks.getInterceptorRejected();
    const error = make401Error('/requisitions');
    const promise = interceptorRejected(error);

    await expect(promise).resolves.toEqual({ status: 200, data: { success: true } });
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post.mock.calls[0][0]).toMatch(/\/refresh$/);
    expect(mocks.mockAuthRequest).toHaveBeenCalledWith(error.config);
    expect(error.config._retry).toBe(true);
  });

  it('queues concurrent 401s while refresh is in flight', async () => {
    const interceptorRejected = mocks.getInterceptorRejected();
    let resolveRefresh;
    const refreshPromise = new Promise((resolve) => {
      resolveRefresh = resolve;
    });
    axios.post.mockReturnValueOnce(refreshPromise);

    const firstError = make401Error('/projects');
    const secondError = make401Error('/fund-requests');

    const firstPromise = interceptorRejected(firstError);
    const secondPromise = interceptorRejected(secondError);

    expect(axios.post).toHaveBeenCalledTimes(1);

    resolveRefresh({ status: 200 });
    await expect(firstPromise).resolves.toEqual({ status: 200, data: { success: true } });
    await expect(secondPromise).resolves.toEqual({ status: 200, data: { success: true } });
    expect(axios.post).toHaveBeenCalledTimes(1);
  });
});
