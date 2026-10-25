'use client';

import { getAccessToken, getActiveBranchId, getApiUrl, getRefreshToken, setTokens, clearSession } from './auth';

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

export interface ApiRequestOptions extends RequestInit {
  skipAuthRedirect?: boolean;
  /** تثبيت الفرع المرسل في الطلب (يُستخدم عند مزامنة طابور قديم بعد تبديل الفرع) */
  branchId?: string | null;
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
  options: ApiRequestOptions = {},
  isRetry = false,
): Promise<T> {
  const token = getAccessToken();
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const activeBranchId = options.branchId === undefined ? getActiveBranchId() : options.branchId;
  if (activeBranchId) headers.set('x-branch-id', activeBranchId);

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
  get: <T>(path: string, options?: ApiRequestOptions) => request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: ApiRequestOptions) =>
    request<T>(path, {
      ...options,
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  patch: <T>(path: string, body?: unknown, options?: ApiRequestOptions) =>
    request<T>(path, {
      ...options,
      method: 'PATCH',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  put: <T>(path: string, body?: unknown, options?: ApiRequestOptions) =>
    request<T>(path, {
      ...options,
      method: 'PUT',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  del: <T>(path: string, options?: ApiRequestOptions) => request<T>(path, { ...options, method: 'DELETE' }),
  upload: <T>(path: string, formData: FormData, options?: ApiRequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body: formData }),
  /** تنزيل ملف من الـAPI (مع تجديد الجلسة) وحفظه على جهاز المستخدم */
  download: async (path: string, filename: string): Promise<void> => {
    const fetchFile = () => {
      const token = getAccessToken();
      const branchId = getActiveBranchId();
      return fetch(`${getApiUrl()}${path}`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(branchId ? { 'x-branch-id': branchId } : {}),
        },
      });
    };
    let response = await fetchFile();
    if (response.status === 401) {
      const refreshed = await tryRefresh();
      if (refreshed) response = await fetchFile();
    }
    if (!response.ok) {
      let message = `خطأ من الخادم (${response.status})`;
      try {
        const payload = (await response.json()) as { error?: ApiErrorShape };
        if (payload.error?.message) message = payload.error.message;
      } catch {
        // الرد ليس JSON — نُبقي الرسالة الافتراضية
      }
      throw new ApiClientError(response.status, { code: 'INTERNAL_ERROR', message });
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  },
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

/** فشل شبكة (لا رد من الخادم) وليس رفضًا من الـAPI */
export function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false);
}
