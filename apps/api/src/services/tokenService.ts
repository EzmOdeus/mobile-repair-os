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
}

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

/** تخزين رمز التجديد مُجزَّأً (لا نحفظ الرمز نفسه) */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generatePasswordResetToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}
