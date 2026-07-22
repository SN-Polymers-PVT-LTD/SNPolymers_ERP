import axios from 'axios';

const defaultApiUrl = typeof window !== 'undefined' && window.location.hostname !== 'localhost'
  ? `http://${window.location.hostname}:5000/api/v1/auth`
  : 'http://localhost:5000/api/v1/auth';

const API_URL = import.meta.env.VITE_API_URL || defaultApiUrl;

const authApi = axios.create({
  baseURL: API_URL,
  withCredentials: true, // enable carrying cookies (httpOnly session token)
  timeout: 15000, // 15 seconds timeout to prevent indefinite hangs
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

    if (
      error.response &&
      error.response.status === 401 &&
      error.response.data?.code === 'ACCESS_TOKEN_EXPIRED' &&
      !originalRequest._retry
    ) {
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
        // Use basic axios for refresh to bypass interceptor
        await axios.post(`${API_URL}/refresh`, {}, { withCredentials: true });
        
        processQueue(null);
        isRefreshing = false;
        
        return authApi(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError);
        isRefreshing = false;
        
        // Dispatch event so AuthContext or Router can handle logout
        window.dispatchEvent(new Event('auth-failure'));
        
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default authApi;
