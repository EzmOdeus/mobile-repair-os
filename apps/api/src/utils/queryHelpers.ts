import { ApiError } from '../utils/ApiError.js';

export interface ParsedListQuery {
  page: number;
  limit: number;
  skip: number;
}

export function parseListQuery(query: Record<string, unknown>, defaultLimit = 25, maxLimit = 200): ParsedListQuery {
  const page = Math.max(1, Number.parseInt(String(query.page ?? '1'), 10) || 1);
  const rawLimit = Number.parseInt(String(query.limit ?? defaultLimit), 10) || defaultLimit;
  const limit = Math.min(maxLimit, Math.max(1, rawLimit));
  return { page, limit, skip: (page - 1) * limit };
}

export function parseSort(
  query: Record<string, unknown>,
  allowed: string[],
  fallback: Record<string, 1 | -1> = { createdAt: -1 },
): Record<string, 1 | -1> {
  const raw = String(query.sort ?? '').trim();
  if (!raw) return fallback;
  const desc = raw.startsWith('-');
  const field = desc ? raw.slice(1) : raw;
  if (!allowed.includes(field)) {
    throw ApiError.badRequest(`حقل الترتيب غير مدعوم: ${field}`, { allowed });
  }
  return { [field]: desc ? -1 : 1 };
}

export function parseCsv(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.flatMap((v) => parseCsv(v));
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseDateRange(from?: unknown, to?: unknown): Record<string, Date> | undefined {
  const range: Record<string, Date> = {};
  if (from) {
    const d = new Date(String(from));
    if (!Number.isNaN(d.getTime())) range.$gte = d;
  }
  if (to) {
    const raw = String(to);
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) d.setUTCHours(23, 59, 59, 999);
      range.$lte = d;
    }
  }
  return Object.keys(range).length ? range : undefined;
}

export function parseBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  const v = String(value).toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(v)) return true;
  if (['false', '0', 'no', 'n'].includes(v)) return false;
  return undefined;
}

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

export function escapeRegex(input: string): string {
  return input.replace(REGEX_SPECIALS, '\\$&');
}

export function regexSearch(value: unknown): RegExp | undefined {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  return new RegExp(escapeRegex(raw), 'i');
}
