'use client';

import { getAccessToken, getApiUrl, getRefreshToken, setTokens, clearSession } from './auth';

export interface ApiErrorShape {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, error: ApiErrorShape) {
    super(error.message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = error.code;
    this.details = error.details;
  }
}

export interface ListMeta {
  page: number;
  limit: number;
  total: number;
  pages: number;
  hasNext?: boolean;
  hasPrev?: boolean;
  [key: string]: unknown;
}

export interface Paginated<T> {
  items: T[];
  meta: ListMeta;
}

let refreshInFlight: Promise<boolean> | null = null;

/** تجديد التوكن مرة واحدة عند انتهاء الصلاحية */
async function tryRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return false;
    try {
      const response = await fetch(`${getApiUrl()}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) return false;
      const payload = (await response.json()) as { data?: { accessToken: string; refreshToken: string } };
      if (!payload.data?.accessToken) return false;
      setTokens(payload.data.accessToken, payload.data.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

async function request<T>(
  path: string,
  options: RequestInit & { skipAuthRedirect?: boolean } = {},
  isRetry = false,
): Promise<T> {
  const token = getAccessToken();
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${getApiUrl()}${path}`, { ...options, headers });

  if (response.status === 401 && !isRetry) {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, options, true);
    clearSession();
    if (typeof window !== 'undefined' && !options.skipAuthRedirect) {
      window.location.href = '/login';
    }
    throw new ApiClientError(401, { code: 'UNAUTHORIZED', message: 'انتهت الجلسة، سجّل الدخول مرة أخرى' });
  }

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    if (!response.ok) {
      throw new ApiClientError(response.status, {
        code: 'INTERNAL_ERROR',
        message: `خطأ من الخادم (${response.status})`,
      });
    }
    return (await response.text()) as unknown as T;
  }

  const payload = (await response.json()) as {
    success: boolean;
    data?: T;
    meta?: ListMeta;
    error?: ApiErrorShape;
  };

  if (!response.ok || payload.success === false) {
    throw new ApiClientError(response.status, payload.error ?? { code: 'INTERNAL_ERROR', message: 'خطأ غير متوقع' });
  }

  return (payload.meta ? { items: payload.data, meta: payload.meta } : payload.data) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, formData: FormData) => request<T>(path, { method: 'POST', body: formData }),
};

/** دالة الجلب لـ SWR: تُرجع البيانات مباشرة وتُطلق خطأ ApiClientError */
export async function fetcher<T>(path: string): Promise<T> {
  return api.get<T>(path);
}

/** بناء سلسلة استعلام من كائن */
export function qs(params: Record<string, string | number | boolean | undefined | null | string[]>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length) search.set(key, value.join(','));
    } else {
      search.set(key, String(value));
    }
  }
  const str = search.toString();
  return str ? `?${str}` : '';
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) return err.message;
  if (err instanceof Error) return err.message;
  return 'حدث خطأ غير متوقع';
}
