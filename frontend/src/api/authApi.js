import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api/v1/auth';

const authApi = axios.create({
  baseURL: API_URL,
  withCredentials: true, // enable carrying cookies (httpOnly session token)
  headers: {
    'Content-Type': 'application/json',
  },
});

export default authApi;
