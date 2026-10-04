import { INACTIVE_REPAIR_STATUSES } from '../constants/repair.js';
import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { DeviceModel } from '../models/Device.js';
import { CustomerModel } from '../models/Customer.js';
import { RepairTicketModel } from '../models/RepairTicket.js';
import { RepairPartModel } from '../models/RepairPart.js';
import { RepairStatusHistoryModel } from '../models/RepairStatusHistory.js';
import { StoredFileModel } from '../models/StoredFile.js';
import { WarrantyClaimModel } from '../models/WarrantyClaim.js';
import { PartModel } from '../models/Part.js';
import { ApiError } from '../utils/ApiError.js';
import { created, ok, paginated } from '../utils/asyncHandler.js';
import { parseCsv, parseListQuery, parseSort, regexSearch } from '../utils/queryHelpers.js';
import { getAuth } from '../middleware/auth.js';
import { getTenantContext } from '../context/tenantContext.js';
import { recordAudit } from '../services/auditService.js';
import { publicFileUrl } from '../services/storageService.js';
import { REPAIR_STATUS_LABELS_AR, type RepairStatus } from '../constants/repair.js';
import type { CreateDeviceInput } from '../validators/coreValidators.js';

const SORTABLE = ['createdAt', 'updatedAt', 'brand', 'model', 'passport.lastServiceAt'];

export const listDevices = async (req: Request, res: Response) => {
  const { page, limit, skip } = parseListQuery(req.query as Record<string, unknown>);
  const sort = parseSort(req.query as Record<string, unknown>, SORTABLE, { createdAt: -1 });
  const query = req.query as Record<string, unknown>;

  const filter: Record<string, unknown> = {};
  const search = regexSearch(query.q);
  if (search) {
    filter.$or = [{ brand: search }, { model: search }, { imei: search }, { serial: search }, { modelNumber: search }];
  }
  const brands = parseCsv(query.brand);
  if (brands.length) filter.brand = { $in: brands };
  const categories = parseCsv(query.category);
  if (categories.length) filter.category = { $in: categories };
  if (query.customerId) filter.customerId = query.customerId;
  if (query.isActive !== undefined) filter.isActive = query.isActive === 'true';

  const [items, total] = await Promise.all([
    DeviceModel.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('customerId', 'fullName phone companyName')
      .lean(),
    DeviceModel.countDocuments(filter),
  ]);

  return paginated(res, items, { page, limit, total });
};

/**
 * Device Passport: صفحة تاريخ الجهاز الكاملة.
 * Brand/Model/IMEI + صور الاستلام + سجل الإصلاحات + القطع المستبدلة + نتائج الفحص + الضمان.
 */
export const getDevice = async (req: Request, res: Response) => {
  const device = await DeviceModel.findById(req.params.id).lean();
  if (!device) throw ApiError.notFound('الجهاز غير موجود');

  const [customer, tickets, parts, files, claims] = await Promise.all([
    CustomerModel.findById(device.customerId).select('fullName phone whatsapp companyName type').lean(),
    RepairTicketModel.find({ deviceId: device._id })
      .select(
        'ticketNumber status priority intake.complaint diagnosis.summary outcome cost.totalFinalEgp ' +
          'assignedTechnicianId createdAt deliveredAt warranty.policyDays warranty.expiresAt evidence',
      )
      .populate('assignedTechnicianId', 'fullName')
      .sort({ createdAt: -1 })
      .lean(),
    RepairPartModel.find({ deviceId: device._id })
      .populate('partId', 'name sku category grade')
      .populate('supplierId', 'name')
      .sort({ createdAt: -1 })
      .lean(),
    StoredFileModel.find({ deviceId: device._id, isDeleted: false })
      .select('kind stage caption storageKey mimeType createdAt _id')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean(),
    WarrantyClaimModel.find({ deviceId: device._id }).sort({ reportedAt: -1 }).lean(),
  ]);

  const ticketIds = tickets.map((t) => t._id);
  const timeline = ticketIds.length
    ? await RepairStatusHistoryModel.find({ ticketId: { $in: ticketIds } })
        .sort({ createdAt: -1 })
        .limit(300)
        .lean()
    : [];

  const photos = files.map((f) => ({
    id: String(f._id),
    kind: f.kind,
    stage: f.stage,
    caption: f.caption,
    mimeType: f.mimeType,
    url: publicFileUrl(f.storageKey),
    createdAt: f.createdAt,
  }));

  return ok(res, {
    device: { ...device, maskedImei: `${String(device.imei ?? '').slice(0, 4)}****${String(device.imei ?? '').slice(-3)}` },
    customer,
    /** سجل الإصلاحات مرتبًا من الأحدث */
    repairHistory: tickets.map((t) => ({
      ...t,
      statusLabel: REPAIR_STATUS_LABELS_AR[t.status as RepairStatus] ?? t.status,
    })),
    replacedParts: parts,
    photos,
    warrantyClaims: claims,
    timeline,
    summary: {
      totalRepairs: device.passport?.totalRepairs ?? 0,
      totalSpentEgp: device.passport?.totalSpentEgp ?? 0,
      openTickets: device.passport?.openTickets ?? 0,
      riskFlags: device.passport?.riskFlags ?? [],
      lastServiceAt: device.passport?.lastServiceAt ?? null,
      warrantyClaims: claims.length,
    },
  });
};

export const createDevice = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const ctx = getTenantContext();
  const body = req.body as CreateDeviceInput;

  const customer = await CustomerModel.findById(body.customerId).select('_id fullName').lean();
  if (!customer) throw ApiError.notFound('العميل غير موجود');

  // منع تكرار نفس IMEI لنفس المؤسسة (تحقق ناعم: تحذير وليس منعًا صارمًا للأجهزة بلا IMEI)
  if (body.imei) {
    const duplicate = await DeviceModel.findOne({ imei: body.imei }).select('_id brand model').lean();
    if (duplicate) {
      throw ApiError.conflict('هذا الـIMEI مسجل بالفعل على جهاز آخر', {
        deviceId: String(duplicate._id),
        device: `${duplicate.brand} ${duplicate.model}`,
      });
    }
  }

  const device = await DeviceModel.create({
    organizationId: ctx!.organizationId,
    branchId: ctx!.branchId,
    customerId: new Types.ObjectId(body.customerId),
    category: body.category ?? 'smartphone',
    brand: body.brand,
    model: body.model,
    modelNumber: body.modelNumber ?? '',
    imei: body.imei ?? '',
    imei2: body.imei2 ?? '',
    serial: body.serial ?? '',
    color: body.color ?? '',
    storage: body.storage ?? '',
    ram: body.ram ?? '',
    hasLockCode: body.hasLockCode ?? false,
    lockType: body.lockType ?? 'none',
    lockProvidedByCustomer: body.lockProvidedByCustomer ?? false,
    isAccountLocked: body.isAccountLocked ?? false,
    conditionOnIntake: body.conditionOnIntake ?? 'good',
    purchase: body.purchase ?? {},
    notes: body.notes ?? '',
    createdBy: new Types.ObjectId(auth.userId),
  });

  await recordAudit(
    {
      action: 'create',
      resource: 'Device',
      resourceId: String(device._id),
      summary: `جهاز جديد: ${device.brand} ${device.model}`,
    },
    req,
  );

  return created(res, device.toObject());
};

export const updateDevice = async (req: Request, res: Response) => {
  const device = await DeviceModel.findById(req.params.id);
  if (!device) throw ApiError.notFound('الجهاز غير موجود');

  const body = req.body as Partial<CreateDeviceInput> & { isActive?: boolean };

  if (body.imei && body.imei !== device.imei) {
    const duplicate = await DeviceModel.findOne({ imei: body.imei, _id: { $ne: device._id } }).lean();
    if (duplicate) throw ApiError.conflict('هذا الـIMEI مسجل بالفعل على جهاز آخر');
  }

  const directFields = [
    'category',
    'brand',
    'model',
    'modelNumber',
    'imei',
    'imei2',
    'serial',
    'color',
    'storage',
    'ram',
    'hasLockCode',
    'lockType',
    'lockProvidedByCustomer',
    'isAccountLocked',
    'conditionOnIntake',
    'notes',
    'isActive',
  ] as const;

  for (const field of directFields) {
    if (body[field] !== undefined) {
      (device as unknown as Record<string, unknown>)[field] = body[field];
    }
  }
  if (body.purchase) device.purchase = { ...device.purchase, ...body.purchase } as typeof device.purchase;

  await device.save();

  await recordAudit(
    {
      action: 'update',
      resource: 'Device',
      resourceId: String(device._id),
      summary: `تحديث جهاز: ${device.brand} ${device.model}`,
    },
    req,
  );

  return ok(res, device.toObject());
};

export const deleteDevice = async (req: Request, res: Response) => {
  const device = await DeviceModel.findById(req.params.id);
  if (!device) throw ApiError.notFound('الجهاز غير موجود');

  const openTickets = await RepairTicketModel.countDocuments({
    deviceId: device._id,
    status: { $nin: INACTIVE_REPAIR_STATUSES },
  });
  if (openTickets) throw ApiError.businessRule('لا يمكن حذف جهاز لديه تذكرة مفتوحة', { openTickets });

  device.isActive = false;
  await device.save();

  await recordAudit(
    { action: 'delete', resource: 'Device', resourceId: String(device._id), summary: `تعطيل جهاز: ${device.brand} ${device.model}`, severity: 'warning' },
    req,
  );

  return ok(res, { message: 'تم تعطيل الجهاز (حذف منطقي)', softDelete: true });
};

/** الأجهزة المشتبه في تاريخها: أعطال متكررة أو عوائد ضمان */
export const problematicDevices = async (_req: Request, res: Response) => {
  const devices = await DeviceModel.find({
    $or: [{ 'passport.totalRepairs': { $gte: 3 } }, { 'passport.warrantyClaims': { $gte: 1 } }, { 'passport.riskFlags': 'liquid_damage' }],
  })
    .populate('customerId', 'fullName phone')
    .sort({ 'passport.warrantyClaims': -1, 'passport.totalRepairs': -1 })
    .limit(100)
    .lean();

  return ok(res, { count: devices.length, devices });
};

/* ------------------------------------------------------------------ */
/*  Intake & Evidence: الصور والأدلة                                   */
/* ------------------------------------------------------------------ */

/** صور الجهاز/التذكرة */
export const listDeviceFiles = async (req: Request, res: Response) => {
  const { ticketId, deviceId, kind } = req.query as Record<string, string | undefined>;
  const filter: Record<string, unknown> = { isDeleted: false };
  if (ticketId) filter.ticketId = ticketId;
  if (deviceId) filter.deviceId = deviceId;
  if (kind) filter.kind = kind;

  const files = await StoredFileModel.find(filter)
    .select('kind stage caption storageKey mimeType sizeBytes createdAt ticketId deviceId')
    .sort({ createdAt: -1 })
    .limit(300)
    .lean();

  return ok(
    res,
    files.map((f) => ({
      id: String(f._id),
      kind: f.kind,
      stage: f.stage,
      caption: f.caption,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
      ticketId: f.ticketId,
      deviceId: f.deviceId,
      url: publicFileUrl(f.storageKey),
      createdAt: f.createdAt,
    })),
  );
};

/* --------------------- قاعدة معرفة القطع المتوافقة --------------------- */

/** اقتراح قطع متوافقة مع موديل الجهاز (Parts Intelligence) */
export const suggestPartsForDevice = async (req: Request, res: Response) => {
  const device = await DeviceModel.findById(req.params.id).select('brand model modelNumber').lean();
  if (!device) throw ApiError.notFound('الجهاز غير موجود');

  const modelQuery = device.model?.trim();
  const parts = await PartModel.find({
    isActive: true,
    $or: [
      { 'compatibility.deviceModels': modelQuery },
      { 'compatibility.deviceModels': new RegExp(modelQuery ?? '', 'i') },
      { 'compatibility.deviceBrands': device.brand },
    ],
  })
    .select('name sku category grade pricing.costEgp pricing.sellingPriceEgp stock warranty.days compatibility')
    .sort({ 'stock.onHand': -1 })
    .limit(50)
    .lean();

  return ok(res, {
    device: { brand: device.brand, model: device.model, modelNumber: device.modelNumber },
    suggestions: parts.map((p) => ({
      ...p,
      available: Math.max(0, (p.stock?.onHand ?? 0) - (p.stock?.reserved ?? 0)),
    })),
    count: parts.length,
  });
};
