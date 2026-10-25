import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { NotificationModel } from '../models/Notification.js';
import { AuditLogModel } from '../models/AuditLog.js';
import { KnowledgeArticleModel } from '../models/KnowledgeArticle.js';
import { CustomerModel } from '../models/Customer.js';
import { RepairTicketModel } from '../models/RepairTicket.js';
import { ApiError } from '../utils/ApiError.js';
import { created, ok, paginated } from '../utils/asyncHandler.js';
import { parseCsv, parseListQuery, regexSearch } from '../utils/queryHelpers.js';
import { getAuth } from '../middleware/auth.js';
import { getTenantContext } from '../context/tenantContext.js';
import { recordAudit } from '../services/auditService.js';
import { sendNotification } from '../services/notificationService.js';
import { slugify } from '../utils/ids.js';
import { normalizeEgyptPhone } from '../validators/common.js';

/* ============================ الإشعارات ============================ */

export const listNotifications = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const myId = new Types.ObjectId(auth.userId);
  const { page, limit, skip } = parseListQuery(req.query as Record<string, unknown>, 40);
  const query = req.query as Record<string, unknown>;

  // صندوق المستخدم: إشعاراته الشخصية + إشعارات العملاء العامة (userId فارغ)
  const filter: Record<string, unknown> = { $or: [{ userId: myId }, { userId: null }] };
  const types = parseCsv(query.type);
  if (types.length) filter.type = { $in: types };
  const statuses = parseCsv(query.status);
  if (statuses.length) filter.status = { $in: statuses };
  if (query.channel) filter.channel = query.channel;
  if (query.ticketId) filter.ticketId = query.ticketId;
  if (query.customerId) filter.customerId = query.customerId;
  if (query.unread === 'true') filter.readAt = null;

  const [items, total, unread] = await Promise.all([
    NotificationModel.find(filter)
      .populate('customerId', 'fullName phone')
      .populate('ticketId', 'ticketNumber')
      .populate('listingId', 'title status priceEgp')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    NotificationModel.countDocuments(filter),
    NotificationModel.countDocuments({ readAt: null, channel: 'in_app', userId: myId }),
  ]);

  return res.status(200).json({
    success: true,
    data: items,
    meta: { page, limit, total, pages: Math.ceil(total / limit), unreadInApp: unread },
  });
};

export const markNotificationRead = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const notification = await NotificationModel.findById(req.params.id);
  if (!notification) throw ApiError.notFound('الإشعار غير موجود');
  if (notification.userId && String(notification.userId) !== auth.userId) {
    throw ApiError.forbidden('هذا الإشعار لا يخص المستخدم الحالي');
  }
  notification.readAt = new Date();
  notification.status = 'read';
  await notification.save();
  return ok(res, notification.toObject());
};

export const markAllNotificationsRead = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const result = await NotificationModel.updateMany(
    { userId: new Types.ObjectId(auth.userId), readAt: null },
    { $set: { readAt: new Date(), status: 'read' } },
  );
  return ok(res, { updated: result.modifiedCount ?? 0 });
};

/** إرسال رسالة مخصصة للعميل (WhatsApp/SMS) */
export const sendCustomMessage = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const body = req.body as {
    customerId?: string | null;
    ticketId?: string | null;
    channel: 'whatsapp' | 'sms' | 'email' | 'in_app';
    toPhone?: string;
    templateKey?: string;
    body: string;
    variables?: Record<string, string>;
  };

  let phone = body.toPhone ?? '';
  let customerId = body.customerId ? new Types.ObjectId(body.customerId) : null;
  let deviceId: string | null = null;

  if (customerId && !phone) {
    const customer = await CustomerModel.findById(customerId).select('phone whatsapp').lean();
    if (!customer) throw ApiError.notFound('العميل غير موجود');
    phone = customer.whatsapp || customer.phone;
  }

  if (body.ticketId) {
    const ticket = await RepairTicketModel.findById(body.ticketId).select('deviceId customerId').lean();
    if (ticket) {
      deviceId = String(ticket.deviceId);
      customerId = customerId ?? (ticket.customerId as Types.ObjectId);
    }
  }

  if (!phone && body.channel !== 'in_app') throw ApiError.badRequest('لا يوجد رقم هاتف للإرسال');

  await sendNotification({
    type: 'custom',
    channel: body.channel,
    customerId,
    ticketId: body.ticketId ?? null,
    deviceId,
    toPhone: phone ? normalizeEgyptPhone(phone) : '',
    body: body.body,
    templateKey: body.templateKey,
    variables: body.variables,
  });

  await recordAudit(
    {
      action: 'create',
      resource: 'Notification',
      summary: `إرسال رسالة ${body.channel} ${phone ? `إلى ${phone}` : ''}`,
    },
    req,
  );

  void auth;
  return created(res, { message: 'تم إرسال الرسالة (تم تسجيلها في سجل الإشعارات)' });
};

/* =========================== سجل التدقيق =========================== */

export const listAuditLogs = async (req: Request, res: Response) => {
  const { page, limit, skip } = parseListQuery(req.query as Record<string, unknown>, 50);
  const query = req.query as Record<string, unknown>;

  const filter: Record<string, unknown> = {};
  const actions = parseCsv(query.action);
  if (actions.length) filter.action = { $in: actions };
  if (query.resource) filter.resource = query.resource;
  if (query.resourceId) filter.resourceId = query.resourceId;
  if (query.actorId) filter.actorId = query.actorId;
  if (query.severity) filter.severity = query.severity;
  const search = regexSearch(query.q);
  if (search) filter.$or = [{ summary: search }, { actorName: search }, { resource: search }];
  if (query.from || query.to) {
    const range: Record<string, Date> = {};
    if (query.from) range.$gte = new Date(String(query.from));
    if (query.to) range.$lte = new Date(String(query.to));
    filter.occurredAt = range;
  }

  const [items, total] = await Promise.all([
    AuditLogModel.find(filter).sort({ occurredAt: -1 }).skip(skip).limit(limit).lean(),
    AuditLogModel.countDocuments(filter),
  ]);

  return paginated(res, items, { page, limit, total });
};

/** تدقيق تذكرة بعينها: كل الأحداث المرتبطة بها */
export const auditTrailForResource = async (req: Request, res: Response) => {
  const { resource, resourceId } = req.params;
  const logs = await AuditLogModel.find({ resource, resourceId })
    .sort({ occurredAt: -1 })
    .limit(300)
    .lean();
  return ok(res, { resource, resourceId, count: logs.length, logs });
};

/* ========================== قاعدة المعرفة ========================== */

export const listKnowledge = async (req: Request, res: Response) => {
  const { page, limit, skip } = parseListQuery(req.query as Record<string, unknown>, 30);
  const query = req.query as Record<string, unknown>;

  const filter: Record<string, unknown> = {};
  const search = regexSearch(query.q);
  if (search) filter.$or = [{ title: search }, { symptom: search }, { brand: search }, { tags: search }];
  if (query.brand) filter.brand = query.brand;
  if (query.category) filter.category = query.category;
  if (query.status) filter.status = query.status;
  if (query.model) filter.models = new RegExp(String(query.model), 'i');

  const [items, total] = await Promise.all([
    KnowledgeArticleModel.find(filter)
      .populate('authorId', 'fullName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    KnowledgeArticleModel.countDocuments(filter),
  ]);

  return paginated(res, items, { page, limit, total });
};

export const getKnowledge = async (req: Request, res: Response) => {
  const article = await KnowledgeArticleModel.findById(req.params.id)
    .populate('authorId', 'fullName')
    .populate('reviewedBy', 'fullName')
    .lean();
  if (!article) throw ApiError.notFound('المقالة غير موجودة');
  return ok(res, article);
};

export const createKnowledge = async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const ctx = getTenantContext();
  const body = req.body as Record<string, unknown> & { title: string; symptom: string };

  const article = await KnowledgeArticleModel.create({
    organizationId: ctx!.organizationId,
    branchId: ctx!.branchId,
    ...body,
    slug: `${slugify(body.title)}-${Date.now().toString(36).slice(-4)}`,
    authorId: new Types.ObjectId(auth.userId),
  });

  await recordAudit(
    { action: 'create', resource: 'KnowledgeArticle', resourceId: String(article._id), summary: `مقال معرفة: ${article.title}` },
    req,
  );

  return created(res, article.toObject());
};

export const updateKnowledge = async (req: Request, res: Response) => {
  const article = await KnowledgeArticleModel.findById(req.params.id);
  if (!article) throw ApiError.notFound('المقالة غير موجودة');

  const body = req.body as Record<string, unknown>;
  Object.assign(article, body);

  if (body.status === 'published' && article.status !== 'published') {
    article.reviewedBy = new Types.ObjectId(getAuth(req).userId);
    article.reviewedAt = new Date();
  }
  article.version = (article.version ?? 1) + 1;

  await article.save();

  await recordAudit(
    { action: 'update', resource: 'KnowledgeArticle', resourceId: String(article._id), summary: `تحديث مقال: ${article.title}` },
    req,
  );

  return ok(res, article.toObject());
};

/**
 * البحث في قاعدة المعرفة حسب الموديل والعَرَض.
 * يُستخدم من شاشة الفني كاقتراحات تشخيص (بداية AI Repair Assistant بمصادر موثقة).
 */
export const knowledgeSuggest = async (req: Request, res: Response) => {
  const query = req.query as Record<string, unknown>;
  const symptom = String(query.symptom ?? '').trim();
  const brand = String(query.brand ?? '').trim();
  const model = String(query.model ?? '').trim();

  if (!symptom && !model) throw ApiError.badRequest('حدد العَرَض أو الموديل للبحث');

  const filter: Record<string, unknown> = { status: 'published' };
  const or: Record<string, unknown>[] = [];
  if (symptom) {
    const rx = regexSearch(symptom)!;
    or.push({ symptom: rx }, { title: rx }, { tags: rx }, { knownCauses: { $elemMatch: { cause: rx } } });
  }
  if (model) or.push({ models: new RegExp(model, 'i') });
  if (brand) filter.brand = brand;
  if (or.length) filter.$or = or;

  const articles = await KnowledgeArticleModel.find(filter)
    .select('title symptom brand models category difficulty estimatedMinutes diagnosticSteps knownCauses repairNotes riskWarnings outcomes')
    .limit(10)
    .lean();

  return ok(res, {
    query: { symptom, brand, model },
    /** إخلاء مسؤولية: هذه اقتراحات معرفية وليست تشخيصًا نهائيًا */
    disclaimer: 'النتائج اقتراحات مبنية على قاعدة المعرفة المسجلة، والفحص الفني هو المرجع النهائي.',
    suggestions: articles.map((a) => ({
      id: String(a._id),
      title: a.title,
      symptom: a.symptom,
      category: a.category,
      difficulty: a.difficulty,
      estimatedMinutes: a.estimatedMinutes,
      diagnosticSteps: a.diagnosticSteps,
      knownCauses: a.knownCauses,
      repairNotes: a.repairNotes,
      riskWarnings: a.riskWarnings,
      /** نسبة النجاح التاريخية من التذاكر الفعلية */
      historicalSuccessRatePct: a.outcomes?.successRatePct ?? 0,
      timesApplied: a.outcomes?.timesApplied ?? 0,
    })),
  });
};

/** تحديث نتائج مقال بعد تطبيقه فعليًا على تذكرة (Historical Outcomes) */
export const recordKnowledgeOutcome = async (req: Request, res: Response) => {
  const article = await KnowledgeArticleModel.findById(req.params.id);
  if (!article) throw ApiError.notFound('المقالة غير موجودة');

  const { successful, minutes } = req.body as { successful: boolean; minutes?: number };

  article.outcomes.timesApplied = (article.outcomes.timesApplied ?? 0) + 1;
  if (successful) article.outcomes.timesSuccessful = (article.outcomes.timesSuccessful ?? 0) + 1;
  article.outcomes.successRatePct = Number(
    (((article.outcomes.timesSuccessful ?? 0) / (article.outcomes.timesApplied || 1)) * 100).toFixed(2),
  );
  if (minutes) {
    const applied = article.outcomes.timesApplied;
    const previousAvg = article.outcomes.avgMinutes ?? 0;
    article.outcomes.avgMinutes = Number(((previousAvg * (applied - 1) + minutes) / applied).toFixed(1));
  }

  await article.save();
  return ok(res, article.outcomes);
};
