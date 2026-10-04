import { INACTIVE_REPAIR_STATUSES } from '../constants/repair.js';
import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { CustomerModel } from '../models/Customer.js';
import { DeviceModel } from '../models/Device.js';
import { RepairTicketModel } from '../models/RepairTicket.js';
import { ApiError } from '../utils/ApiError.js';
import { created, ok, paginated } from '../utils/asyncHandler.js';
import { parseCsv, parseListQuery, parseSort, regexSearch } from '../utils/queryHelpers.js';
import { normalizeEgyptPhone } from '../validators/common.js';
import { getAuth } from '../middleware/auth.js';
import { getTenantContext } from '../context/tenantContext.js';
import { recordAudit } from '../services/auditService.js';
import type { CreateCustomerInput } from '../validators/coreValidators.js';

const SORTABLE = ['createdAt', 'updatedAt', 'fullName', 'stats.totalSpentEgp', 'stats.lastVisitAt'];

function buildFilter(req: Request): Record<string, unknown> {
  const query = req.query as Record<string, unknown>;
  const filter: Record<string, unknown> = {};
  const search = regexSearch(query.q);

  if (search) {
    filter.$or = [{ fullName: search }, { phone: search }, { phoneAlt: search }, { companyName: search }, { code: search }];
  }

  const types = parseCsv(query.type);
  if (types.length) filter.type = { $in: types };

  const tags = parseCsv(query.tags);
  if (tags.length) filter.tags = { $in: tags };

  if (query.isActive !== undefined) filter.isActive = query.isActive === 'true';
  if (query.isBlacklisted !== undefined) filter.isBlacklisted = query.isBlacklisted === 'true';

  return filter;
}

export const listCustomers = async (req: Request, res: Response) => {
  const { page, limit, skip } = parseListQuery(req.query as Record<string, unknown>);
  const sort = parseSort(req.query as Record<string, unknown>, SORTABLE, { createdAt: -1 });
  const filter = buildFilter(req);

  const [items, total] = await Promise.all([
    CustomerModel.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    CustomerModel.countDocuments(filter),
  ]);

  return paginated(res, items, { page, limit, total });
};

export const getCustomer = async (req: Request, res: Response) => {
  const customer = await CustomerModel.findById(req.params.id).lean();
  if (!customer) throw ApiError.notFound('العميل غير موجود');

  const [devices, recentTickets, openTickets, totals] = await Promise.all([
    DeviceModel.find({ customerId: customer._id, isActive: true })
      .select('brand model category imei serial color storage passport conditionOnIntake createdAt')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
    RepairTicketModel.find({ customerId: customer._id })
      .select('ticketNumber status priority deviceId cost.totalFinalEgp createdAt deliveredAt warranty.expiresAt')
      .sort({ createdAt: -1 })
      .limit(15)
      .lean(),
    RepairTicketModel.countDocuments({ customerId: customer._id, status: { $nin: INACTIVE_REPAIR_STATUSES } }),
    RepairTicketModel.aggregate<{ totalSpent: number; count: number }>([
      { $match: { customerId: customer._id, status: 'delivered' } },
      { $group: { _id: null, totalSpent: { $sum: '$cost.totalFinalEgp' }, count: { $sum: 1 } } },
    ]),
  ]);

  const spent = totals[0]?.totalSpent ?? 0;

  return ok(res, {
    ...customer,
    devices,
    recentTickets,
    summary: {
      openTickets,
      deliveredTickets: totals[0]?.count ?? 0,
      totalSpentEgp: Number(spent.toFixed(2)),
    },
  });
};

export const createCustomer = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const ctx = getTenantContext();
  const body = req.body as CreateCustomerInput;

  const phone = normalizeEgyptPhone(body.phone);

  const duplicate = await CustomerModel.findOne({ phone }).select('fullName phone').lean();
  if (duplicate) {
    throw ApiError.conflict('يوجد عميل بنفس رقم الهاتف', {
      customerId: String(duplicate._id),
      fullName: duplicate.fullName,
    });
  }

  const count = await CustomerModel.countDocuments();
  const customer = await CustomerModel.create({
    organizationId: ctx!.organizationId,
    branchId: ctx!.branchId,
    code: `C${String(count + 1).padStart(5, '0')}`,
    fullName: body.fullName,
    phone,
    phoneAlt: body.phoneAlt ? normalizeEgyptPhone(body.phoneAlt) : '',
    email: body.email ?? '',
    whatsapp: body.whatsapp ? normalizeEgyptPhone(body.whatsapp) : phone,
    type: body.type ?? 'individual',
    companyName: body.companyName ?? '',
    taxId: body.taxId ?? '',
    address: body.address ?? {},
    tags: body.tags ?? [],
    notes: body.notes ?? '',
    consent: body.consent ?? {},
    stats: { lastVisitAt: new Date() },
    createdBy: new Types.ObjectId(auth.userId),
  });

  await recordAudit(
    { action: 'create', resource: 'Customer', resourceId: String(customer._id), summary: `عميل جديد: ${customer.fullName}` },
    req,
  );

  return created(res, customer.toObject());
};

export const updateCustomer = async (req: Request, res: Response) => {
  const customer = await CustomerModel.findById(req.params.id);
  if (!customer) throw ApiError.notFound('العميل غير موجود');

  const body = req.body as Partial<CreateCustomerInput> & {
    isBlacklisted?: boolean;
    blacklistReason?: string;
    isActive?: boolean;
  };

  if (body.phone) {
    const phone = normalizeEgyptPhone(body.phone);
    const duplicate = await CustomerModel.findOne({ phone, _id: { $ne: customer._id } }).lean();
    if (duplicate) throw ApiError.conflict('رقم الهاتف مستخدم لعميل آخر');
    customer.phone = phone;
  }

  for (const field of ['fullName', 'phoneAlt', 'email', 'companyName', 'taxId', 'notes'] as const) {
    if (body[field] !== undefined) (customer as unknown as Record<string, unknown>)[field] = body[field];
  }
  if (body.whatsapp !== undefined) customer.whatsapp = normalizeEgyptPhone(body.whatsapp);
  if (body.type) customer.type = body.type;
  if (body.address) customer.address = { ...customer.address, ...body.address } as typeof customer.address;
  if (body.tags) customer.tags = body.tags;
  if (body.consent) customer.consent = { ...customer.consent, ...body.consent } as typeof customer.consent;
  if (body.isBlacklisted !== undefined) customer.isBlacklisted = body.isBlacklisted;
  if (body.blacklistReason !== undefined) customer.blacklistReason = body.blacklistReason;
  if (body.isActive !== undefined) customer.isActive = body.isActive;

  await customer.save();

  await recordAudit(
    { action: 'update', resource: 'Customer', resourceId: String(customer._id), summary: `تحديث عميل: ${customer.fullName}` },
    req,
  );

  return ok(res, customer.toObject());
};

export const deleteCustomer = async (req: Request, res: Response) => {
  const customer = await CustomerModel.findById(req.params.id);
  if (!customer) throw ApiError.notFound('العميل غير موجود');

  const openTickets = await RepairTicketModel.countDocuments({
    customerId: customer._id,
    status: { $nin: INACTIVE_REPAIR_STATUSES },
  });
  if (openTickets > 0) {
    throw ApiError.businessRule('لا يمكن حذف عميل لديه تذاكر صيانة مفتوحة', { openTickets });
  }

  customer.isActive = false;
  await customer.save();

  await recordAudit(
    { action: 'delete', resource: 'Customer', resourceId: String(customer._id), summary: `تعطيل عميل: ${customer.fullName}`, severity: 'warning' },
    req,
  );

  return ok(res, { message: 'تم تعطيل العميل (حذف منطقي)', softDelete: true });
};

/** بحث سريع بالهاتف - يُستخدم في شاشة الاستقبال */
export const lookupCustomerByPhone = async (req: Request, res: Response) => {
  const raw = String(req.query.phone ?? '').trim();
  if (!raw) throw ApiError.badRequest('رقم الهاتف مطلوب');
  const phone = normalizeEgyptPhone(raw);

  const customer = await CustomerModel.findOne({ phone }).lean();
  if (!customer) return ok(res, { found: false, phone, customer: null, devices: [] });

  const devices = await DeviceModel.find({ customerId: customer._id, isActive: true })
    .select('brand model category imei serial color storage passport')
    .sort({ createdAt: -1 })
    .lean();

  return ok(res, { found: true, phone, customer, devices });
};
