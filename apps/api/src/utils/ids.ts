import { randomBytes, randomUUID } from 'node:crypto';

/** سلسلة عشوائية آمنة للروابط العامة (تتبع التذاكر) */
export function publicToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

/** رمز قصير للعرض البشري (مثال: 7F3KQ2) */
const HUMAN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function humanCode(length = 6): string {
  const buf = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += HUMAN_ALPHABET[buf[i]! % HUMAN_ALPHABET.length];
  }
  return out;
}

export function uuid(): string {
  return randomUUID();
}

/** بناء رقم تذكرة/فاتورة: PREFIX-YYMM-000123 */
export function formatSequenceNumber(prefix: string, sequence: number, date = new Date()): string {
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${prefix.toUpperCase()}-${yy}${mm}-${String(sequence).padStart(6, '0')}`;
}

/**
 * تحويل صوتي تقريبي للحروف العربية إلى لاتينية.
 *
 * الغرض: أسماء المراكز في مصر عربية غالبًا، واسم مثل «مركز النور للموبايل»
 * يجب أن يُنتج معرّفًا مفهومًا (`markaz-alnoor`) لا `org-xxxx`. التحويل تقريبي
 * بطبيعته (العربية أبجدية بلا حركات قصيرة)، والمطلوب slug مستقر ومقروء لا نطق دقيق.
 */
const ARABIC_TRANSLITERATION: Record<string, string> = {
  ا: 'a', أ: 'a', إ: 'i', آ: 'a', ٱ: 'a', ء: '', ؤ: 'o', ئ: 'e',
  ب: 'b', ت: 't', ث: 'th', ج: 'g', ح: 'h', خ: 'kh', د: 'd', ذ: 'z',
  ر: 'r', ز: 'z', س: 's', ش: 'sh', ص: 's', ض: 'd', ط: 't', ظ: 'z',
  ع: 'a', غ: 'gh', ف: 'f', ق: 'k', ك: 'k', ل: 'l', م: 'm', ن: 'n',
  ه: 'h', و: 'o', ي: 'i', ى: 'a', ة: 'a', ﻻ: 'la',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

/** يحوّل النص العربي إلى حروف لاتينية تقريبية (يستخدمه مولّد الـslug فقط) */
export function transliterateArabic(input: string): string {
  let out = '';
  for (const char of input.normalize('NFKD')) {
    // نتجاهل الحركات والتشكيل والتطويل
    if (/[\u064B-\u0652\u0670\u0640]/.test(char)) continue;
    out += ARABIC_TRANSLITERATION[char] ?? char;
  }
  return out;
}

/**
 * Slug آمن للاستخدام في الروابط.
 *
 * نُبقي حروف ASCII فقط (a-z، 0-9) مع الشرطات. السبب عملي: الـslug يُكتب يدويًا
 * في حقل «معرّف المركز» عند تسجيل الدخول، ويُستخدم في الروابط. اسم مركز عربي
 * كان يُنتج slug بحروف عربية (مثل: مركز-النور-nars) وهو غير عملي: يحتاج ترميزًا
 * في كل رابط، ولا يمكن كتابته بسهولة في حقل الدخول.
 *
 * الأسماء العربية تُحوَّل صوتيًا أولًا، فإن بقيت بلا حروف لاتينية (اسم غير عربي)
 * نستخدم البديل الإنجليزي إن وُجد، وإلا `org` مع اللاحقة العشوائية الفريدة.
 */
export function slugify(input: string): string {
  return transliterateArabic(input.toString())
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

/**
 * slug فريد للمؤسسة.
 * @param input اسم المؤسسة (عربي أو إنجليزي)
 * @param fallbackSource نص لاتيني بديل يُستخدم لو كان الاسم عربيًا بالكامل
 */
export function slugifyWithSuffix(input: string, fallbackSource = ''): string {
  const base = slugify(input) || slugify(fallbackSource) || 'org';
  return `${base}-${humanCode(4).toLowerCase()}`;
}
