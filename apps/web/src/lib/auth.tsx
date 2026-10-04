'use client';

import { useCallback, useEffect, useState } from 'react';

const ACCESS_KEY = 'mros.accessToken';
const REFRESH_KEY = 'mros.refreshToken';
const USER_KEY = 'mros.user';
const ORG_KEY = 'mros.organization';

export interface SessionUser {
  id: string;
  fullName: string;
  username: string;
  email: string;
  phone: string;
  role: Role;
  branchIds: string[];
  permissions: string[];
  technicianProfile?: {
    isTechnician?: boolean;
    specialities?: string[];
    skillLevel?: string;
    maxActiveJobs?: number;
    workbench?: string;
  } | null;
}

export type Role = 'owner' | 'admin' | 'manager' | 'receptionist' | 'technician' | 'accountant' | 'viewer';

export interface SessionOrganization {
  id: string;
  name: string;
  slug: string;
  settings?: Record<string, unknown>;
  subscription?: Record<string, unknown>;
}

export interface SessionBranch {
  id: string;
  name: string;
  code: string;
  isDefault?: boolean;
}

export const ROLE_LABELS_AR: Record<Role, string> = {
  owner: 'مالك المركز',
  admin: 'مدير النظام',
  manager: 'مدير فرع',
  receptionist: 'استقبال',
  technician: 'فني',
  accountant: 'محاسب',
  viewer: 'مشاهدة فقط',
};

export function getApiUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(REFRESH_KEY);
}

export function setTokens(accessToken: string, refreshToken?: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ACCESS_KEY, accessToken);
  if (refreshToken) window.localStorage.setItem(REFRESH_KEY, refreshToken);
}

export function clearSession(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(ACCESS_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
  window.localStorage.removeItem(USER_KEY);
  window.localStorage.removeItem(ORG_KEY);
}

export function getStoredUser(): SessionUser | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}

export function getStoredOrganization(): SessionOrganization | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(ORG_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionOrganization;
  } catch {
    return null;
  }
}

export function storeSession(user: SessionUser, organization: SessionOrganization): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  window.localStorage.setItem(ORG_KEY, JSON.stringify(organization));
}

/** بيانات تسجيل مركز جديد (Onboarding) */
export interface RegisterOrganizationPayload {
  organization: {
    name: string;
    nameEn?: string;
    phone?: string;
    email?: string;
    governorate?: string;
    city?: string;
  };
  owner: {
    fullName: string;
    username: string;
    password: string;
    email?: string;
    phone?: string;
  };
  branch?: {
    name: string;
    code: string;
  };
}

interface AuthContextValue {
  user: SessionUser | null;
  organization: SessionOrganization | null;
  branches: SessionBranch[];
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (identifier: string, password: string, organizationSlug?: string) => Promise<void>;
  /** إنشاء مركز جديد: يُنشئ المؤسسة + الفرع الرئيسي + حساب المالك ويسجّل الدخول فورًا */
  registerOrganization: (payload: RegisterOrganizationPayload) => Promise<{ slug: string; organizationName: string }>;
  logout: () => void;
  refreshProfile: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
  hasAnyRole: (...roles: Role[]) => boolean;
}

import { createContext, useContext, useMemo } from 'react';

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [organization, setOrganization] = useState<SessionOrganization | null>(null);
  const [branches, setBranches] = useState<SessionBranch[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
    const token = getAccessToken();
    if (!token) {
      setUser(null);
      setOrganization(null);
      setIsLoading(false);
      return;
    }

    try {
      let response = await fetch(`${getApiUrl()}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      /**
       * التوكن منتهي؟ نجدّد بصمت ثم نعيد المحاولة، بدل إسقاط الجلسة فورًا.
       * (قبل الإصلاح: أي تحميل للصفحة بعد 15 دقيقة كان يمسح جلسة صالحة كاملة
       * رغم أن refresh token ما زال سليمًا لـ30 يومًا.)
       */
      if (response.status === 401) {
        const refreshToken = getRefreshToken();
        if (refreshToken) {
          const refreshResponse = await fetch(`${getApiUrl()}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken }),
          });
          if (refreshResponse.ok) {
            const refreshPayload = (await refreshResponse.json()) as {
              data?: { accessToken: string; refreshToken?: string };
            };
            if (refreshPayload.data?.accessToken) {
              setTokens(refreshPayload.data.accessToken, refreshPayload.data.refreshToken);
              response = await fetch(`${getApiUrl()}/auth/me`, {
                headers: { Authorization: `Bearer ${refreshPayload.data.accessToken}` },
              });
            }
          }
        }
      }

      if (!response.ok) throw new Error('unauthenticated');
      const payload = (await response.json()) as {
        data: { user: SessionUser; organization: SessionOrganization | null; branches: SessionBranch[] };
      };
      setUser(payload.data.user);
      setOrganization(payload.data.organization);
      setBranches(payload.data.branches ?? []);
      if (payload.data.organization) storeSession(payload.data.user, payload.data.organization);
    } catch {
      clearSession();
      setUser(null);
      setOrganization(null);
      setBranches([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const stored = getStoredUser();
    const storedOrg = getStoredOrganization();
    if (stored) setUser(stored);
    if (storedOrg) setOrganization(storedOrg);
    void refreshProfile();
  }, [refreshProfile]);

  const login = useCallback(
    async (identifier: string, password: string, organizationSlug?: string) => {
      const response = await fetch(`${getApiUrl()}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password, organizationSlug }),
      });

      const payload = (await response.json()) as {
        success: boolean;
        data?: {
          accessToken: string;
          refreshToken: string;
          user: SessionUser;
          organization: SessionOrganization;
        };
        error?: { message: string; code: string; details?: unknown };
      };

      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error?.message ?? 'تعذر تسجيل الدخول');
      }

      setTokens(payload.data.accessToken, payload.data.refreshToken);
      storeSession(payload.data.user, payload.data.organization);
      setUser(payload.data.user);
      setOrganization(payload.data.organization);
      await refreshProfile();
    },
    [refreshProfile],
  );

  /**
   * تسجيل مركز جديد (Self-service Onboarding).
   * الـAPI يُنشئ: المؤسسة + الفرع الرئيسي + حساب المالك، ويُرجع توكن دخول مباشر،
   * فنُسجّل الدخول فورًا بدون خطوة إضافية على المستخدم.
   */
  const registerOrganization = useCallback(
    async (payload: RegisterOrganizationPayload) => {
      const response = await fetch(`${getApiUrl()}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = (await response.json()) as {
        success: boolean;
        data?: {
          accessToken: string;
          refreshToken: string;
          user: SessionUser;
          organization: SessionOrganization;
          branch: { id: string; name: string; code: string };
        };
        error?: {
          message: string;
          code: string;
          details?: { field: string; message: string }[] | unknown;
        };
      };

      if (!response.ok || !result.success || !result.data) {
        // نُرفق تفاصيل حقول التحقق إن وُجدت حتى تعرضها الصفحة بجانب كل حقل
        const error = new Error(result.error?.message ?? 'تعذر إنشاء الحساب') as Error & {
          code?: string;
          details?: unknown;
        };
        error.code = result.error?.code;
        error.details = result.error?.details;
        throw error;
      }

      setTokens(result.data.accessToken, result.data.refreshToken);
      storeSession(result.data.user, result.data.organization);
      setUser(result.data.user);
      setOrganization(result.data.organization);
      await refreshProfile();

      return { slug: result.data.organization.slug, organizationName: result.data.organization.name };
    },
    [refreshProfile],
  );

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
    setOrganization(null);
    setBranches([]);
  }, []);

  const hasPermission = useCallback(
    (permission: string) => {
      if (!user) return false;
      if (user.role === 'owner' || user.role === 'admin') return true;
      return user.permissions?.includes(permission) ?? false;
    },
    [user],
  );

  const hasAnyRole = useCallback(
    (...roles: Role[]) => {
      if (!user) return false;
      return roles.includes(user.role);
    },
    [user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      organization,
      branches,
      isLoading,
      isAuthenticated: Boolean(user),
      login,
      registerOrganization,
      logout,
      refreshProfile,
      hasPermission,
      hasAnyRole,
    }),
    [
      user,
      organization,
      branches,
      isLoading,
      login,
      registerOrganization,
      logout,
      refreshProfile,
      hasPermission,
      hasAnyRole,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth يجب أن يُستخدم داخل AuthProvider');
  return ctx;
}
