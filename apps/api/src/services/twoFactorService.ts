import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';

/**
 * المصادقة الثنائية (TOTP / RFC 6238) بحساب متوافق مع Google Authenticator
 * وAuthy و1Password. الأسرار تُخزَّن مشفّرة AES-256-GCM ولا تُعاد بعد التفعيل،
 * ورموز الاسترداد تُخزَّن كـSHA-256 فقط وتُستهلك مرة واحدة.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
const DEFAULT_ISSUER = 'Mobile Repair OS';
const RECOVERY_CODE_COUNT = 8;

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];

  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function buildOtpAuthUri(input: {
  secret: string;
  username: string;
  organizationSlug?: string;
  issuer?: string;
  organizationName?: string;
}): string {
  const issuer = input.issuer ?? DEFAULT_ISSUER;
  const label = input.organizationSlug ? `${input.username}@${input.organizationSlug}` : input.username;
  const params = new URLSearchParams({
    secret: input.secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  if (input.organizationName) params.set('description', input.organizationName);

  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

function hotp(key: Buffer, counter: number): string {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', key).update(buffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** TOTP_DIGITS;
  return String(binary).padStart(TOTP_DIGITS, '0');
}

export function generateTotp(secret: string, at = Date.now()): string {
  const step = Math.floor(at / 1000 / TOTP_PERIOD_SECONDS);
  return hotp(base32Decode(secret), step);
}

/** يقبل خطوة زمنية قبل/بعد لتغطية انحراف ساعة الجهاز. */
export function verifyTotp(secret: string, code: string, at = Date.now(), window = 1): boolean {
  const normalized = code.replace(/\s+/g, '');
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(normalized)) return false;

  try {
    const key = base32Decode(secret);
    if (!key.length) return false;
    const step = Math.floor(at / 1000 / TOTP_PERIOD_SECONDS);
    const provided = Buffer.from(normalized);

    for (let offset = -window; offset <= window; offset += 1) {
      const candidate = Buffer.from(hotp(key, step + offset));
      if (candidate.length === provided.length && timingSafeEqual(candidate, provided)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function encryptionKey(material?: string): Buffer {
  const source = material ?? process.env.TWO_FACTOR_ENCRYPTION_KEY ?? process.env.JWT_ACCESS_SECRET;
  if (!source) {
    throw new Error('TWO_FACTOR_ENCRYPTION_KEY أو JWT_ACCESS_SECRET مطلوب لتشفير أسرار المصادقة الثنائية');
  }
  return createHash('sha256').update(`mros-2fa:v1:${source}`).digest();
}

export function encryptTwoFactorSecret(secret: string, keyMaterial?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(keyMaterial), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return ['v1', iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join(':');
}

export function decryptTwoFactorSecret(payload: string, keyMaterial?: string): string {
  const [version, iv, tag, encrypted] = payload.split(':');
  if (version !== 'v1' || !iv || !tag || !encrypted) {
    throw new Error('صيغة سر المصادقة الثنائية غير صحيحة');
  }

  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(keyMaterial), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
}

export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: count }, () => {
    const raw = randomBytes(6).toString('hex').toUpperCase();
    return raw.match(/.{1,4}/g)!.join('-');
  });
  return { codes, hashes: codes.map(hashRecoveryCode) };
}

export async function buildTotpQrDataUrl(otpauthUri: string): Promise<string> {
  return QRCode.toDataURL(otpauthUri, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 240,
  });
}
