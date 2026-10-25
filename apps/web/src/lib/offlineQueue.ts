'use client';

import { ApiClientError, api, errorMessage } from './api';
import { getStoredOrganization, getStoredUser } from './auth';

/**
 * طابور محلي لإنشاء التذاكر أثناء انقطاع الشبكة.
 *
 * التخزين في localStorage لأنه بيانات نصية صغيرة تكفي عشرات التذاكر، ويبقى
 * متاحًا بعد إغلاق التطبيق. كل عنصر مرتبط بالمؤسسة والمستخدم والفرع وقت الإنشاء،
 * فلا يُزامَن بواسطة مستخدم آخر على نفس الجهاز ولا يُرسَل لفرع مختلف.
 */

export const OFFLINE_QUEUE_KEY = 'mros.offlineQueue.v1';
const QUEUE_EVENT = 'mros:offline-queue';

export type QueueItemStatus = 'pending' | 'failed';

export interface QueuedTicket {
  id: string;
  kind: 'ticket.create';
  path: string;
  body: Record<string, unknown>;
  branchId: string | null;
  organizationId: string;
  userId: string;
  createdAt: string;
  attempts: number;
  lastError: string | null;
  status: QueueItemStatus;
}

interface QueueOwner {
  organizationId: string;
  userId: string;
}

export interface QueueSummary {
  pending: number;
  failed: number;
  total: number;
}

export interface FlushResult {
  synced: number;
  failed: number;
  remaining: number;
  skipped: boolean;
}

function emit(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(QUEUE_EVENT));
}

function readAll(): QueuedTicket[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is QueuedTicket =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as QueuedTicket).id === 'string' &&
        typeof (item as QueuedTicket).body === 'object' &&
        typeof (item as QueuedTicket).organizationId === 'string' &&
        typeof (item as QueuedTicket).userId === 'string',
    );
  } catch {
    return [];
  }
}

function writeAll(items: QueuedTicket[]): void {
  window.localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(items));
  emit();
}

export function getQueueOwner(): QueueOwner | null {
  const user = getStoredUser();
  const organization = getStoredOrganization();
  if (!user?.id || !organization?.id) return null;
  return { organizationId: organization.id, userId: user.id };
}

export function listQueue(owner: QueueOwner | null = getQueueOwner()): QueuedTicket[] {
  if (!owner) return [];
  return readAll()
    .filter((item) => item.organizationId === owner.organizationId && item.userId === owner.userId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getQueueSummary(owner: QueueOwner | null = getQueueOwner()): QueueSummary {
  const items = listQueue(owner);
  return {
    pending: items.filter((item) => item.status === 'pending').length,
    failed: items.filter((item) => item.status === 'failed').length,
    total: items.length,
  };
}

export function createClientRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `offline-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function enqueueTicket(
  body: Record<string, unknown>,
  branchId: string | null = null,
): QueuedTicket {
  const owner = getQueueOwner();
  if (!owner) throw new Error('لا توجد جلسة نشطة لحفظ التذكرة محليًا');

  const item: QueuedTicket = {
    id: createClientRequestId(),
    kind: 'ticket.create',
    path: '/tickets',
    body,
    branchId,
    organizationId: owner.organizationId,
    userId: owner.userId,
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
    status: 'pending',
  };
  writeAll([...readAll(), item]);
  return item;
}

export function removeQueueItem(id: string): void {
  const owner = getQueueOwner();
  if (!owner) return;
  writeAll(
    readAll().filter(
      (item) =>
        item.id !== id ||
        item.organizationId !== owner.organizationId ||
        item.userId !== owner.userId,
    ),
  );
}

export function retryQueueItem(id: string): void {
  const owner = getQueueOwner();
  if (!owner) return;
  writeAll(
    readAll().map((item) =>
      item.id === id && item.organizationId === owner.organizationId && item.userId === owner.userId
        ? { ...item, status: 'pending', attempts: 0, lastError: null }
        : item,
    ),
  );
}

function updateItem(id: string, patch: Partial<QueuedTicket>): void {
  writeAll(readAll().map((item) => (item.id === id ? { ...item, ...patch } : item)));
}

function isPermanentFailure(error: unknown): boolean {
  if (!(error instanceof ApiClientError)) return false;
  if (error.status === 401 || error.status === 408 || error.status === 429) return false;
  return error.status >= 400 && error.status < 500;
}

let flushInFlight: Promise<FlushResult> | null = null;

/** مزامنة عناصر الطابور بالترتيب. آمنة للاستدعاء المتكرر في نفس اللحظة. */
export function flushOfflineQueue(): Promise<FlushResult> {
  if (flushInFlight) return flushInFlight;

  flushInFlight = (async (): Promise<FlushResult> => {
    const owner = getQueueOwner();
    if (!owner) return { synced: 0, failed: 0, remaining: 0, skipped: true };
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const summary = getQueueSummary(owner);
      return { synced: 0, failed: 0, remaining: summary.total, skipped: true };
    }

    let synced = 0;
    let failed = 0;
    const items = listQueue(owner).filter((item) => item.status === 'pending');

    for (const item of items) {
      const current = readAll().find((entry) => entry.id === item.id);
      if (!current || current.status !== 'pending') continue;

      try {
        await api.post(current.path, current.body, {
          branchId: current.branchId,
          skipAuthRedirect: true,
        });
        writeAll(readAll().filter((entry) => entry.id !== item.id));
        synced += 1;
      } catch (error) {
        const permanent = isPermanentFailure(error);
        updateItem(item.id, {
          attempts: current.attempts + 1,
          lastError: errorMessage(error),
          status: permanent ? 'failed' : 'pending',
        });
        if (permanent) {
          failed += 1;
          continue;
        }
        // خطأ شبكة/خادم/جلسة: نوقف الدفعة كلها ونعيد المحاولة لاحقًا
        break;
      }
    }

    return { synced, failed, remaining: getQueueSummary(owner).total, skipped: false };
  })();

  return flushInFlight.finally(() => {
    flushInFlight = null;
  });
}

export function subscribeToQueue(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key === OFFLINE_QUEUE_KEY) listener();
  };
  window.addEventListener(QUEUE_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(QUEUE_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}
