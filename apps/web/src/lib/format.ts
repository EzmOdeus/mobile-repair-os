/** تنسيقات العرض العربية والأرقام والجنيه المصري */

const AR_DATE = new Intl.DateTimeFormat('ar-EG', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Africa/Cairo',
});

const AR_DATETIME = new Intl.DateTimeFormat('ar-EG', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Africa/Cairo',
});

const AR_TIME = new Intl.DateTimeFormat('ar-EG', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Africa/Cairo',
});

export function formatDate(value?: string | Date | null): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return AR_DATE.format(date);
}

export function formatDateTime(value?: string | Date | null): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return AR_DATETIME.format(date);
}

export function formatTime(value?: string | Date | null): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return AR_TIME.format(date);
}

/** المبلغ بصيغة 1,250.00 ج.م */
export function formatMoney(value?: number | null, withCurrency = true): string {
  const amount = Number(value ?? 0);
  const formatted = amount.toLocaleString('en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return withCurrency ? `${formatted} ج.م` : formatted;
}

export function formatNumber(value?: number | null, digits = 0): string {
  return Number(value ?? 0).toLocaleString('en-EG', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatPercent(value?: number | null, digits = 1): string {
  return `${Number(value ?? 0).toFixed(digits)}%`;
}

/** زمن نسبي بالعربية: قبل 3 ساعات */
export function timeAgo(value?: string | Date | null): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';

  const diffMs = Date.now() - date.getTime();
  const abs = Math.abs(diffMs);
  const minutes = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  const prefix = diffMs >= 0 ? 'قبل' : 'بعد';

  if (minutes < 1) return 'الآن';
  if (minutes < 60) return `${prefix} ${minutes} دقيقة`;
  if (hours < 24) return `${prefix} ${hours} ساعة`;
  if (days < 30) return `${prefix} ${days} يوم`;
  const months = Math.round(days / 30);
  if (months < 12) return `${prefix} ${months} شهر`;
  return `${prefix} ${Math.round(months / 12)} سنة`;
}

/** مدة بالساعات والدقائق */
export function formatDuration(minutes?: number | null): string {
  const total = Math.max(0, Number(minutes ?? 0));
  if (total < 60) return `${Math.round(total)} دقيقة`;
  const hours = Math.floor(total / 60);
  const rest = Math.round(total % 60);
  if (hours < 24) return rest ? `${hours} ساعة و${rest} دقيقة` : `${hours} ساعة`;
  const days = Math.floor(hours / 24);
  return `${days} يوم و${hours % 24} ساعة`;
}

export function maskImei(imei?: string | null): string {
  if (!imei) return '—';
  if (imei.length < 6) return '****';
  return `${imei.slice(0, 4)}${'*'.repeat(Math.max(0, imei.length - 7))}${imei.slice(-3)}`;
}

export function initials(name?: string): string {
  if (!name) return '؟';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]).join('');
}
