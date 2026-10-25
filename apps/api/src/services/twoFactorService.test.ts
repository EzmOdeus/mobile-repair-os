/**
 * اختبارات المصادقة الثنائية الأساسية:
 * - صحة توليد TOTP مقابل متجهات RFC 6238 (SHA1).
 * - قبول انحراف خطوة زمنية واحدة فقط.
 * - تشفير السر وفكّه ورفض أي عبث بالحزمة المشفّرة.
 * - شكل رموز الاسترداد وتطبيعها وتجزئتها.
 * - صيغة رابط otpauth لمسحه بتطبيقات المصادقة.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  TOTP_DIGITS,
  TOTP_PERIOD_SECONDS,
  base32Decode,
  base32Encode,
  buildOtpAuthUri,
  decryptTwoFactorSecret,
  encryptTwoFactorSecret,
  generateRecoveryCodes,
  generateTotp,
  generateTotpSecret,
  hashRecoveryCode,
  normalizeRecoveryCode,
  verifyTotp,
} from './twoFactorService.js';

/** السر القياسي في RFC 6238: ASCII "12345678901234567890" */
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'));
const KEY = 'unit-test-encryption-key-material-0123456789';

describe('base32', () => {
  it('يشفّر السر القياسي إلى القيمة المعروفة في RFC', () => {
    expect(RFC_SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(RFC_SECRET).toString('ascii')).toBe('12345678901234567890');
  });

  it('يتجاهل المسافات والرموز غير الصالحة ويتقبل الأحرف الصغيرة', () => {
    expect(base32Decode('gezd gnbv-gy3t')).toEqual(base32Decode('GEZDGNBVGY3T'));
  });

  it('ينتج سرًا عشوائيًا بطول 32 حرفًا صالحًا', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
    expect(generateTotpSecret()).not.toBe(secret);
  });
});

describe('TOTP (RFC 6238)', () => {
  const vectors: { seconds: number; code: string }[] = [
    { seconds: 59, code: '287082' },
    { seconds: 1_111_111_109, code: '081804' },
    { seconds: 1_111_111_111, code: '050471' },
    { seconds: 1_234_567_890, code: '005924' },
    { seconds: 2_000_000_000, code: '279037' },
    { seconds: 20_000_000_000, code: '353130' },
  ];

  it.each(vectors)('يطابق المتجه عند T=$seconds', ({ seconds, code }) => {
    expect(generateTotp(RFC_SECRET, seconds * 1000)).toBe(code);
    expect(code).toHaveLength(TOTP_DIGITS);
  });

  it('يقبل نفس الخطوة والخطوتين المجاورتين فقط', () => {
    const at = 1_700_000_000_000;
    const code = generateTotp(RFC_SECRET, at);
    const periodMs = TOTP_PERIOD_SECONDS * 1000;

    expect(verifyTotp(RFC_SECRET, code, at)).toBe(true);
    expect(verifyTotp(RFC_SECRET, code, at + periodMs)).toBe(true);
    expect(verifyTotp(RFC_SECRET, code, at - periodMs)).toBe(true);
    expect(verifyTotp(RFC_SECRET, code, at + periodMs * 2)).toBe(false);
    expect(verifyTotp(RFC_SECRET, code, at - periodMs * 2)).toBe(false);
    expect(verifyTotp(RFC_SECRET, code, at + periodMs * 2, 2)).toBe(true);
  });

  it('يقبل الرمز مع مسافات ويرفض الصيغ غير الصحيحة', () => {
    const at = 1_700_000_000_000;
    const code = generateTotp(RFC_SECRET, at);

    expect(verifyTotp(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, at)).toBe(true);
    expect(verifyTotp(RFC_SECRET, '12345', at)).toBe(false);
    expect(verifyTotp(RFC_SECRET, 'abcdef', at)).toBe(false);
    expect(verifyTotp(RFC_SECRET, '', at)).toBe(false);
    expect(verifyTotp('', code, at)).toBe(false);
  });
});

describe('تشفير سر 2FA', () => {
  it('يعيد نفس السر بعد فك التشفير', () => {
    const secret = generateTotpSecret();
    const encrypted = encryptTwoFactorSecret(secret, KEY);

    expect(encrypted).not.toContain(secret);
    expect(encrypted.startsWith('v1:')).toBe(true);
    expect(decryptTwoFactorSecret(encrypted, KEY)).toBe(secret);
  });

  it('ينتج حزمة مختلفة في كل مرة بفضل IV عشوائي', () => {
    const secret = generateTotpSecret();
    const first = encryptTwoFactorSecret(secret, KEY);
    const second = encryptTwoFactorSecret(secret, KEY);

    expect(first).not.toBe(second);
    expect(decryptTwoFactorSecret(first, KEY)).toBe(secret);
    expect(decryptTwoFactorSecret(second, KEY)).toBe(secret);
  });

  it('يرفض حزمة معدّلة أو مفتاحًا خاطئًا أو صيغة غير صحيحة', () => {
    const encrypted = encryptTwoFactorSecret(generateTotpSecret(), KEY);
    const [version, iv, tag, ciphertext] = encrypted.split(':');
    const tampered = [
      version,
      iv,
      tag,
      (ciphertext!.startsWith('A') ? 'B' : 'A') + ciphertext!.slice(1),
    ].join(':');

    expect(() => decryptTwoFactorSecret(tampered, KEY)).toThrow();
    expect(() => decryptTwoFactorSecret(encrypted, `${KEY}-other`)).toThrow();
    expect(() => decryptTwoFactorSecret('v2:a:b:c', KEY)).toThrow();
    expect(() => decryptTwoFactorSecret('not-a-payload', KEY)).toThrow();
  });

  it('يرفض التشفير بلا أي مفتاح متاح', () => {
    const previousEncryption = process.env.TWO_FACTOR_ENCRYPTION_KEY;
    const previousJwt = process.env.JWT_ACCESS_SECRET;
    delete process.env.TWO_FACTOR_ENCRYPTION_KEY;
    delete process.env.JWT_ACCESS_SECRET;

    try {
      expect(() => encryptTwoFactorSecret('SECRET')).toThrow(/TWO_FACTOR_ENCRYPTION_KEY/);
    } finally {
      if (previousEncryption === undefined) delete process.env.TWO_FACTOR_ENCRYPTION_KEY;
      else process.env.TWO_FACTOR_ENCRYPTION_KEY = previousEncryption;
      if (previousJwt === undefined) delete process.env.JWT_ACCESS_SECRET;
      else process.env.JWT_ACCESS_SECRET = previousJwt;
    }
  });
});

describe('رموز الاسترداد', () => {
  it('يولّد 8 رموز فريدة بصيغة xxxx-xxxx-xxxx مع تجزئات SHA-256', () => {
    const { codes, hashes } = generateRecoveryCodes();

    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    expect(hashes).toHaveLength(8);
    for (const code of codes) expect(code).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    for (const hash of hashes) expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('يطبّع الإدخال قبل التجزئة فيقبل الصيغ المختلفة للرمز نفسه', () => {
    expect(normalizeRecoveryCode('ab cd-ef12-3456')).toBe('ABCDEF123456');
    expect(normalizeRecoveryCode('ABCD-EF12-3456')).toBe('ABCDEF123456');

    const expected = createHash('sha256').update('ABCDEF123456').digest('hex');
    expect(hashRecoveryCode('ABCD-EF12-3456')).toBe(expected);
    expect(hashRecoveryCode('abcd ef12 3456')).toBe(expected);
  });
});

describe('buildOtpAuthUri', () => {
  it('يبني رابط otpauth صالحًا بتسمية مؤسسية وكل المعاملات المطلوبة', () => {
    const uri = buildOtpAuthUri({
      secret: RFC_SECRET,
      username: 'owner',
      organizationSlug: 'test-center',
      organizationName: 'مركز الاختبار',
    });
    const parsed = new URL(uri);

    expect(parsed.protocol).toBe('otpauth:');
    expect(parsed.host).toBe('totp');
    expect(decodeURIComponent(parsed.pathname.slice(1))).toBe('owner@test-center');
    expect(parsed.searchParams.get('secret')).toBe(RFC_SECRET);
    expect(parsed.searchParams.get('issuer')).toBe('Mobile Repair OS');
    expect(parsed.searchParams.get('algorithm')).toBe('SHA1');
    expect(parsed.searchParams.get('digits')).toBe('6');
    expect(parsed.searchParams.get('period')).toBe('30');
    expect(parsed.searchParams.get('description')).toBe('مركز الاختبار');
  });

  it('يستخدم اسم المستخدم وحده عند غياب slug المؤسسة', () => {
    const uri = buildOtpAuthUri({ secret: RFC_SECRET, username: 'tech-1' });
    const parsed = new URL(uri);

    expect(decodeURIComponent(parsed.pathname.slice(1))).toBe('tech-1');
    expect(parsed.searchParams.get('description')).toBeNull();
  });
});
