/**
 * Axios API client — HIPAA token security
 *
 * - Access token: read from in-memory store (not localStorage)
 * - Refresh token: httpOnly cookie sent automatically by browser via withCredentials
 * - 401 auto-refresh: triggers silent token refresh, retries original request once
 * - On refresh failure: clears session and redirects to login
 */

import axios from 'axios';
import { getAccessToken, setAccessToken, clearAccessToken } from './auth';

const BASE_URL = (import.meta as any).env?.VITE_API_URL ?? '/api';

export const api = axios.create({
  baseURL:         BASE_URL,
  withCredentials: true   // required for httpOnly refresh cookie to be sent
});

// Attach access token from memory (never from localStorage)
api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Endpoints that should NOT trigger auto-refresh on 401
const NO_REFRESH_ENDPOINTS = ['/auth/login', '/auth/refresh'];

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const requestUrl      = originalRequest?.url ?? '';

    // Don't intercept auth-specific endpoints
    if (NO_REFRESH_ENDPOINTS.some((ep) => requestUrl.endsWith(ep))) {
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        // Refresh token is sent automatically via httpOnly cookie (withCredentials=true)
        const { data } = await axios.post(
          `${BASE_URL}/auth/refresh`,
          {},
          { withCredentials: true }
        );
        setAccessToken(data.accessToken);
        originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(originalRequest);
      } catch {
        // Refresh failed — clear in-memory token, redirect to login
        clearAccessToken();
        sessionStorage.removeItem('pacsUser');
        window.location.href = '/';
        return Promise.reject(error);
      }
    }
    return Promise.reject(error);
  }
);

export function getFilesBaseUrl(): string {
  return (import.meta as any).env?.VITE_FILES_URL ?? '/files';
}
