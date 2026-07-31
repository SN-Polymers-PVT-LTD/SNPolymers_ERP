import { vi } from 'vitest';

export const unauthenticatedMock = {
  get: vi.fn().mockImplementation((url) => {
    if (url === '/me') {
      return Promise.resolve({ data: { success: false, user: null } });
    }
    return Promise.resolve({ data: { success: false } });
  }),
  post: vi.fn().mockImplementation((url) => {
    if (url === '/logout') {
      return Promise.resolve({ data: { success: true } });
    }
    return Promise.resolve({ data: { success: true } });
  }),
  interceptors: {
    response: { use: vi.fn() }
  }
};

export const authenticatedMock = (role = 'admin') => ({
  get: vi.fn().mockImplementation((url) => {
    if (url === '/me') {
      return Promise.resolve({
        data: {
          success: true,
          user: { display_name: 'Test Operator', role, mobile_number: '+919876543210' }
        }
      });
    }
    return Promise.resolve({ data: { success: true } });
  }),
  post: vi.fn().mockImplementation(() => Promise.resolve({ data: { success: true } })),
  interceptors: {
    response: { use: vi.fn() }
  }
});
