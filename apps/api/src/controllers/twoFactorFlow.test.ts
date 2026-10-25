/**
 * اختبار تكاملي لمسار المصادقة الثنائية كاملًا عبر HTTP:
 * دخول عادي → إعداد → تفعيل → تحدي دخول → رمز خاطئ → TOTP → رمز استرداد →
 * إبطال جلسة قديمة عند التجديد → إيقاف → إعادة تعيين بواسطة الإدارة.
 *
 * ملاحظة: نحقن متغيرات البيئة قبل تحميل `createApp` لأن `config/env.ts` يتحقق
 * منها عند الاستيراد و`logger` يعتمد عليه. هذا يجعل الملف يعمل في CI بلا .env.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import {
  encryptTwoFactorSecret,
  generateRecoveryCodes,
  generateTotp,
  generateTotpSecret,
} from '../services/twoFactorService.js';

const TEST_URI = process.env.MONGODB_TEST_URI ?? 'mongodb://127.0.0.1:27017/mobile_repair_os_vitest';
const ACCESS_SECRET = 'test-access-secret-for-2fa-flow-0123456789abcdef';
const REFRESH_SECRET = 'test-refresh-secret-for-2fa-flow-0123456789abcdef';
const ENCRYPTION_KEY = 'test-two-factor-encryption-key-0123456789abcdef';

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = TEST_URI;
process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
process.env.JWT_REFRESH_SECRET = REFRESH_SECRET;
process.env.TWO_FACTOR_ENCRYPTION_KEY = ENCRYPTION_KEY;
process.env.AUTH_RATE_LIMIT_MAX = '500';
process.env.RATE_LIMIT_MAX = '5000';
process.env.BACKUP_ENABLED = 'false';

const { createApp } = await import('../app.js');
const { OrganizationModel } = await import('../models/Organization.js');
const { BranchModel } = await import('../models/Branch.js');
const { UserModel } = await import('../models/User.js');
const { runAsSystem } = await import('../context/tenantContext.js');

const API = '/api/v1';
const PASSWORD = 'P@ssw0rd-2FA-Test';
const OWNER_USERNAME = 'owner-2fa';
const MANAGER_USERNAME = 'manager-2fa';

let app: ReturnType<typeof createApp>;
let ownerId = '';
let managerId = '';
let recoveryCodes: string[] = [];
let twoFactorSecret = '';
let ownerAccess = '';
let refreshBeforeEnabling = '';
let accessAfterTotp = '';
let refreshAfterTotp = '';
let accessAfterRecovery = '';
let accessAfterDisable = '';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const login = (identifier: string) =>
  request(app).post(`${API}/auth/login`).send({ identifier, password: PASSWORD });

beforeAll(async () => {
  app = createApp();
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 5_000 });
  await mongoose.connection.dropDatabase();

  const organization = await OrganizationModel.create({
    name: 'مركز اختبار 2FA',
    slug: `test-2fa-${Date.now()}`,
    isActive: true,
    subscription: {
      plan: 'pro',
      status: 'active',
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60_000),
    },
  });

  const branch = await runAsSystem(() =>
    BranchModel.create({ organizationId: organization._id, name: 'الفرع الرئيسي', code: 'MAIN', isDefault: true }),
  );
  const owner = new UserModel({
    organizationId: organization._id,
    branchIds: [branch._id],
    fullName: 'مالك الاختبار',
    username: OWNER_USERNAME,
    role: 'owner',
    isActive: true,
  });
  await owner.setPassword(PASSWORD);
  await runAsSystem(() => owner.save());
  ownerId = String(owner._id);

  // مدير مفعّل عليه 2FA مسبقًا لاختبار إعادة التعيين الإدارية
  const manager = new UserModel({
    organizationId: organization._id,
    branchIds: [branch._id],
    fullName: 'مدير الاختبار',
    username: MANAGER_USERNAME,
    role: 'manager',
    isActive: true,
  });
  await manager.setPassword(PASSWORD);
  manager.twoFactorEnabled = true;
  manager.twoFactorSecret = encryptTwoFactorSecret(generateTotpSecret());
  manager.twoFactorEnabledAt = new Date(Date.now() - 60_000);
  manager.twoFactorRecoveryCodeHashes = generateRecoveryCodes().hashes;
  await runAsSystem(() => manager.save());
  managerId = String(manager._id);
});

afterAll(async () => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  }
});

describe('مسار المصادقة الثنائية', () => {
  it('يدخل بالكلمة فقط قبل التفعيل', async () => {
    const response = await login(OWNER_USERNAME);

    expect(response.status).toBe(200);
    expect(response.body.data.twoFactorRequired).toBeUndefined();
    expect(response.body.data.accessToken).toBeTruthy();
    expect(response.body.data.refreshToken).toBeTruthy();
    expect(response.body.data.user.twoFactorEnabled).toBe(false);
    ownerAccess = response.body.data.accessToken as string;
    refreshBeforeEnabling = response.body.data.refreshToken as string;
  });

  it('يبدأ الإعداد ويُرجع QR والسر دون تفعيله', async () => {
    const response = await request(app).post(`${API}/auth/2fa/setup`).set(auth(ownerAccess));

    expect(response.status).toBe(200);
    expect(response.body.data.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(response.body.data.otpauthUri).toContain('otpauth://totp/');
    expect(response.body.data.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    twoFactorSecret = response.body.data.secret as string;

    const stored = await runAsSystem(() =>
      UserModel.findById(ownerId).select('+twoFactorPendingSecret +twoFactorSecret').lean(),
    );
    expect(stored?.twoFactorPendingSecret).not.toBeNull();
    expect(stored?.twoFactorPendingSecret).not.toContain(twoFactorSecret);
    expect(stored?.twoFactorPendingSecret?.startsWith('v1:')).toBe(true);
    expect(stored?.twoFactorSecret).toBeNull();
    expect(stored?.twoFactorEnabled).toBe(false);
  });

  it('يفعّل بعد تأكيد رمز صحيح ويُرجع رموز الاسترداد مرة واحدة', async () => {
    const response = await request(app)
      .post(`${API}/auth/2fa/enable`)
      .set(auth(ownerAccess))
      .send({ code: generateTotp(twoFactorSecret) });

    expect(response.status).toBe(200);
    expect(response.body.data.twoFactorEnabled).toBe(true);
    expect(response.body.data.recoveryCodes).toHaveLength(8);
    recoveryCodes = response.body.data.recoveryCodes as string[];

    const stored = await runAsSystem(() =>
      UserModel.findById(ownerId).select('+twoFactorSecret +twoFactorPendingSecret').lean(),
    );
    expect(stored?.twoFactorEnabled).toBe(true);
    expect(stored?.twoFactorPendingSecret).toBeNull();
    expect(stored?.twoFactorSecret?.startsWith('v1:')).toBe(true);
    expect(stored?.twoFactorSecret).not.toContain(twoFactorSecret);
  });

  it('يعرض حالة الأمان مع عدد رموز الاسترداد المتبقية', async () => {
    const response = await request(app).get(`${API}/auth/2fa/status`).set(auth(ownerAccess));

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      enabled: true,
      recoveryCodesRemaining: 8,
      recommended: true,
    });
    expect(response.body.data.enabledAt).toBeTruthy();
  });

  it('يطلب تحديًا بعد كلمة المرور بدل إصدار توكنات', async () => {
    const response = await login(OWNER_USERNAME);

    expect(response.status).toBe(200);
    expect(response.body.data.twoFactorRequired).toBe(true);
    expect(response.body.data.accessToken).toBeUndefined();
    expect(response.body.data.refreshToken).toBeUndefined();
    expect(response.body.data.expiresIn).toBeGreaterThan(0);

    const challengeToken = response.body.data.challengeToken as string;
    expect(challengeToken).toBeTruthy();

    // توكن التحدي لا يصلح كمصادقة على مسار محمي
    const meWithChallenge = await request(app).get(`${API}/auth/me`).set(auth(challengeToken));
    expect(meWithChallenge.status).toBe(401);

    const wrongChallenge = await request(app)
      .post(`${API}/auth/2fa/verify`)
      .send({ challengeToken: `${challengeToken.slice(0, -2)}xx`, code: generateTotp(twoFactorSecret) });
    expect(wrongChallenge.status).toBe(401);
  });

  it('يرفض رمزًا خاطئًا ثم يقبل TOTP صالحًا', async () => {
    const challenge = await login(OWNER_USERNAME);
    const challengeToken = challenge.body.data.challengeToken as string;

    const forbidden = new Set(
      [-1, 0, 1].map((offset) => generateTotp(twoFactorSecret, Date.now() + offset * 30_000)),
    );
    const wrongCode = ['000000', '111111', '222222', '999999'].find((code) => !forbidden.has(code))!;

    const wrong = await request(app)
      .post(`${API}/auth/2fa/verify`)
      .send({ challengeToken, code: wrongCode });
    expect(wrong.status).toBe(401);

    const valid = await request(app)
      .post(`${API}/auth/2fa/verify`)
      .send({ challengeToken, code: generateTotp(twoFactorSecret) });

    expect(valid.status).toBe(200);
    expect(valid.body.data.accessToken).toBeTruthy();
    expect(valid.body.data.refreshToken).toBeTruthy();
    expect(valid.body.data.user.twoFactorEnabled).toBe(true);
    accessAfterTotp = valid.body.data.accessToken as string;
    refreshAfterTotp = valid.body.data.refreshToken as string;
  });

  it('يقبل رمز استرداد مرة واحدة فقط ويستهلكه', async () => {
    const recoveryCode = recoveryCodes[0]!;

    const firstChallenge = await login(OWNER_USERNAME);
    const first = await request(app)
      .post(`${API}/auth/2fa/verify`)
      .send({ challengeToken: firstChallenge.body.data.challengeToken, code: recoveryCode });

    expect(first.status).toBe(200);
    expect(first.body.data.accessToken).toBeTruthy();
    accessAfterRecovery = first.body.data.accessToken as string;

    const secondChallenge = await login(OWNER_USERNAME);
    const second = await request(app)
      .post(`${API}/auth/2fa/verify`)
      .send({ challengeToken: secondChallenge.body.data.challengeToken, code: recoveryCode });
    expect(second.status).toBe(401);

    const status = await request(app).get(`${API}/auth/2fa/status`).set(auth(accessAfterRecovery));
    expect(status.body.data.recoveryCodesRemaining).toBe(7);
  });

  it('يبطل جلسات التجديد الأقدم من تفعيل 2FA ويقبل الجلسات الجديدة', async () => {
    // جلسة صادرة فعليًا من الدخول الأول قبل تفعيل 2FA
    const rejected = await request(app)
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: refreshBeforeEnabling });
    expect(rejected.status).toBe(401);
    expect(rejected.body.error.message).toContain('التحقق بخطوتين');

    const accepted = await request(app)
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: refreshAfterTotp });
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.accessToken).toBeTruthy();
  });

  it('يوقف 2FA بكلمة المرور ورمز صالح ثم يعود الدخول المباشر', async () => {
    const disabled = await request(app)
      .post(`${API}/auth/2fa/disable`)
      .set(auth(accessAfterTotp))
      .send({ password: PASSWORD, code: generateTotp(twoFactorSecret) });

    expect(disabled.status).toBe(200);
    expect(disabled.body.data.twoFactorEnabled).toBe(false);

    const directLogin = await login(OWNER_USERNAME);
    expect(directLogin.status).toBe(200);
    expect(directLogin.body.data.twoFactorRequired).toBeUndefined();
    expect(directLogin.body.data.accessToken).toBeTruthy();
    accessAfterDisable = directLogin.body.data.accessToken as string;

    const status = await request(app).get(`${API}/auth/2fa/status`).set(auth(accessAfterDisable));
    expect(status.body.data.enabled).toBe(false);
    expect(status.body.data.recoveryCodesRemaining).toBe(0);
  });

  it('تتيح الإدارة إعادة تعيين 2FA لمستخدم آخر وتمنع المستخدم من إعادة تعيين نفسه', async () => {
    const managerLogin = await login(MANAGER_USERNAME);
    expect(managerLogin.status).toBe(200);
    expect(managerLogin.body.data.twoFactorRequired).toBe(true);

    const selfReset = await request(app)
      .post(`${API}/auth/users/${ownerId}/2fa/reset`)
      .set(auth(accessAfterDisable));
    expect(selfReset.status).toBe(422);

    const reset = await request(app)
      .post(`${API}/auth/users/${managerId}/2fa/reset`)
      .set(auth(accessAfterDisable));
    expect(reset.status).toBe(200);

    const afterReset = await login(MANAGER_USERNAME);
    expect(afterReset.status).toBe(200);
    expect(afterReset.body.data.twoFactorRequired).toBeUndefined();
    expect(afterReset.body.data.accessToken).toBeTruthy();

    const stored = await runAsSystem(() =>
      UserModel.findById(managerId).select('+twoFactorSecret +twoFactorRecoveryCodeHashes').lean(),
    );
    expect(stored?.twoFactorEnabled).toBe(false);
    expect(stored?.twoFactorSecret).toBeNull();
    expect(stored?.twoFactorRecoveryCodeHashes).toEqual([]);
  });
});
