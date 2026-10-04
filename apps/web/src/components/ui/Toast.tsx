'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, X, XCircle } from 'lucide-react';

type ToastKind = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  push: (kind: ToastKind, message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const STYLES: Record<ToastKind, { bg: string; icon: React.ReactNode }> = {
  success: { bg: 'bg-emerald-600', icon: <CheckCircle2 size={18} /> },
  error: { bg: 'bg-red-600', icon: <XCircle size={18} /> },
  warning: { bg: 'bg-amber-600', icon: <AlertTriangle size={18} /> },
  info: { bg: 'bg-ink-800', icon: <Info size={18} /> },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setToasts((prev) => [...prev, { id, kind, message }]);
      setTimeout(() => remove(id), kind === 'error' ? 7000 : 4000);
    },
    [remove],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      push,
      success: (m: string) => push('success', m),
      error: (m: string) => push('error', m),
      info: (m: string) => push('info', m),
      warning: (m: string) => push('warning', m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 left-4 z-[100] flex w-[min(92vw,26rem)] flex-col gap-2" dir="rtl">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm text-white shadow-lg ${STYLES[toast.kind].bg}`}
            role="status"
          >
            <span className="mt-0.5 shrink-0">{STYLES[toast.kind].icon}</span>
            <p className="flex-1 leading-relaxed">{toast.message}</p>
            <button
              type="button"
              onClick={() => remove(toast.id)}
              className="shrink-0 rounded p-0.5 opacity-80 transition hover:opacity-100"
              aria-label="إغلاق"
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast يجب أن يُستخدم داخل ToastProvider');
  return ctx;
}
