/** أدوات حسابية للمبالغ بالجنيه المصري (تجنّب أخطاء الفاصلة العائمة) */

export function toNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : fallback;
}

/** تقريب لمكانين عشريين (قروش) */
export function money(value: unknown, fallback = 0): number {
  return Number(toNumber(value, fallback).toFixed(2));
}

export function addMoney(...values: unknown[]): number {
  const sum = values.reduce<number>((acc, v) => acc + toNumber(v), 0);
  return money(sum);
}

export function subtractMoney(a: unknown, b: unknown): number {
  return money(toNumber(a) - toNumber(b));
}

export function multiplyMoney(quantity: unknown, unitPrice: unknown): number {
  return money(toNumber(quantity) * toNumber(unitPrice));
}

/**
 * حساب الإجماليات.
 * taxInclusive = الضريبة مضمّنة في السعر (الشائع في السوق المصري للبيع للعميل النهائي).
 */
export function computeTotals(input: {
  lines: { quantity: number; unitPriceEgp: number }[];
  discountEgp?: number;
  discountPct?: number;
  taxRatePct?: number;
  taxInclusive?: boolean;
  paidEgp?: number;
}) {
  const subtotal = money(
    input.lines.reduce((acc, l) => acc + toNumber(l.quantity) * toNumber(l.unitPriceEgp), 0),
  );

  const discountFromPct = money((subtotal * toNumber(input.discountPct)) / 100);
  const discount = money(Math.min(subtotal, toNumber(input.discountEgp) || discountFromPct));

  const afterDiscount = money(subtotal - discount);
  const taxRate = toNumber(input.taxRatePct);

  let tax = 0;
  let total = afterDiscount;

  if (taxRate > 0) {
    if (input.taxInclusive === false) {
      tax = money((afterDiscount * taxRate) / 100);
      total = money(afterDiscount + tax);
    } else {
      // الضريبة مستخرجة من السعر
      tax = money(afterDiscount - afterDiscount / (1 + taxRate / 100));
      total = afterDiscount;
    }
  }

  const paid = money(input.paidEgp);
  const due = money(Math.max(0, total - paid));

  return {
    subtotalEgp: subtotal,
    discountEgp: discount,
    taxEgp: tax,
    totalEgp: total,
    paidEgp: paid,
    dueEgp: due,
  };
}

/** نسبة مئوية آمنة */
export function pct(part: number, whole: number, decimals = 2): number {
  if (!whole) return 0;
  return Number(((part / whole) * 100).toFixed(decimals));
}

export function sumBy<T>(items: T[], pick: (item: T) => number): number {
  return money(items.reduce((acc, item) => acc + toNumber(pick(item)), 0));
}
