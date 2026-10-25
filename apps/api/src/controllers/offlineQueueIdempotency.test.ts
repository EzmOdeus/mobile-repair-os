/**
 * اختبار تكاملي لمفتاح idempotency المستخدم في طابور عدم الاتصال:
 * إعادة إرسال نفس الطلب يجب أن تُرجع نفس التذكرة دون إنشاء عميل/جهاز/تذكرة جديدة.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';

const TEST_URI = process.env.MONGODB_TEST_URI ?? 'mongodb://127.0.0.1:27017/mobile_repair_os_vitest';
const ACCESS_SECRET = 'test-access-secret-for-offline-queue-0123456789abcdef';
const REFRESH_SECRET = 'test-refresh-secret-for-offline-queue-0123456789abcdef';

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = TEST_URI;
process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
process.env.JWT_REFRESH_SECRET = REFRESH_SECRET;
process.env.AUTH_RATE_LIMIT_MAX = '500';
process.env.RATE_LIMIT_MAX = '5000';
process.env.BACKUP_ENABLED = 'false';

const { createApp } = await import('../app.js');
const { OrganizationModel } = await import('../models/Organization.js');
const { BranchModel } = await import('../models/Branch.js');
const { UserModel } = await import('../models/User.js');
const { RepairTicketModel } = await import('../models/RepairTicket.js');
const { CustomerModel } = await import('../models/Customer.js');
const { runAsSystem } = await import('../context/tenantContext.js');

const API = '/api/v1';
const PASSWORD = 'P@ssw0rd-Offline-Test';
const USERNAME = 'owner-offline-queue';

let app: ReturnType<typeof createApp>;
let accessToken = '';
let branchId = '';

const auth = () => ({ Authorization: `Bearer ${accessToken}` });

const ticketBody = (clientRequestId: string | undefined, phone: string) => ({
  ...(clientRequestId ? { clientRequestId } : {}),
  priority: 'normal',
  newCustomer: { fullName: 'عميل اختبار الطابور', phone },
  newDevice: { brand: 'Samsung', model: 'Galaxy A15', conditionOnIntake: 'good' },
  intake: {
    complaint: 'الشاشة مكسورة ولا يعمل اللمس',
    complaintCategory: 'display',
    customerAcknowledged: true,
    dataLossDisclaimerAccepted: true,
  },
});

beforeAll(async () => {
  app = createApp();
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 5_000 });
  await mongoose.connection.dropDatabase();

  const organization = await OrganizationModel.create({
    name: 'مركز اختبار الطابور',
    slug: `offline-queue-${Date.now()}`,
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
  branchId = String(branch._id);

  const owner = new UserModel({
    organizationId: organization._id,
    branchIds: [branch._id],
    fullName: 'مالك اختبار الطابور',
    username: USERNAME,
    role: 'owner',
    isActive: true,
  });
  await owner.setPassword(PASSWORD);
  await runAsSystem(() => owner.save());

  const login = await request(app).post(`${API}/auth/login`).send({ identifier: USERNAME, password: PASSWORD });
  expect(login.status).toBe(200);
  accessToken = login.body.data.accessToken as string;
});

afterAll(async () => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  }
});

describe('idempotency لإنشاء التذكرة من طابور عدم الاتصال', () => {
  it('يعيد نفس التذكرة عند تكرار نفس المفتاح دون ازدواج', async () => {
    const clientRequestId = `offline-${Date.now()}-a`;
    const first = await request(app)
      .post(`${API}/tickets`)
      .set(auth())
      .set('x-branch-id', branchId)
      .send(ticketBody(clientRequestId, '01099990001'));

    expect(first.status).toBe(201);
    expect(first.body.data.ticket.clientRequestId).toBe(clientRequestId);
    expect(first.body.data.idempotentReplay).toBeUndefined();

    const second = await request(app)
      .post(`${API}/tickets`)
      .set(auth())
      .set('x-branch-id', branchId)
      .send(ticketBody(clientRequestId, '01099990001'));

    expect(second.status).toBe(200);
    expect(second.body.data.idempotentReplay).toBe(true);
    expect(second.body.data.ticket._id).toBe(first.body.data.ticket._id);
    expect(second.body.data.ticket.ticketNumber).toBe(first.body.data.ticket.ticketNumber);

    const tickets = await runAsSystem(() =>
      RepairTicketModel.countDocuments({ clientRequestId }),
    );
    const customers = await runAsSystem(() => CustomerModel.countDocuments({ phone: '01099990001' }));
    expect(tickets).toBe(1);
    expect(customers).toBe(1);
  });

  it('ينشئ تذكرة جديدة عندما يختلف المفتاح', async () => {
    const first = await request(app)
      .post(`${API}/tickets`)
      .set(auth())
      .set('x-branch-id', branchId)
      .send(ticketBody(`offline-${Date.now()}-b`, '01099990002'));

    const second = await request(app)
      .post(`${API}/tickets`)
      .set(auth())
      .set('x-branch-id', branchId)
      .send(ticketBody(`offline-${Date.now()}-c`, '01099990002'));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.data.ticket._id).not.toBe(second.body.data.ticket._id);
  });

  it('يبقي المسار القديم بلا مفتاح صالحًا', async () => {
    const response = await request(app)
      .post(`${API}/tickets`)
      .set(auth())
      .set('x-branch-id', branchId)
      .send(ticketBody(undefined, '01099990003'));

    expect(response.status).toBe(201);
    expect(response.body.data.ticket.clientRequestId).toBeNull();
  });
});
