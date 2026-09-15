import axios, { AxiosError } from 'axios';

/**
 * Axios instance configured for API requests
 *
 * 刻意使用**相对路径** `/api`：前端不硬编码任何服务器地址，完全依赖同源请求。
 *   - 开发态：由 Vite dev server 的 proxy 转发到后端（目标见 vite.config.ts 的 WORKER_DEV_ORIGIN）
 *   - 生产态：与站点同源，由 Worker 的 run_worker_first 接管 /api/*
 * 因此切换服务器地址只需改代理/部署配置，前端代码无需改动。
 * 也正因如此，不需要 VITE_API_BASE_URL 之类的构建期变量。
 */
export const apiClient = axios.create({
  baseURL: '/api',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Request interceptor
 * Automatically adds authentication token to requests if available
 */
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

/**
 * Response interceptor
 * Handles common error scenarios like 401 unauthorized
 */
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    // Handle 401 Unauthorized - redirect to login
    if (error.response?.status === 401) {
      localStorage.removeItem('auth_token');
      // Uncomment when you have a login page
      // window.location.href = '/login';
    }

    // Handle 403 Forbidden
    if (error.response?.status === 403) {
      console.error('Access forbidden');
    }

    // Handle 500 Internal Server Error
    if (error.response?.status === 500) {
      console.error('Server error occurred');
    }

    return Promise.reject(error);
  }
);

/**
 * Type-safe error handler for API errors
 */
export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.message || error.message || 'An error occurred';
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'An unknown error occurred';
}

export default apiClient;

