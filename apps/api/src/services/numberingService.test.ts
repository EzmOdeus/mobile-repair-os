/**
 * اختبارات خدمة الترقيم — تحمي الإصلاحات الجوهرية الثلاثة:
 *
 * 1. ذرّية العدّاد: طلبات متزامنة لا تنتج أرقامًا متطابقة، والعدّاد يُزاد على
 *    الفرع الأقدم النشط فقط (الفرع الواحد المشترك) لا على الفرع الطالب.
 * 2. `withUniqueRetry`: إعادة المحاولة عند E11000 فقط، ورفع أي خطأ آخر فورًا.
 * 3. `syncNumberCounters`: رفع العدّادات لأكبر رقم فعلي **لكل مؤسسة على حدة**،
 *    بلا إنقاص أي عدّاد قائم — وهذا هو الخلل الحقيقي الذي كان يرفض إنشاء
 *    العروض بـ409 بعد الزرع (EST_2610 = 2 بينما توجد 60 عرضًا مرزوعًا).
 *
 * تتصل بقاعدة MongoDB محلية على قاعدة بيانات اختبار معزولة تُسقط في البداية
 * والنهاية (MONGODB_TEST_URI)، ولا تلمس قاعدة التطوير إطلاقًا.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { BranchModel } from '../models/Branch.js';
import { RepairTicketModel } from '../models/RepairTicket.js';
import { EstimateModel } from '../models/Estimate.js';
import { WarrantyClaimModel } from '../models/WarrantyClaim.js';
import { runAsSystem, runWithTenantContext, type TenantContext } from '../context/tenantContext.js';
import { nextTicketNumber, syncNumberCounters, withUniqueRetry } from './numberingService.js';

const TEST_URI = process.env.MONGODB_TEST_URI ?? 'mongodb://127.0.0.1:27017/mobile_repair_os_vitest';

const org = (): Types.ObjectId => new Types.ObjectId();

const ctxFor = (organizationId: Types.ObjectId): TenantContext => ({
  actor: {
    userId: String(new Types.ObjectId()),
    organizationId,
    branchId: null,
    role: 'owner',
    fullName: 'مستخدم اختبار',
  },
  organizationId,
  branchId: null,
  requestId: 'vitest',
});

async function rawBranch(input: {
  organizationId: Types.ObjectId;
  name: string;
  code: string;
  createdAt: Date;
  isActive?: boolean;
  counterSeq?: Record<string, number>;
}): Promise<Types.ObjectId> {
  const _id = new Types.ObjectId();
  await BranchModel.collection.insertOne({
    _id,
    organizationId: input.organizationId,
    name: input.name,
    code: input.code,
    isActive: input.isActive ?? true,
    counterSeq: input.counterSeq ?? {},
    ticketCounter: 0,
    invoiceCounter: 0,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
  return _id;
}

beforeAll(async () => {
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 5_000 });
  await mongoose.connection.dropDatabase();
});

afterAll(async () => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  }
});

beforeEach(async () => {
  await runAsSystem(async () => {
    await Promise.all([
      BranchModel.deleteMany({}),
      RepairTicketModel.deleteMany({}),
      EstimateModel.deleteMany({}),
      WarrantyClaimModel.deleteMany({}),
    ]);
  });
});

describe('withUniqueRetry', () => {
  it('ينجح من المحاولة الأولى بلا إعادة', async () => {
    let generated = 0;
    const result = await withUniqueRetry(
      async () => {
        generated += 1;
        return `REP-2610-00000${generated}`;
      },
      async (value) => `saved:${value}`,
    );

    expect(result).toBe('saved:REP-2610-000001');
    expect(generated).toBe(1);
  });

  it('يعيد المحاولة عند E11000 ثم ينجح برقم جديد', async () => {
    const duplicate = Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    let attempts = 0;

    const result = await withUniqueRetry(
      async () => `REP-2610-00000${attempts + 1}`,
      async (value) => {
        attempts += 1;
        if (attempts < 3) throw duplicate;
        return value;
      },
    );

    expect(attempts).toBe(3);
    expect(result).toBe('REP-2610-000003');
  });

  it('لا يعيد المحاولة عند خطأ غير التصادم ويرفعه فورًا', async () => {
    const boom = new Error('انقطاع الشبكة');
    let attempts = 0;

    await expect(
      withUniqueRetry(
        async () => 'REP-2610-000001',
        async () => {
          attempts += 1;
          throw boom;
        },
      ),
    ).rejects.toBe(boom);

    expect(attempts).toBe(1);
  });

  it('يرفع آخر خطأ تصادم بعد استنفاد المحاولات', async () => {
    const duplicate = Object.assign(new Error('E11000'), { code: 11000 });
    let attempts = 0;

    await expect(
      withUniqueRetry(
        async () => `REP-2610-${String(attempts).padStart(6, '0')}`,
        async () => {
          attempts += 1;
          throw duplicate;
        },
        3,
      ),
    ).rejects.toBe(duplicate);

    expect(attempts).toBe(3);
  });
});

describe('nextTicketNumber — العدّاد الذرّي', () => {
  it('يزيد عدّاد الفرع الأقدم النشط فقط ويصدر أرقامًا متسلسلة', async () => {
    const orgId = org();
    const olderBranch = await rawBranch({
      organizationId: orgId,
      name: 'الرئيسي',
      code: 'MAIN',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    const newerBranch = await rawBranch({
      organizationId: orgId,
      name: 'فرع ثانٍ',
      code: 'BR2',
      createdAt: new Date('2026-02-01T00:00:00Z'),
    });

    const ctx = ctxFor(orgId);
    const first = await runWithTenantContext(ctx, () => nextTicketNumber());
    const second = await runWithTenantContext(ctx, () => nextTicketNumber());

    const period = first.slice(4, 8);
    expect(first).toBe(`REP-${period}-000001`);
    expect(second).toBe(`REP-${period}-000002`);

    const olderDoc = await BranchModel.collection.findOne({ _id: olderBranch });
    const newerDoc = await BranchModel.collection.findOne({ _id: newerBranch });
    expect((olderDoc?.counterSeq as Record<string, number> | undefined)?.[`REP_${period}`]).toBe(2);
    expect((newerDoc?.counterSeq as Record<string, number> | undefined)?.[`REP_${period}`]).toBeUndefined();
  });

  it('لا يصدر رقمان متطابقان عند الطلبات المتزامنة', async () => {
    const orgId = org();
    await rawBranch({
      organizationId: orgId,
      name: 'الرئيسي',
      code: 'MAIN',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    const ctx = ctxFor(orgId);
    const numbers = await runWithTenantContext(ctx, () =>
      Promise.all(Array.from({ length: 12 }, () => nextTicketNumber())),
    );

    expect(new Set(numbers).size).toBe(12);
    const sequences = numbers.map((n) => Number(n.split('-')[2])).sort((a, b) => a - b);
    expect(sequences).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });

  it('مؤسسة بلا فرع نشط: رقم بديل مبني على الزمن ولا يستعير فرع مؤسسة أخرى', async () => {
    const otherOrg = org();
    const otherBranch = await rawBranch({
      organizationId: otherOrg,
      name: 'مؤسسة أخرى',
      code: 'OTH',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    const orgId = org();
    await rawBranch({
      organizationId: orgId,
      name: 'فرع موقوف',
      code: 'OFF',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      isActive: false,
    });

    const number = await runWithTenantContext(ctxFor(orgId), () => nextTicketNumber());

    expect(number).toMatch(/^REP-\d{4}-\d{6}$/);
    const otherDoc = await BranchModel.collection.findOne({ _id: otherBranch });
    expect(Object.keys((otherDoc?.counterSeq ?? {}) as Record<string, number>)).toHaveLength(0);
  });
});

describe('syncNumberCounters', () => {
  it('يرفع العدّاد لأكبر رقم فعلي لكل مؤسسة على حدة ولا ينقص عدّادًا قائمًا', async () => {
    const orgA = org();
    const orgB = org();
    const branchA = await rawBranch({
      organizationId: orgA,
      name: 'أ',
      code: 'A1',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      counterSeq: { EST_2610: 2 },
    });
    await rawBranch({
      organizationId: orgB,
      name: 'ب',
      code: 'B1',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      counterSeq: { REP_2610: 5000 },
    });

    await EstimateModel.collection.insertMany([
      { _id: new Types.ObjectId(), organizationId: orgA, estimateNumber: 'EST-2610-000060' },
      { _id: new Types.ObjectId(), organizationId: orgA, estimateNumber: 'EST-2610-000012' },
    ]);
    await RepairTicketModel.collection.insertMany([
      { _id: new Types.ObjectId(), organizationId: orgB, ticketNumber: 'REP-2610-000005' },
    ]);
    await WarrantyClaimModel.collection.insertMany([
      { _id: new Types.ObjectId(), organizationId: orgB, claimNumber: 'WCL-2610-688999' },
    ]);

    const result = await syncNumberCounters({ apply: false });

    expect(result[String(orgA)]?.EST_2610).toBe(60);
    expect(result[String(orgB)]?.WCL_2610).toBe(688999);
    // العدّاد القائم أكبر من أكبر رقم فعلي — لا ينقص أبدًا
    expect(result[String(orgB)]?.REP_2610).toBe(5000);
    // لا تتسرب أرقام مؤسسة إلى خريطة مؤسسة أخرى
    expect(result[String(orgB)]?.EST_2610).toBeUndefined();

    // apply:false لا يكتب شيئًا في الفروع
    const untouched = await BranchModel.collection.findOne({ _id: branchA });
    expect((untouched?.counterSeq as Record<string, number> | undefined)?.EST_2610).toBe(2);
  });

  it('apply=true يكتب لكل مؤسسة خرائطها على فروعها فقط', async () => {
    const orgA = org();
    const orgB = org();
    const branchA = await rawBranch({
      organizationId: orgA,
      name: 'أ',
      code: 'A1',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    const branchB = await rawBranch({
      organizationId: orgB,
      name: 'ب',
      code: 'B1',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    await EstimateModel.collection.insertMany([
      { _id: new Types.ObjectId(), organizationId: orgA, estimateNumber: 'EST-2610-000060' },
    ]);
    await RepairTicketModel.collection.insertMany([
      { _id: new Types.ObjectId(), organizationId: orgB, ticketNumber: 'REP-2610-000005' },
    ]);

    await syncNumberCounters({ apply: true });

    const afterA = await BranchModel.collection.findOne({ _id: branchA });
    const afterB = await BranchModel.collection.findOne({ _id: branchB });
    expect((afterA?.counterSeq as Record<string, number> | undefined)?.EST_2610).toBe(60);
    expect((afterA?.counterSeq as Record<string, number> | undefined)?.REP_2610).toBeUndefined();
    expect((afterB?.counterSeq as Record<string, number> | undefined)?.REP_2610).toBe(5);
    expect((afterB?.counterSeq as Record<string, number> | undefined)?.EST_2610).toBeUndefined();
  });

  it('يمنع تصادم E11000 بعد الزرع: أول رقم حقيقي يتخطى الموجود فعليًا', async () => {
    const orgId = org();
    const now = new Date();
    const period = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}`;
    await rawBranch({
      organizationId: orgId,
      name: 'الرئيسي',
      code: 'MAIN',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      counterSeq: { [`REP_${period}`]: 2 },
    });
    await RepairTicketModel.collection.insertMany([
      { _id: new Types.ObjectId(), organizationId: orgId, ticketNumber: `REP-${period}-000098` },
    ]);

    await syncNumberCounters({ apply: true });
    const number = await runWithTenantContext(ctxFor(orgId), () => nextTicketNumber());

    expect(number).toBe(`REP-${period}-000099`);
  });
});
