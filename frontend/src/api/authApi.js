import axios from 'axios';

const defaultApiUrl = typeof window !== 'undefined' && window.location.hostname !== 'localhost'
  ? `http://${window.location.hostname}:5000/api/v1/auth`
  : 'http://localhost:5000/api/v1/auth';

const API_URL = import.meta.env.VITE_API_URL || defaultApiUrl;

const authApi = axios.create({
  baseURL: API_URL,
  withCredentials: true, // enable carrying cookies (httpOnly session token)
  timeout: 60000, // 60 seconds timeout to accommodate Render free-tier cold starts
  headers: {
    'Content-Type': 'application/json',
  },
});

let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });

  failedQueue = [];
};

authApi.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response && error.response.status === 401) {
      const url = originalRequest.url || '';

      // Immediately reject auth flow endpoints without retrying, refreshing, or dispatching auth-failure
      if (
        url.includes('/logout') ||
        url.includes('/request-otp') ||
        url.includes('/verify-otp')
      ) {
        return Promise.reject(error);
      }

      if (!originalRequest._retry) {
        // /refresh itself failing means the refresh token is genuinely invalid/expired —
        // no point retrying. /login failing is just a bad OTP/credential, not a session
        // expiry, so it shouldn't trigger a global auth-failure either. /me is deliberately
        // NOT special-cased here: it's called on every AuthProvider mount (including a plain
        // page reload), and the access token is short-lived (15m) — treating its 401 as
        // "session over" instead of running it through the refresh-then-retry flow below
        // logs the user out on any reload more than 15 minutes after their last token
        // refresh, even though their 7-day refresh token cookie is still perfectly valid.
        if (url.includes('/refresh') || url.includes('/login')) {
          window.dispatchEvent(new Event('auth-failure'));
          return Promise.reject(error);
        }

        if (isRefreshing) {
          return new Promise((resolve, reject) => {
            failedQueue.push({ resolve, reject });
          })
            .then(() => {
              return authApi(originalRequest);
            })
            .catch((err) => {
              return Promise.reject(err);
            });
        }

        originalRequest._retry = true;
        isRefreshing = true;

        try {
          await axios.post(`${API_URL}/refresh`, {}, { withCredentials: true });
          processQueue(null);
          isRefreshing = false;
          return authApi(originalRequest);
        } catch (refreshError) {
          processQueue(refreshError);
          isRefreshing = false;
          window.dispatchEvent(new Event('auth-failure'));
          return Promise.reject(refreshError);
        }
      }
    }

    return Promise.reject(error);
  }
);

export default authApi;
