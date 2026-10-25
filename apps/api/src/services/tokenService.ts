import jwt, { type SignOptions } from 'jsonwebtoken';
import { createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import type { Role } from '../constants/roles.js';

export interface AccessTokenPayload {
  sub: string; // userId
  org: string; // organizationId
  br: string | null; // branchId النشط
  role: Role;
  permissions: string[];
  name: string;
  typ: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  org: string;
  jti: string;
  typ: 'refresh';
  /** وقت الإصدار (ثوانٍ) — يُستخدم لإبطال جلسات أُنشئت قبل تفعيل 2FA */
  iat?: number;
}

export interface TwoFactorChallengePayload {
  sub: string;
  org: string;
  typ: '2fa_challenge';
}

/**
 * توكن قصير العمر يُصدر بعد كلمة المرور الصحيحة فقط. موقع بمفتاح مشتق
 * مختلف عن توكن الوصول، و`typ` مختلف، فلا يصلح كمصادقة على أي مسار آخر.
 */
const twoFactorChallengeSecret = () => `${env.JWT_ACCESS_SECRET}:2fa-challenge`;

export function signAccessToken(payload: Omit<AccessTokenPayload, 'typ'>, ttl = env.JWT_ACCESS_TTL): string {
  const options: SignOptions = { expiresIn: ttl as SignOptions['expiresIn'], issuer: 'mros-api', audience: 'mros-app' };
  return jwt.sign({ ...payload, typ: 'access' }, env.JWT_ACCESS_SECRET, options);
}

export function signRefreshToken(payload: Omit<RefreshTokenPayload, 'typ' | 'jti'> & { jti?: string }, ttl = env.JWT_REFRESH_TTL): string {
  const options: SignOptions = { expiresIn: ttl as SignOptions['expiresIn'], issuer: 'mros-api', audience: 'mros-app' };
  return jwt.sign(
    { ...payload, jti: payload.jti ?? randomBytes(16).toString('hex'), typ: 'refresh' },
    env.JWT_REFRESH_SECRET,
    options,
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: 'mros-api',
      audience: 'mros-app',
    }) as AccessTokenPayload;
    if (decoded.typ !== 'access') throw new Error('نوع التوكن غير صحيح');
    return decoded;
  } catch (err) {
    const name = (err as Error).name;
    if (name === 'TokenExpiredError') throw ApiError.unauthorized('انتهت صلاحية الجلسة، سجّل الدخول مرة أخرى');
    throw ApiError.unauthorized('توكن الدخول غير صحيح');
  }
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET, {
      issuer: 'mros-api',
      audience: 'mros-app',
    }) as RefreshTokenPayload;
    if (decoded.typ !== 'refresh') throw new Error('نوع التوكن غير صحيح');
    return decoded;
  } catch (err) {
    const name = (err as Error).name;
    if (name === 'TokenExpiredError') throw ApiError.unauthorized('انتهت صلاحية الجلسة، سجّل الدخول مرة أخرى');
    throw ApiError.unauthorized('توكن التجديد غير صحيح');
  }
}

export function signTwoFactorChallenge(
  payload: Omit<TwoFactorChallengePayload, 'typ'>,
  ttlMinutes = env.TWO_FACTOR_CHALLENGE_TTL_MINUTES,
): string {
  const options: SignOptions = {
    expiresIn: `${ttlMinutes}m` as SignOptions['expiresIn'],
    issuer: 'mros-api',
    audience: 'mros-app',
  };
  return jwt.sign({ ...payload, typ: '2fa_challenge' }, twoFactorChallengeSecret(), options);
}

export function verifyTwoFactorChallenge(token: string): TwoFactorChallengePayload {
  try {
    const decoded = jwt.verify(token, twoFactorChallengeSecret(), {
      issuer: 'mros-api',
      audience: 'mros-app',
    }) as TwoFactorChallengePayload;
    if (decoded.typ !== '2fa_challenge' || !decoded.sub || !decoded.org) {
      throw new Error('نوع التوكن غير صحيح');
    }
    return decoded;
  } catch (err) {
    const name = (err as Error).name;
    if (name === 'TokenExpiredError') {
      throw ApiError.unauthorized('انتهت صلاحية خطوة التحقق، أعد تسجيل الدخول');
    }
    throw ApiError.unauthorized('توكن التحقق بخطوتين غير صحيح');
  }
}

/** تخزين رمز التجديد مُجزَّأً (لا نحفظ الرمز نفسه) */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generatePasswordResetToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}
