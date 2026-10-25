/**
 * اختبار دورة الاشتراكات كاملة عبر HTTP:
 * حالة محسوبة → مجدول انتهاء/مهلة → تذكيرات → حارس القراءة فقط →
 * تفعيل ذاتي ببيانات دفع → طلب تجديد → اعتماد/رفض من المنصة → تقرير الإيرادات.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';

const TEST_URI = process.env.MONGODB_TEST_URI ?? 'mongodb://127.0.0.1:27017/mobile_repair_os_vitest';
const ACCESS_SECRET = 'test-access-secret-for-subscriptions-0123456789abcdef';
const REFRESH_SECRET = 'test-refresh-secret-for-subscriptions-0123456789abcdef';
const CRON_SECRET = 'test-cron-secret-for-vercel-0123456789abcdef';

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = TEST_URI;
process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
process.env.JWT_REFRESH_SECRET = REFRESH_SECRET;
process.env.CRON_SECRET = CRON_SECRET;
process.env.AUTH_RATE_LIMIT_MAX = '500';
process.env.RATE_LIMIT_MAX = '5000';
process.env.BACKUP_ENABLED = 'false';
process.env.SUBSCRIPTION_GRACE_DAYS = '7';
process.env.SUBSCRIPTION_REMINDER_DAYS = '7,3,1';

const { createApp } = await import('../app.js');
const { OrganizationModel } = await import('../models/Organization.js');
const { BranchModel } = await import('../models/Branch.js');
const { UserModel } = await import('../models/User.js');
const { NotificationModel } = await import('../models/Notification.js');
const { SubscriptionPaymentModel } = await import('../models/SubscriptionPayment.js');
const { SubscriptionRenewalRequestModel } = await import('../models/SubscriptionRenewalRequest.js');
const {
  expireOverdueOrganizations,
  getSubscriptionState,
  sendSubscriptionReminders,
} = await import('../services/subscriptionService.js');
const { runAsSystem } = await import('../context/tenantContext.js');

const API = '/api/v1';
const DAY = 24 * 60 * 60 * 1000;
const PASSWORD = 'P@ssw0rd-Subscriptions';

let app: ReturnType<typeof createApp>;
let platformToken = '';
let ownerAToken = '';
let ownerBToken = '';
let branchAId = '';
let branchBId = '';
let ownerAId = '';
let ownerBId = '';
let orgAId = '';
let orgBId = '';
let paymentAId = '';
let approvedRequestId = '';
let rejectedRequestId = '';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

interface FixtureOptions {
  name: string;
  slug: string;
  subscription: Record<string, unknown>;
  ownerUsername?: string;
  withBranch?: boolean;
}

async function createOrganizationFixture(options: FixtureOptions) {
  const organization = await runAsSystem(() =>
    OrganizationModel.create({
      name: options.name,
      slug: options.slug,
      isActive: true,
      subscription: options.subscription,
    }),
  );

  let branchId: string | null = null;
  if (options.withBranch !== false) {
    const branch = await runAsSystem(() =>
      BranchModel.create({
        organizationId: organization._id,
        name: 'الفرع الرئيسي',
        code: 'MAIN',
        isDefault: true,
      }),
    );
    branchId = String(branch._id);
  }

  let ownerId: string | null = null;
  if (options.ownerUsername) {
    const owner = new UserModel({
      organizationId: organization._id,
      branchIds: branchId ? [branchId] : [],
      fullName: `مالك ${options.name}`,
      username: options.ownerUsername,
      role: 'owner',
      isActive: true,
    });
    await owner.setPassword(PASSWORD);
    await runAsSystem(() => owner.save());
    ownerId = String(owner._id);
  }

  return { organizationId: String(organization._id), branchId, ownerId };
}

async function login(username: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ identifier: username, password: PASSWORD });
  expect(response.status).toBe(200);
  return response.body.data.accessToken as string;
}

const ticketBody = () => ({
  priority: 'normal',
  newCustomer: { fullName: 'عميل اشتراك', phone: '01099995000' },
  newDevice: { brand: 'Samsung', model: 'Galaxy A55', conditionOnIntake: 'good' },
  intake: {
    complaint: 'لا يشحن',
    complaintCategory: 'charging',
    customerAcknowledged: true,
    dataLossDisclaimerAccepted: true,
  },
});

beforeAll(async () => {
  app = createApp();
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 5_000 });
  await mongoose.connection.dropDatabase();

  const platform = await createOrganizationFixture({
    name: 'إدارة المنصة',
    slug: 'platform-hq-subs',
    subscription: { plan: 'enterprise', status: 'active' },
    withBranch: false,
  });

  const platformAdmin = new UserModel({
    organizationId: platform.organizationId,
    fullName: 'مدير المنصة',
    username: 'platform-subs-test',
    role: 'platform',
    isActive: true,
  });
  await platformAdmin.setPassword(PASSWORD);
  await runAsSystem(() => platformAdmin.save());

  const orgA = await createOrganizationFixture({
    name: 'مركز أ',
    slug: 'subs-org-a',
    subscription: {
      plan: 'growth',
      status: 'cancelled',
      startedAt: new Date(Date.now() - 40 * DAY),
      expiresAt: new Date(Date.now() - 5 * DAY),
    },
    ownerUsername: 'owner-subs-a',
  });
  orgAId = orgA.organizationId;
  branchAId = orgA.branchId!;
  ownerAId = orgA.ownerId!;

  const orgB = await createOrganizationFixture({
    name: 'مركز ب',
    slug: 'subs-org-b',
    subscription: {
      plan: 'pro',
      status: 'cancelled',
      startedAt: new Date(Date.now() - 50 * DAY),
      expiresAt: new Date(Date.now() - 10 * DAY),
    },
    ownerUsername: 'owner-subs-b',
  });
  orgBId = orgB.organizationId;
  branchBId = orgB.branchId!;
  ownerBId = orgB.ownerId!;

  platformToken = await login('platform-subs-test');
  ownerAToken = await login('owner-subs-a');
  ownerBToken = await login('owner-subs-b');
});

afterAll(async () => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  }
});

describe('حساب حالة الاشتراك', () => {
  it('يبقي الاشتراك الساري نشطًا بلا حظر', () => {
    const state = getSubscriptionState({
      plan: 'growth',
      status: 'active',
      expiresAt: new Date(Date.now() + 20 * DAY),
    });

    expect(state.status).toBe('active');
    expect(state.blocked).toBe(false);
    expect(state.inGrace).toBe(false);
    expect(state.daysRemaining).toBeGreaterThan(19);
    expect(state.priceEgp).toBe(1500);
  });

  it('يمنح مهلة سداد ديناميكية فور انتهاء اشتراك مدفوع', () => {
    const expiresAt = new Date(Date.now() - DAY);
    const state = getSubscriptionState({ plan: 'pro', status: 'active', expiresAt });

    expect(state.status).toBe('past_due');
    expect(state.inGrace).toBe(true);
    expect(state.blocked).toBe(false);
    expect(state.graceEndsAt?.getTime()).toBe(expiresAt.getTime() + 7 * DAY);
    expect(state.graceDaysRemaining).toBeGreaterThanOrEqual(5);
  });

  it('يحظر بعد نهاية مهلة السداد المحسوبة', () => {
    const state = getSubscriptionState({
      plan: 'pro',
      status: 'active',
      expiresAt: new Date(Date.now() - 9 * DAY),
    });

    expect(state.status).toBe('past_due');
    expect(state.inGrace).toBe(false);
    expect(state.blocked).toBe(true);
  });

  it('يحظر التجربة المنتهية بلا مهلة', () => {
    const state = getSubscriptionState({
      plan: 'starter',
      status: 'trialing',
      expiresAt: new Date(Date.now() - DAY),
    });

    expect(state.status).toBe('cancelled');
    expect(state.blocked).toBe(true);
    expect(state.inGrace).toBe(false);
  });

  it('يعتمد graceEndsAt المخزَّن ويحترم السعر المخصص', () => {
    const state = getSubscriptionState({
      plan: 'enterprise',
      status: 'active',
      expiresAt: new Date(Date.now() - 2 * DAY),
      graceEndsAt: new Date(Date.now() + 3 * DAY),
      priceEgp: 5000,
    });

    expect(state.status).toBe('past_due');
    expect(state.inGrace).toBe(true);
    expect(state.blocked).toBe(false);
    expect(state.priceEgp).toBe(5000);
  });

  it('لا يمنح مهلة إضافية لصف past_due قديم بلا graceEndsAt', () => {
    const state = getSubscriptionState({
      plan: 'growth',
      status: 'past_due',
      expiresAt: new Date(Date.now() - DAY),
    });

    expect(state.blocked).toBe(true);
  });
});

describe('مجدول الانتهاء والتذكيرات', () => {
  let trialOrgId = '';
  let graceOrgId = '';
  let lateOrgId = '';
  let pastDueOrgId = '';
  let reminderOrgId = '';
  let reminderOwnerId = '';

  beforeAll(async () => {
    const trial = await createOrganizationFixture({
      name: 'تجربة منتهية',
      slug: 'subs-sched-trial',
      subscription: {
        plan: 'starter',
        status: 'trialing',
        expiresAt: new Date(Date.now() - DAY),
      },
    });
    trialOrgId = trial.organizationId;

    const grace = await createOrganizationFixture({
      name: 'اشتراك منتهٍ حديثًا',
      slug: 'subs-sched-grace',
      subscription: {
        plan: 'growth',
        status: 'active',
        expiresAt: new Date(Date.now() - 2 * DAY),
      },
      ownerUsername: 'owner-sched-grace',
    });
    graceOrgId = grace.organizationId;

    const late = await createOrganizationFixture({
      name: 'اشتراك متأخر',
      slug: 'subs-sched-late',
      subscription: {
        plan: 'growth',
        status: 'active',
        expiresAt: new Date(Date.now() - 10 * DAY),
      },
    });
    lateOrgId = late.organizationId;

    const pastDue = await createOrganizationFixture({
      name: 'مهلة منتهية',
      slug: 'subs-sched-pastdue',
      subscription: {
        plan: 'pro',
        status: 'past_due',
        expiresAt: new Date(Date.now() - 20 * DAY),
        graceEndsAt: new Date(Date.now() - 13 * DAY),
      },
    });
    pastDueOrgId = pastDue.organizationId;

    const reminder = await createOrganizationFixture({
      name: 'تذكير قريب',
      slug: 'subs-reminder',
      subscription: {
        plan: 'growth',
        status: 'active',
        expiresAt: new Date(Date.now() + 5 * DAY),
      },
      ownerUsername: 'owner-subs-reminder',
    });
    reminderOrgId = reminder.organizationId;
    reminderOwnerId = reminder.ownerId!;

    await createOrganizationFixture({
      name: 'بعيد عن التذكير',
      slug: 'subs-reminder-far',
      subscription: {
        plan: 'growth',
        status: 'active',
        expiresAt: new Date(Date.now() + 10 * DAY),
      },
    });
  });

  it('ينقل الحالات المنتهية ويحفظ expiresAt الأصلي', async () => {
    const before = await runAsSystem(() =>
      OrganizationModel.findById(graceOrgId).select('subscription').lean(),
    );
    const originalExpiry = before!.subscription!.expiresAt as Date;

    const transitioned = await expireOverdueOrganizations();
    expect(transitioned).toBe(4);

    const grace = await runAsSystem(() =>
      OrganizationModel.findById(graceOrgId).select('subscription').lean(),
    );
    expect(grace!.subscription!.status).toBe('past_due');
    expect((grace!.subscription!.expiresAt as Date).getTime()).toBe(originalExpiry.getTime());
    expect((grace!.subscription!.graceEndsAt as Date).getTime()).toBe(originalExpiry.getTime() + 7 * DAY);

    const late = await runAsSystem(() =>
      OrganizationModel.findById(lateOrgId).select('subscription').lean(),
    );
    expect(late!.subscription!.status).toBe('cancelled');

    const pastDue = await runAsSystem(() =>
      OrganizationModel.findById(pastDueOrgId).select('subscription').lean(),
    );
    expect(pastDue!.subscription!.status).toBe('cancelled');

    const trial = await runAsSystem(() =>
      OrganizationModel.findById(trialOrgId).select('subscription').lean(),
    );
    expect(trial!.subscription!.status).toBe('cancelled');

    const notifications = await runAsSystem(() =>
      NotificationModel.countDocuments({ organizationId: graceOrgId, type: 'subscription_expired' }),
    );
    expect(notifications).toBe(1);

    expect(await expireOverdueOrganizations()).toBe(0);
  });

  it('يرسل تذكيرًا واحدًا لكل عتبة ولكل دورة اشتراك', async () => {
    expect(await sendSubscriptionReminders()).toBe(1);

    const firstCount = await runAsSystem(() =>
      NotificationModel.countDocuments({ organizationId: reminderOrgId, type: 'subscription_expiring' }),
    );
    expect(firstCount).toBe(1);

    expect(await sendSubscriptionReminders()).toBe(0);

    const org = await runAsSystem(() =>
      OrganizationModel.findById(reminderOrgId).select('subscription').lean(),
    );
    expect(org!.subscription!.reminderKeys?.length).toBe(1);

    // دورة جديدة بتاريخ انتهاء مختلف → مفتاح جديد وتذكير جديد
    await runAsSystem(() =>
      OrganizationModel.updateOne(
        { _id: reminderOrgId },
        { $set: { 'subscription.expiresAt': new Date(Date.now() + 2 * DAY) } },
      ),
    );
    expect(await sendSubscriptionReminders()).toBe(1);

    const total = await runAsSystem(() =>
      NotificationModel.countDocuments({ organizationId: reminderOrgId, type: 'subscription_expiring' }),
    );
    expect(total).toBe(2);
    expect(reminderOwnerId).toBeTruthy();
  });
});

describe('حارس الاشتراك وسياسة الباقات', () => {
  it('يتيح القراءة ويمنع الكتابة للمركز المنتهي', async () => {
    const read = await request(app).get(`${API}/tickets`).set(auth(ownerAToken));
    expect(read.status).toBe(200);

    const write = await request(app)
      .post(`${API}/tickets`)
      .set(auth(ownerAToken))
      .set('x-branch-id', branchAId)
      .send(ticketBody());

    expect(write.status).toBe(422);
    expect(write.body.error.code).toBe('BUSINESS_RULE');
    expect(write.body.error.details.code).toBe('SUBSCRIPTION_EXPIRED');
  });

  it('يعرض كتالوج الباقات بأعلام التفعيل الذاتي', async () => {
    const response = await request(app)
      .get(`${API}/organizations/subscription/plans`)
      .set(auth(ownerAToken));

    expect(response.status).toBe(200);
    const plans = response.body.data as Array<Record<string, unknown>>;
    const starter = plans.find((plan) => plan.key === 'starter');
    const growth = plans.find((plan) => plan.key === 'growth');
    const enterprise = plans.find((plan) => plan.key === 'enterprise');

    expect(starter).toMatchObject({ selfService: false, trialOnly: true });
    expect(growth).toMatchObject({ selfService: true, trialOnly: false });
    expect(enterprise).toMatchObject({ selfService: false, customPricing: true });
  });

  it('يرفض التفعيل الذاتي لباقتي التجربة والمؤسسية', async () => {
    for (const plan of ['starter', 'trial', 'enterprise']) {
      const response = await request(app)
        .post(`${API}/organizations/subscription/activate`)
        .set(auth(ownerAToken))
        .send({ plan, paymentMethod: 'cash', paymentReference: 'REF-INVALID' });

      expect(response.status).toBe(422);
    }
  });

  it('يرفض التفعيل الذاتي دون مرجع دفع', async () => {
    const response = await request(app)
      .post(`${API}/organizations/subscription/activate`)
      .set(auth(ownerAToken))
      .send({ plan: 'growth', paymentMethod: 'cash' });

    expect(response.status).toBe(422);
  });

  it('يفعّل ذاتيًا ويسجّل دفعة بالمبلغ المحسوب من الكتالوج', async () => {
    const response = await request(app)
      .post(`${API}/organizations/subscription/activate`)
      .set(auth(ownerAToken))
      .send({
        plan: 'growth',
        months: 2,
        paymentMethod: 'cash',
        paymentReference: 'CASH-ORG-A-001',
        paymentNote: 'دفع نقدي بالفرع',
      });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('active');
    expect(response.body.data.blocked).toBe(false);
    expect(response.body.data.planKey).toBe('growth');
    paymentAId = response.body.data.paymentId as string;
    expect(paymentAId).toBeTruthy();

    const payment = await runAsSystem(() => SubscriptionPaymentModel.findById(paymentAId).lean());
    expect(payment).toMatchObject({
      plan: 'growth',
      amountEgp: 3000,
      months: 2,
      method: 'cash',
      reference: 'CASH-ORG-A-001',
      source: 'self_service',
    });
    expect(
      Math.round((new Date(payment!.periodEnd).getTime() - new Date(payment!.periodStart).getTime()) / DAY),
    ).toBe(60);
  });

  it('يعود الحارس للسماح بالكتابة بعد التفعيل', async () => {
    const response = await request(app)
      .post(`${API}/tickets`)
      .set(auth(ownerAToken))
      .set('x-branch-id', branchAId)
      .send(ticketBody());

    expect(response.status).toBe(201);
  });

  it('يعرض سجل مدفوعات المركز', async () => {
    const response = await request(app)
      .get(`${API}/organizations/subscription/payments`)
      .set(auth(ownerAToken));

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({
      amountEgp: 3000,
      methodLabelAr: 'نقدًا',
      reference: 'CASH-ORG-A-001',
    });
  });

  it('يسمح بالترقية الذاتية ويرفض المؤسسية', async () => {
    const upgrade = await request(app)
      .post(`${API}/organizations/subscription/change-plan`)
      .set(auth(ownerAToken))
      .send({ plan: 'pro' });
    expect(upgrade.status).toBe(200);
    expect(upgrade.body.data.planKey).toBe('pro');
    expect(upgrade.body.data.priceEgp).toBe(3500);

    const enterprise = await request(app)
      .post(`${API}/organizations/subscription/change-plan`)
      .set(auth(ownerAToken))
      .send({ plan: 'enterprise' });
    expect(enterprise.status).toBe(422);
  });

  it('تفعّل المنصة المؤسسية بسعر مخصص', async () => {
    const response = await request(app)
      .post(`${API}/platform/organizations/${orgAId}/subscription/change-plan`)
      .set(auth(platformToken))
      .send({ plan: 'enterprise', monthlyPriceEgp: 4200 });

    expect(response.status).toBe(200);
    expect(response.body.data.planKey).toBe('enterprise');
    expect(response.body.data.priceEgp).toBe(4200);
  });
});

describe('طلبات التجديد واعتمادها', () => {
  it('ينشئ طلب تجديد أثناء الحظر ويمنع التكرار', async () => {
    const created = await request(app)
      .post(`${API}/organizations/subscription/renewal-requests`)
      .set(auth(ownerBToken))
      .send({ plan: 'enterprise', months: 12, note: 'نرغب في عرض سعر للمؤسسية' });

    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('pending');

    const duplicate = await request(app)
      .post(`${API}/organizations/subscription/renewal-requests`)
      .set(auth(ownerBToken))
      .send({ plan: 'pro', months: 1 });

    expect(duplicate.status).toBe(409);
  });

  it('يلغي التفعيل الذاتي الطلب المعلّق', async () => {
    const activate = await request(app)
      .post(`${API}/organizations/subscription/activate`)
      .set(auth(ownerBToken))
      .send({ plan: 'growth', months: 1, paymentMethod: 'wallet', paymentReference: 'WALLET-001' });
    expect(activate.status).toBe(200);

    const list = await request(app)
      .get(`${API}/organizations/subscription/renewal-requests`)
      .set(auth(ownerBToken));
    expect(list.status).toBe(200);
    expect(list.body.data[0].status).toBe('cancelled');
  });

  it('يرسل طلبًا جديدًا وتوافق عليه المنصة كدفعة مجدولة', async () => {
    const created = await request(app)
      .post(`${API}/organizations/subscription/renewal-requests`)
      .set(auth(ownerBToken))
      .send({
        plan: 'pro',
        months: 3,
        paymentMethod: 'bank_transfer',
        paymentReference: 'BANK-777',
        note: 'تحويل بنكي بانتظار التأكيد',
      });
    expect(created.status).toBe(201);
    approvedRequestId = created.body.data.id as string;

    const pending = await request(app)
      .get(`${API}/platform/renewal-requests?status=pending`)
      .set(auth(platformToken));
    expect(pending.status).toBe(200);
    expect(pending.body.data.items.some((item: { id: string }) => item.id === approvedRequestId)).toBe(true);

    const approved = await request(app)
      .post(`${API}/platform/renewal-requests/${approvedRequestId}/approve`)
      .set(auth(platformToken))
      .send({
        months: 6,
        monthlyPriceEgp: 2000,
        paymentMethod: 'bank_transfer',
        paymentReference: 'BANK-777',
        note: 'تم تأكيد التحويل',
      });

    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('approved');
    expect(approved.body.data.subscription.planKey).toBe('pro');
    expect(approved.body.data.subscription.priceEgp).toBe(2000);
    expect(approved.body.data.subscription.status).toBe('active');

    const organization = await runAsSystem(() =>
      OrganizationModel.findById(orgBId).select('subscription').lean(),
    );
    expect(organization!.subscription!.status).toBe('active');
    expect(organization!.subscription!.priceEgp).toBe(2000);

    const payment = await runAsSystem(() =>
      SubscriptionPaymentModel.findById(approved.body.data.paymentId).lean(),
    );
    expect(payment).toMatchObject({
      plan: 'pro',
      amountEgp: 12000,
      months: 6,
      source: 'platform',
    });
    expect(String(payment!.renewalRequestId)).toBe(approvedRequestId);

    const storedRequest = await runAsSystem(() =>
      SubscriptionRenewalRequestModel.findById(approvedRequestId).lean(),
    );
    expect(storedRequest!.status).toBe('approved');
    expect(String(storedRequest!.resultingPaymentId)).toBe(approved.body.data.paymentId);
  });

  it('يرفض المنصة طلبًا مع إشعار مالكي المركز', async () => {
    const created = await request(app)
      .post(`${API}/organizations/subscription/renewal-requests`)
      .set(auth(ownerBToken))
      .send({ plan: 'growth', months: 1, note: 'طلب للاختبار' });
    expect(created.status).toBe(201);
    rejectedRequestId = created.body.data.id as string;

    const invalid = await request(app)
      .post(`${API}/platform/renewal-requests/${rejectedRequestId}/reject`)
      .set(auth(platformToken))
      .send({});
    expect(invalid.status).toBe(422);

    const rejected = await request(app)
      .post(`${API}/platform/renewal-requests/${rejectedRequestId}/reject`)
      .set(auth(platformToken))
      .send({ note: 'بيانات التحويل غير مكتملة' });

    expect(rejected.status).toBe(200);
    expect(rejected.body.data.status).toBe('rejected');

    const notification = await runAsSystem(() =>
      NotificationModel.findOne({
        organizationId: orgBId,
        userId: ownerBId,
        type: 'subscription_renewal_rejected',
      }).lean(),
    );
    expect(notification).toBeTruthy();
    expect(notification!.body).toContain('بيانات التحويل غير مكتملة');
  });
});

describe('تقرير إيرادات الاشتراكات', () => {
  it('يجمع المحصّل حسب الباقة والطريقة والسعر المتوقع', async () => {
    const response = await request(app).get(`${API}/platform/revenue`).set(auth(platformToken));

    expect(response.status).toBe(200);
    expect(response.body.data.totals.collectedEgp).toBe(16_500);
    expect(response.body.data.totals.paymentsCount).toBe(3);
    expect(response.body.data.totals.expectedMrrEgp).toBeGreaterThanOrEqual(6200);
    expect(response.body.data.totals.activeSubscriptions).toBeGreaterThanOrEqual(2);

    const byPlan = response.body.data.byPlan as Array<{ plan: string; collectedEgp: number }>;
    expect(byPlan.find((row) => row.plan === 'growth')?.collectedEgp).toBe(4500);
    expect(byPlan.find((row) => row.plan === 'pro')?.collectedEgp).toBe(12_000);

    const byMethod = response.body.data.byMethod as Array<{ method: string; collectedEgp: number }>;
    expect(byMethod.find((row) => row.method === 'cash')?.collectedEgp).toBe(3000);
    expect(byMethod.find((row) => row.method === 'wallet')?.collectedEgp).toBe(1500);
    expect(byMethod.find((row) => row.method === 'bank_transfer')?.collectedEgp).toBe(12_000);
    expect(response.body.data.recent).toHaveLength(3);
  });

  it('يعرض إحصائيات المنصة المالية المحدّثة', async () => {
    const response = await request(app).get(`${API}/platform/stats`).set(auth(platformToken));

    expect(response.status).toBe(200);
    expect(response.body.data.collectedThisMonthEgp).toBe(16_500);
    expect(response.body.data.paymentsThisMonth).toBe(3);
    expect(response.body.data.mrrEgp).toBeGreaterThan(0);
  });
});

describe('مسارات Cron المحمية (Vercel Cron)', () => {
  it('يرفض فحص الاشتراكات بلا مفتاح', async () => {
    const response = await request(app).get(`${API}/internal/cron/subscription`);
    expect(response.status).toBe(401);
  });

  it('يرفض المفتاح الخاطئ', async () => {
    const response = await request(app)
      .get(`${API}/internal/cron/sla`)
      .set({ Authorization: 'Bearer wrong-secret-wrong-secret-wrong' });
    expect(response.status).toBe(401);
  });

  it('ينفّذ فحص الاشتراكات بالمفتاح الصحيح ويعيد عدد العمليات', async () => {
    const response = await request(app).get(`${API}/internal/cron/subscription`).set(auth(CRON_SECRET));

    expect(response.status).toBe(200);
    expect(typeof response.body.data.processed).toBe('number');
    expect(response.body.data.processed).toBeGreaterThanOrEqual(0);
  });

  it('ينفّذ فحص SLA بالمفتاح الصحيح ويعيد عدد التجاوزات', async () => {
    const response = await request(app).get(`${API}/internal/cron/sla`).set(auth(CRON_SECRET));

    expect(response.status).toBe(200);
    expect(typeof response.body.data.breached).toBe('number');
    expect(response.body.data.breached).toBeGreaterThanOrEqual(0);
  });
});
