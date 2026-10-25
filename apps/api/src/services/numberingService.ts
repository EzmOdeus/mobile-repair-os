import { Types } from 'mongoose';
import { BranchModel } from '../models/Branch.js';
import { RepairTicketModel } from '../models/RepairTicket.js';
import { InvoiceModel } from '../models/Invoice.js';
import { EstimateModel } from '../models/Estimate.js';
import { PaymentModel } from '../models/Payment.js';
import { WarrantyClaimModel } from '../models/WarrantyClaim.js';
import { StockTransferModel } from '../models/StockTransfer.js';
import { PurchaseOrderModel } from '../models/PurchaseOrder.js';
import { StockCountModel } from '../models/StockCount.js';
import { ApiError } from '../utils/ApiError.js';
import { getTenantContext, runAsSystem } from '../context/tenantContext.js';
import { formatSequenceNumber, publicToken } from '../utils/ids.js';

/** أنواع المستندات التي تحتاج ترقيمًا متسلسلًا */
export type SequenceKind = 'REP' | 'INV' | 'TRF' | 'EST' | 'RCP' | 'WCL' | 'QT' | 'PO' | 'STK' | 'SFT';

/**
 * الفرع الذي يحمل عدّاد الترقيم المشترك.
 *
 * **الخطأ الذي يعالجه هذا الملف:** كان العدّاد لكل فرع (`$inc` على مستند الفرع
 * الطالب) والرقم الناتج لا يحمل رمز الفرع، بينما الفهرس الفريد
 * `{organizationId, ticketNumber}`. فكل فرع يبدأ من 1 ⇒ أول تذكرة في كل فرع
 * تحمل نفس الرقم ⇒ E11000 ⇒ أي مركز بفرعين كان يفشل إصداره الثاني إطلاقًا.
 * (أُثبت عمليًا: الفرع «أ» أنتج `REP-2610-000001` والفرع «ب» رُفض بـ409.)
 *
 * الحل: عدّاد واحد لكل (مؤسسة، نوع مستند، شهر) داخل مستند **فرع واحد ثابت** هو
 * الأقدم في المؤسسة (وهو عادةً الفرع الافتراضي الأول). `$inc` على حقل في مستند
 * واحد ذرّي، فيعطي تسلسلًا فريدًا بلا معاملة وبلا سباق، بشرط أن يتعامل كل
 * الطالبين مع **نفس** المستند — وهو ما يضمنه هذا الاختيار الحتمي (الأقدم لا
 * يتغير إلا لو أُغلق الفرع).
 */
async function counterBranchId(): Promise<Types.ObjectId | null> {
  const branch = await BranchModel.findOne({ isActive: true })
    .sort({ createdAt: 1, _id: 1 })
    .select('_id')
    .lean();
  return (branch?._id as Types.ObjectId | undefined) ?? null;
}

/** زيادة عدّاد ذرّية وإرجاع القيمة الجديدة */
async function incrementCounter(branchId: Types.ObjectId, counterKey: string): Promise<number> {
  const updated = await BranchModel.findOneAndUpdate(
    { _id: branchId },
    { $inc: { [`counterSeq.${counterKey}`]: 1 } },
    { new: true, projection: { [`counterSeq.${counterKey}`]: 1 } },
  ).lean();

  const seq = (updated?.counterSeq as Record<string, number> | undefined)?.[counterKey];
  return typeof seq === 'number' && Number.isFinite(seq) ? seq : 1;
}

/**
 * توليد رقم متسلسل فريد على مستوى المؤسسة (بلا رمز فرع في الرقم نفسه).
 *
 * ملاحظة مهمة: المعامل `branchId` أُزيل عمدًا — تمريره كان يوحي بأن الترقيم
 * لكل فرع، وهو أصل الخلل. الترقيم الآن معرّفه الوحيد: (نوع المستند، الشهر).
 */
async function nextSequenceNumber(kind: SequenceKind): Promise<string> {
  const ctx = getTenantContext();
  if (!ctx) throw ApiError.forbidden('لا يمكن توليد أرقام بدون سياق مؤسسة');

  const now = new Date();
  const period = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const counterKey = `${kind}_${period}`;

  const branchId = await counterBranchId();
  if (branchId) {
    const seq = await incrementCounter(branchId, counterKey);
    return formatSequenceNumber(kind, seq, now);
  }

  /**
   * مؤسسة بلا أي فرع نشط (حالة نادرة: وسط إنشاء، أو كل الفروع موقوفة).
   * الرقم مبني على الزمن فلا يعتمد على عدّاد، ويظل فريدًا عمليًا.
   */
  return `${kind}-${period}-${String(Date.now()).slice(-6)}`;
}

/**
 * إعادة المحاولة عند تصادم مفتاح فريد.
 *
 * لماذا نحتاجها رغم ذرّية `$inc`: لو أُعيدت تهيئة العدّاد (مثلًا `seed --reset`)
 * أو استُعيدت نسخة احتياطية، قد يصدر رقم موجود بالفعل. نعيد المحاولة بعدد محدود
 * بدل إفشال العملية على المستخدم.
 */
export async function withUniqueRetry<T>(
  generate: () => Promise<string>,
  attempt: (value: string) => Promise<T>,
  maxAttempts = 5,
): Promise<T> {
  let lastError: unknown = null;

  for (let i = 0; i < maxAttempts; i += 1) {
    const value = await generate();
    try {
      return await attempt(value);
    } catch (error) {
      const isDuplicate =
        typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
      if (!isDuplicate) throw error;
      lastError = error;
    }
  }

  throw lastError ?? new Error('تعذر توليد رقم فريد');
}

export async function nextTicketNumber(): Promise<string> {
  return nextSequenceNumber('REP');
}

export async function nextInvoiceNumber(): Promise<string> {
  return nextSequenceNumber('INV');
}

export async function nextTransferNumber(): Promise<string> {
  // عدّاد مستقل: كان يشارك عدّاد الفواتير فيُنتج فجوات في ترقيم الفواتير
  return nextSequenceNumber('TRF');
}

export async function nextEstimateNumber(): Promise<string> {
  return nextSequenceNumber('EST');
}

export async function nextReceiptNumber(): Promise<string> {
  return nextSequenceNumber('RCP');
}

export async function nextClaimNumber(): Promise<string> {
  return nextSequenceNumber('WCL');
}

export async function nextPurchaseOrderNumber(): Promise<string> {
  return nextSequenceNumber('PO');
}

export async function nextStockCountNumber(): Promise<string> {
  return nextSequenceNumber('STK');
}

export async function nextShiftNumber(): Promise<string> {
  return nextSequenceNumber('SFT');
}

/**
 * مزامنة عدّادات الترقيم مع الأرقام الفعلية في قاعدة البيانات — لكل مؤسسة على حدة.
 *
 * **المشكلة التي تعالجها:** زرع البيانات أو استعادة نسخة احتياطية تُدخل مستندات
 * بأرقام جاهزة (مثل `EST-2610-000060`) دون المرور بخدمة الترقيم، فيبقى عدّاد
 * `counterSeq` متأخرًا أو فارغًا. أول مستند حقيقي بعدها يبدأ من 1 ويصطدم برقم
 * موجود ⇒ E11000 ⇒ 409 على عملية إنشاء سليمة تمامًا من ناحية المستخدم.
 *
 * الحل: نحلّل الأرقام الفعلية بنمط `KIND-YYMM-NNNNNN` ونرفع العدّاد لأكبر تسلسل
 * مستخدم لكل (مؤسسة، نوع، شهر). ولا نُنقص أي عدّاد حالي أبدًا — حذف مستند لا
 * يجوز أن يعيد الترقيم إلى الخلف (يُنتج تكرارًا لاحقًا).
 *
 * الفصل حسب المؤسسة ضروري: الأرقام فريدة داخل المؤسسة فقط
 * ({organizationId, number})، فدمج أرقام كل المؤسسات في خريطة واحدة كان يقفز
 * بعدّادات مؤسسة صغيرة إلى ذروة أرقام مؤسسة أخرى — فجوات بلا داعٍ.
 *
 * تُستدعى من `seed` بعد الزرع، ومن سكربت `fix-counters` لأي قاعدة قائمة.
 *
 * @param options.apply — `false` لحساب الخريطة بلا كتابة (وضع المعاينة)
 * @returns خريطة متداخلة: معرّف المؤسسة ← (مفتاح العدّاد ← أكبر تسلسل)
 */
export async function syncNumberCounters(
  options: { apply?: boolean } = {},
): Promise<Record<string, Record<string, number>>> {
  const { apply = true } = options;
  const SEQUENCE_PATTERN = /^([A-Z]+)-(\d{4})-(\d+)$/;

  /** أكبر تسلسل لكل (مؤسسة، نوع_شهر) من حقل رقم في مستندات خام */
  const collectMax = (docs: readonly unknown[], field: string): Map<string, Map<string, number>> => {
    const byOrg = new Map<string, Map<string, number>>();
    for (const raw of docs) {
      if (typeof raw !== 'object' || raw === null) continue;
      const doc = raw as Record<string, unknown>;
      const orgId = String(doc.organizationId ?? '');
      if (!orgId) continue;
      const match = SEQUENCE_PATTERN.exec(String(doc[field] ?? ''));
      if (!match) continue;
      const seq = Number(match[3]);
      if (!Number.isFinite(seq)) continue;
      const key = `${match[1]}_${match[2]}`;
      let counters = byOrg.get(orgId);
      if (!counters) {
        counters = new Map<string, number>();
        byOrg.set(orgId, counters);
      }
      if (seq > (counters.get(key) ?? 0)) counters.set(key, seq);
    }
    return byOrg;
  };

  const [tickets, invoices, estimates, payments, claims, transfers, purchaseOrders, stockCounts, branches] =
    await runAsSystem(async () =>
      Promise.all([
        RepairTicketModel.find({}).select('ticketNumber organizationId').lean(),
        InvoiceModel.find({}).select('invoiceNumber organizationId').lean(),
        EstimateModel.find({}).select('estimateNumber organizationId').lean(),
        PaymentModel.find({}).select('receiptNumber organizationId').lean(),
        WarrantyClaimModel.find({}).select('claimNumber organizationId').lean(),
        StockTransferModel.find({}).select('transferNumber organizationId').lean(),
        PurchaseOrderModel.find({}).select('poNumber organizationId').lean(),
        StockCountModel.find({}).select('countNumber organizationId').lean(),
        BranchModel.find({}).select('counterSeq organizationId').lean(),
      ]),
    );

  const merged = new Map<string, Map<string, number>>();
  const mergeOrg = (orgId: string, counters: Map<string, number>): void => {
    let target = merged.get(orgId);
    if (!target) {
      target = new Map<string, number>();
      merged.set(orgId, target);
    }
    for (const [key, seq] of counters) {
      if (typeof seq === 'number' && seq > (target.get(key) ?? 0)) target.set(key, seq);
    }
  };

  for (const [orgId, counters] of collectMax(tickets, 'ticketNumber')) mergeOrg(orgId, counters);
  for (const [orgId, counters] of collectMax(invoices, 'invoiceNumber')) mergeOrg(orgId, counters);
  for (const [orgId, counters] of collectMax(estimates, 'estimateNumber')) mergeOrg(orgId, counters);
  for (const [orgId, counters] of collectMax(payments, 'receiptNumber')) mergeOrg(orgId, counters);
  for (const [orgId, counters] of collectMax(claims, 'claimNumber')) mergeOrg(orgId, counters);
  for (const [orgId, counters] of collectMax(transfers, 'transferNumber')) mergeOrg(orgId, counters);
  for (const [orgId, counters] of collectMax(purchaseOrders, 'poNumber')) mergeOrg(orgId, counters);
  for (const [orgId, counters] of collectMax(stockCounts, 'countNumber')) mergeOrg(orgId, counters);

  // العدّادات القائمة تُدمج كما هي (Math.max) حتى لا ينقص أي عدّاد مهما حُذفت مستندات
  for (const branch of branches) {
    const orgId = String(branch.organizationId ?? '');
    if (!orgId) continue;
    mergeOrg(orgId, new Map(Object.entries((branch.counterSeq ?? {}) as Record<string, number>)));
  }

  const result: Record<string, Record<string, number>> = {};
  for (const [orgId, counters] of merged) result[orgId] = Object.fromEntries(counters);

  if (apply) {
    for (const [orgId, counters] of Object.entries(result)) {
      await runAsSystem(() => BranchModel.updateMany({ organizationId: orgId }, { $set: { counterSeq: counters } }));
    }
  }
  return result;
}

export function nextTrackingToken(): string {
  return publicToken(24);
}
