import axios from 'axios';

const TOKEN_KEY = 'ads_audit_token';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api',
  timeout: 30000,
  withCredentials: true,
});

// Anexa o JWT em toda request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Token expirado/inválido → limpa e volta para o login
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const code = error.response?.data?.code;
    if (code === 'token_expired' || code === 'invalid_token' || code === 'unauthorized') {
      clearToken();
      if (window.location.pathname !== '/login') window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

export const setToken = (token) => localStorage.setItem(TOKEN_KEY, token);
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

export function shopeeAuthorizeUrl(state) {
  return `${api.defaults.baseURL}/shopee/authorize?state=${encodeURIComponent(state)}`;
}

// Extrai a mensagem do formato padrão { error, code } do backend
export function apiErrorMessage(error, fallback = 'Algo deu errado') {
  return error?.response?.data?.error ?? fallback;
}
