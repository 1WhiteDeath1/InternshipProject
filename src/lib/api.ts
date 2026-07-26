import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || '';

const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: { 'Content-Type': 'application/json' },
});

// "Remember me" unchecked: the token lives only here, for the lifetime of
// this tab's JS runtime - never written to localStorage, so a reload or a
// fresh tab loses it and the app falls back to the Login page.
let memoryToken: string | null = null;
export function setMemoryToken(token: string | null) {
  memoryToken = token;
}

export function getErrorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(err)) {
    const detail = err.response?.data?.detail;
    if (typeof detail === 'string') return detail;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token') || memoryToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const hasToken = localStorage.getItem('token') || memoryToken;

      // Only clear storage and force a hard redirect if a token actually existed
      // (meaning an active session expired)
      if (hasToken) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        memoryToken = null;
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
