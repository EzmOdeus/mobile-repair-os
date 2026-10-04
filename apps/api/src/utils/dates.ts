import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import relativeTime from 'dayjs/plugin/relativeTime.js';
import 'dayjs/locale/ar.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(relativeTime);
dayjs.locale('ar');

export const CAIRO_TZ = 'Africa/Cairo';

export { dayjs };

/** بداية اليوم بتوقيت القاهرة */
export function startOfDayCairo(date: Date | string = new Date()): Date {
  return dayjs(date).tz(CAIRO_TZ).startOf('day').toDate();
}

/** نهاية اليوم بتوقيت القاهرة */
export function endOfDayCairo(date: Date | string = new Date()): Date {
  return dayjs(date).tz(CAIRO_TZ).endOf('day').toDate();
}

export function addHours(date: Date | string, hours: number): Date {
  return dayjs(date).add(hours, 'hour').toDate();
}

export function addDays(date: Date | string, days: number): Date {
  return dayjs(date).add(days, 'day').toDate();
}

export function diffMinutes(from: Date | string, to: Date | string = new Date()): number {
  return Math.max(0, dayjs(to).diff(dayjs(from), 'minute'));
}

export function diffDays(from: Date | string, to: Date | string = new Date()): number {
  return dayjs(to).diff(dayjs(from), 'day');
}

export function isPast(date: Date | string | null | undefined): boolean {
  if (!date) return false;
  return dayjs(date).isBefore(dayjs());
}

/** تنسيق تاريخ مقروء بالعربية */
export function formatDateTimeAr(date: Date | string | null | undefined): string {
  if (!date) return '';
  return dayjs(date).tz(CAIRO_TZ).format('YYYY-MM-DD HH:mm');
}

export function formatDateAr(date: Date | string | null | undefined): string {
  if (!date) return '';
  return dayjs(date).tz(CAIRO_TZ).format('YYYY-MM-DD');
}

/** نطاق فترة جاهزة للاستعلام */
export function periodRange(
  period: 'today' | 'week' | 'month' | 'quarter' | 'year' | 'last30',
): { from: Date; to: Date } {
  const now = dayjs().tz(CAIRO_TZ);
  switch (period) {
    case 'today':
      return { from: now.startOf('day').toDate(), to: now.endOf('day').toDate() };
    case 'week':
      return { from: now.startOf('week').toDate(), to: now.endOf('week').toDate() };
    case 'month':
      return { from: now.startOf('month').toDate(), to: now.endOf('month').toDate() };
    case 'quarter':
      return {
        from: now.startOf('quarter' as never).toDate(),
        to: now.endOf('quarter' as never).toDate(),
      };
    case 'year':
      return { from: now.startOf('year').toDate(), to: now.endOf('year').toDate() };
    case 'last30':
    default:
      return { from: now.subtract(29, 'day').startOf('day').toDate(), to: now.endOf('day').toDate() };
  }
}

/** مفتاح الشهر YYYY-MM للتجميع */
export function monthKey(date: Date | string): string {
  return dayjs(date).tz(CAIRO_TZ).format('YYYY-MM');
}

/**
 * نطاق الشهر الميلادي الجاري بتوقيت القاهرة.
 * يُستخدم لفرض حد التذاكر الشهري في الباقة، فيجب أن يطابق الشهر الذي يراه المستخدم.
 */
export function monthRange(reference: Date = new Date()): { from: Date; to: Date } {
  const now = dayjs(reference).tz(CAIRO_TZ);
  return { from: now.startOf('month').toDate(), to: now.endOf('month').toDate() };
}

export function dayKey(date: Date | string): string {
  return dayjs(date).tz(CAIRO_TZ).format('YYYY-MM-DD');
}
