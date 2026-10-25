import { Router, type Application } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import authRoutes from './authRoutes.js';
import { customerRouter, deviceRouter, ticketRouter } from './coreRoutes.js';
import { validate } from '../middleware/validate.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import {
  adjustStock,
  createPart,
  createStockTransfer,
  createSupplier,
  deletePart,
  deleteSupplier,
  getPart,
  inventoryStock,
  listParts,
  listStockMovements,
  listStockTransfers,
  listSuppliers,
  lowStockParts,
  partsConsumptionReport,
  receiveStockTransfer,
  recordStockMovement,
  sendStockTransfer,
  stockValuation,
  supplierPerformance,
  updatePart,
  updateSupplier,
} from '../controllers/inventoryController.js';
import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  orderPurchaseOrder,
  payablesReport,
  receivePurchaseOrder,
  recordSupplierPayment,
  updatePurchaseOrder,
} from '../controllers/purchaseController.js';
import { createStockCount, getStockCount, listStockCounts } from '../controllers/stockCountController.js';
import {
  addLabor,
  addRepairPart,
  removeLabor,
  removeRepairPart,
  updateRepairPart,
} from '../controllers/repairPartController.js';
import {
  createEstimate,
  decideEstimate,
  getEstimate,
  listEstimates,
  sendEstimate,
  updateEstimate,
} from '../controllers/estimateController.js';
import {
  createQualityCheck,
  createWarrantyClaim,
  decideWarrantyClaim,
  failingPartsReport,
  getQualityCheck,
  getWarrantyClaim,
  listQualityChecks,
  listWarrantyClaims,
  qualityStats,
  submitQualityCheck,
  supplierQualityReport,
  warrantyIntelligence,
} from '../controllers/qualityController.js';
import {
  createExpense,
  createInvoice,
  deleteExpense,
  downloadInvoicePdf,
  financeSummary,
  getInvoice,
  listExpenses,
  listInvoices,
  listPayments,
  posSale,
  recordPayment,
  updateExpense,
  voidInvoice,
} from '../controllers/financeController.js';
import { closeShift, currentShift, getShift, listShifts, openShift } from '../controllers/shiftController.js';
import {
  cashierReport,
  customerStatement,
  profitLossReport,
  receivablesAging,
  supplierStatement,
  vatReport,
} from '../controllers/reportController.js';
import {
  activateSubscriptionHandler,
  availableTechnicians,
  branchPerformance,
  changeSubscriptionPlan,
  createBranch,
  createRenewalRequest,
  deactivateBranch,
  getOrganization,
  listBranches,
  listPlanCatalog,
  listRenewalRequests,
  listSubscriptionPayments,
  listTechnicians,
  technicianPerformance,
  updateBranch,
  updateOrganization,
} from '../controllers/organizationController.js';
import {
  downloadBackup,
  exportOrganizationBackup,
  listBackups,
  restoreBackupFromFile,
  runBackupNow,
} from '../controllers/backupController.js';
import {
  dashboard,
  faultAnalysis,
  pilotKpis,
  sourceAnalysis,
  statusDistribution,
  trends,
  turnaroundTimes,
} from '../controllers/analyticsController.js';
import {
  auditTrailForResource,
  createKnowledge,
  getKnowledge,
  knowledgeSuggest,
  listAuditLogs,
  listKnowledge,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  recordKnowledgeOutcome,
  sendCustomMessage,
  updateKnowledge,
} from '../controllers/supportController.js';
import {
  decideByTrackingToken,
  trackRepair,
  trackingContact,
} from '../controllers/publicTrackingController.js';
import {
  addLaborSchema,
  addRepairPartSchema,
  createPartSchema,
  createSupplierSchema,
  stockAdjustSchema,
  stockCountSchema,
  transferStockSchema,
  updatePartSchema,
  updateRepairPartSchema,
  updateSupplierSchema,
} from '../validators/orgValidators.js';
import {
  closeShiftSchema,
  createEstimateSchema,
  createExpenseSchema,
  createInvoiceSchema,
  decideEstimateSchema,
  openShiftSchema,
  recordPaymentSchema,
  sendEstimateSchema,
  sendMessageSchema,
  updateEstimateSchema,
  updateExpenseSchema,
  voidInvoiceSchema,
} from '../validators/financeValidators.js';
import {
  createKnowledgeSchema,
  createQualityCheckSchema,
  createWarrantyClaimSchema,
  decideWarrantyClaimSchema,
  submitQualityCheckSchema,
  updateKnowledgeSchema,
} from '../validators/qualityValidators.js';
import {
  activateSubscriptionSchema,
  changePlanSchema,
  createBranchSchema,
  createRenewalRequestSchema,
  updateBranchSchema,
  updateOrganizationSchema,
} from '../validators/orgValidators.js';
import {
  cancelPurchaseOrderSchema,
  createPurchaseOrderSchema,
  receivePurchaseOrderSchema,
  recordSupplierPaymentSchema,
  updatePurchaseOrderSchema,
} from '../validators/purchaseValidators.js';
import { objectIdSchema } from '../validators/common.js';
import platformRouter from './platformRoutes.js';
import marketRouter from './marketRoutes.js';

/* ------------------ مخططات التحقق الخاصة بهذا الملف ------------------ */

const stockMovementValidation = z.object({
  partId: objectIdSchema,
  type: z.enum([
    'purchase_in',
    'sale_out',
    'repair_consume',
    'repair_return',
    'adjustment_in',
    'adjustment_out',
    'defective_out',
    'defective_in',
    'reserve',
    'release',
    'initial',
  ]),
  quantity: z.coerce.number().refine((v) => v !== 0, 'الكمية لا تكون صفرًا'),
  unitCostEgp: z.coerce.number().min(0).optional().default(0),
  supplierId: objectIdSchema.nullable().optional(),
  batchId: objectIdSchema.nullable().optional(),
  batchCode: z.string().trim().max(60).optional().default(''),
  ticketId: objectIdSchema.nullable().optional(),
  reason: z.string().trim().max(300).optional().default(''),
  reference: z.string().trim().max(80).optional().default(''),
});

const posSaleSchema = z.object({
  customerId: objectIdSchema.nullable().optional(),
  customerName: z.string().trim().max(120).optional(),
  customerPhone: z.string().trim().max(20).optional(),
  items: z
    .array(
      z.object({
        partId: objectIdSchema.nullable().optional(),
        description: z.string().trim().min(1).max(200),
        quantity: z.coerce.number().min(1).max(999),
        unitPriceEgp: z.coerce.number().min(0).optional().default(0),
      }),
    )
    .min(1, 'أضف منتجًا واحدًا على الأقل'),
  discountEgp: z.coerce.number().min(0).optional().default(0),
  paymentMethod: z.enum(['cash', 'card', 'wallet', 'instapay', 'bank_transfer', 'credit']),
  amountPaidEgp: z.coerce.number().min(0).optional().default(0),
  notes: z.string().trim().max(500).optional().default(''),
});

/* ------------------------ مسارات القطع والمخزون ------------------------ */
export const partRouter = Router();
partRouter.get('/', requirePermission('part:read'), listParts);
partRouter.get('/low-stock', requirePermission('part:read'), lowStockParts);
partRouter.get('/consumption-report', requirePermission('report:read'), partsConsumptionReport);
partRouter.get('/:id', requirePermission('part:read'), getPart);
partRouter.post('/', requirePermission('part:manage'), validate(createPartSchema), createPart);
partRouter.patch('/:id', requirePermission('part:manage'), validate(updatePartSchema), updatePart);
partRouter.delete('/:id', requirePermission('part:manage'), deletePart);

export const supplierRouter = Router();
supplierRouter.get('/', requirePermission('supplier:read'), listSuppliers);
supplierRouter.get('/performance', requirePermission('report:read'), supplierPerformance);
supplierRouter.post('/', requirePermission('supplier:manage'), validate(createSupplierSchema), createSupplier);
supplierRouter.patch('/:id', requirePermission('supplier:manage'), validate(updateSupplierSchema), updateSupplier);
supplierRouter.delete('/:id', requirePermission('supplier:manage'), deleteSupplier);

export const inventoryRouter = Router();
inventoryRouter.get('/stock', requirePermission('stock:read'), inventoryStock);
inventoryRouter.get('/valuation', requirePermission('report:read'), stockValuation);
inventoryRouter.get('/counts', requirePermission('stock:read'), listStockCounts);
inventoryRouter.get('/counts/:id', requirePermission('stock:read'), getStockCount);
inventoryRouter.post('/counts', requirePermission('stock:move'), validate(stockCountSchema), createStockCount);
inventoryRouter.post('/movements', requirePermission('stock:move'), validate(stockMovementValidation), recordStockMovement);
inventoryRouter.get('/movements', requirePermission('stock:read'), listStockMovements);
inventoryRouter.post('/adjust', requirePermission('stock:move'), validate(stockAdjustSchema), adjustStock);
inventoryRouter.get('/transfers', requirePermission('stock:read'), listStockTransfers);
inventoryRouter.post('/transfers', requirePermission('stock:move'), validate(transferStockSchema), createStockTransfer);
inventoryRouter.post('/transfers/:id/send', requirePermission('stock:move'), sendStockTransfer);
inventoryRouter.post('/transfers/:id/receive', requirePermission('stock:move'), receiveStockTransfer);

/* ------------------------- أوامر الشراء والموردون ------------------------- */
export const purchaseRouter = Router();
purchaseRouter.get('/', requirePermission('purchase:read'), listPurchaseOrders);
purchaseRouter.get('/payables', requirePermission('purchase:read'), payablesReport);
// سداد على الحساب أو على أمر شراء محدد — قبل مسارات /:id حتى لا تُلتقط كمعرّف
purchaseRouter.post('/payments', requirePermission('supplier_payment:record'), validate(recordSupplierPaymentSchema), recordSupplierPayment);
purchaseRouter.get('/:id', requirePermission('purchase:read'), getPurchaseOrder);
purchaseRouter.post('/', requirePermission('purchase:manage'), validate(createPurchaseOrderSchema), createPurchaseOrder);
purchaseRouter.patch('/:id', requirePermission('purchase:manage'), validate(updatePurchaseOrderSchema), updatePurchaseOrder);
purchaseRouter.post('/:id/order', requirePermission('purchase:manage'), orderPurchaseOrder);
purchaseRouter.post('/:id/receive', requirePermission('purchase:receive'), validate(receivePurchaseOrderSchema), receivePurchaseOrder);
purchaseRouter.post('/:id/cancel', requirePermission('purchase:manage'), validate(cancelPurchaseOrderSchema), cancelPurchaseOrder);
purchaseRouter.post('/:id/payments', requirePermission('supplier_payment:record'), validate(recordSupplierPaymentSchema), recordSupplierPayment);

/* ---------------------------- الدراسات ---------------------------- */
export const estimateRouter = Router();
estimateRouter.get('/', requirePermission('estimate:read'), listEstimates);
estimateRouter.post('/', requirePermission('estimate:write'), validate(createEstimateSchema), createEstimate);
estimateRouter.get('/:id', requirePermission('estimate:read'), getEstimate);
estimateRouter.patch('/:id', requirePermission('estimate:write'), validate(updateEstimateSchema), updateEstimate);
estimateRouter.post('/:id/send', requirePermission('estimate:write'), validate(sendEstimateSchema), sendEstimate);
estimateRouter.post('/:id/decide', requirePermission('estimate:approve'), validate(decideEstimateSchema), decideEstimate);

/* -------------------------- الفحص والضمان -------------------------- */
export const qcRouter = Router();
qcRouter.get('/', requirePermission('qc:read'), listQualityChecks);
qcRouter.get('/stats', requirePermission('qc:read'), qualityStats);
qcRouter.post('/', requirePermission('qc:perform'), validate(createQualityCheckSchema), createQualityCheck);
qcRouter.get('/:id', requirePermission('qc:read'), getQualityCheck);
qcRouter.post('/:id/submit', requirePermission('qc:perform'), validate(submitQualityCheckSchema), submitQualityCheck);

export const warrantyRouter = Router();
warrantyRouter.get('/claims', requirePermission('warranty:read'), listWarrantyClaims);
warrantyRouter.post('/claims', requirePermission('warranty:manage'), validate(createWarrantyClaimSchema), createWarrantyClaim);
warrantyRouter.get('/claims/:id', requirePermission('warranty:read'), getWarrantyClaim);
warrantyRouter.post('/claims/:id/decide', requirePermission('warranty:manage'), validate(decideWarrantyClaimSchema), decideWarrantyClaim);
warrantyRouter.get('/intelligence', requirePermission('analytics:read'), warrantyIntelligence);
warrantyRouter.get('/failing-parts', requirePermission('analytics:read'), failingPartsReport);
warrantyRouter.get('/supplier-quality', requirePermission('analytics:read'), supplierQualityReport);

/* ------------------------ الفواتير والمدفوعات ------------------------ */
export const financeRouter = Router();
financeRouter.get('/summary', requirePermission('report:read'), financeSummary);
financeRouter.get('/invoices', requirePermission('invoice:read'), listInvoices);
financeRouter.post('/invoices', requirePermission('invoice:write'), validate(createInvoiceSchema), createInvoice);
financeRouter.get('/invoices/:id', requirePermission('invoice:read'), getInvoice);
financeRouter.get('/invoices/:id/pdf', requirePermission('invoice:read'), downloadInvoicePdf);
financeRouter.post('/invoices/:id/void', requirePermission('invoice:write'), validate(voidInvoiceSchema), voidInvoice);
financeRouter.get('/payments', requirePermission('payment:read'), listPayments);
financeRouter.post('/payments', requirePermission('payment:record'), validate(recordPaymentSchema), recordPayment);
financeRouter.get('/expenses', requirePermission('expense:read'), listExpenses);
financeRouter.post('/expenses', requirePermission('expense:manage'), validate(createExpenseSchema), createExpense);
financeRouter.patch('/expenses/:id', requirePermission('expense:manage'), validate(updateExpenseSchema), updateExpense);
financeRouter.delete('/expenses/:id', requirePermission('expense:manage'), deleteExpense);

// الخزينة والورديات — الوردية المفتوحة تُربط بها كل الحركات النقدية تلقائيًا
financeRouter.get('/shifts', requirePermission('shift:read'), listShifts);
financeRouter.get('/shifts/current', requirePermission('shift:read'), currentShift);
financeRouter.post('/shifts/open', requirePermission('shift:manage'), validate(openShiftSchema), openShift);
financeRouter.get('/shifts/:id', requirePermission('shift:read'), getShift);
financeRouter.post('/shifts/:id/close', requirePermission('shift:manage'), validate(closeShiftSchema), closeShift);

financeRouter.post('/pos/sale', requirePermission('pos:operate'), validate(posSaleSchema), posSale);

// التقارير المالية وكشوف الحسابات
financeRouter.get('/reports/profit-loss', requirePermission('report:read'), profitLossReport);
financeRouter.get('/reports/vat', requirePermission('report:read'), vatReport);
financeRouter.get('/reports/aging', requirePermission('report:read'), receivablesAging);
financeRouter.get('/reports/cashier', requirePermission('report:read'), cashierReport);
financeRouter.get('/customers/:id/statement', requirePermission('payment:read'), customerStatement);
financeRouter.get('/suppliers/:id/statement', requirePermission('purchase:read'), supplierStatement);

/* ----------------------------- التحليلات ----------------------------- */
export const analyticsRouter = Router();
analyticsRouter.get('/dashboard', requirePermission('analytics:read'), dashboard);
analyticsRouter.get('/trends', requirePermission('analytics:read'), trends);
analyticsRouter.get('/status-distribution', requirePermission('analytics:read'), statusDistribution);
analyticsRouter.get('/fault-analysis', requirePermission('analytics:read'), faultAnalysis);
analyticsRouter.get('/turnaround', requirePermission('analytics:read'), turnaroundTimes);
analyticsRouter.get('/pilot-kpis', requirePermission('analytics:read'), pilotKpis);
analyticsRouter.get('/sources', requirePermission('analytics:read'), sourceAnalysis);
analyticsRouter.get('/technicians/performance', requirePermission('analytics:read'), technicianPerformance);
analyticsRouter.get('/branches/performance', requirePermission('analytics:read'), branchPerformance);

/* --------------------------- المؤسسة والفروع --------------------------- */
export const organizationRouter = Router();
organizationRouter.get('/', requirePermission('org:read'), getOrganization);
organizationRouter.patch('/', requirePermission('org:update'), validate(updateOrganizationSchema), updateOrganization);
organizationRouter.get('/subscription/plans', requirePermission('org:read'), listPlanCatalog);
organizationRouter.get('/subscription/payments', requirePermission('org:update'), listSubscriptionPayments);
organizationRouter.get('/subscription/renewal-requests', requirePermission('org:update'), listRenewalRequests);
organizationRouter.post('/subscription/renewal-requests', requirePermission('org:update'), validate(createRenewalRequestSchema), createRenewalRequest);
organizationRouter.post('/subscription/change-plan', requirePermission('org:update'), validate(changePlanSchema), changeSubscriptionPlan);
organizationRouter.post('/subscription/activate', requirePermission('org:update'), validate(activateSubscriptionSchema), activateSubscriptionHandler);
organizationRouter.get('/backup/export', requirePermission('org:update'), exportOrganizationBackup);

export const branchRouter = Router();
branchRouter.get('/', requirePermission('branch:read'), listBranches);
branchRouter.post('/', requirePermission('branch:manage'), validate(createBranchSchema), createBranch);
branchRouter.patch('/:id', requirePermission('branch:manage'), validate(updateBranchSchema), updateBranch);
branchRouter.delete('/:id', requirePermission('branch:manage'), deactivateBranch);

export const technicianRouter = Router();
technicianRouter.get('/', requirePermission('technician:read'), listTechnicians);
technicianRouter.get('/available', requirePermission('technician:read'), availableTechnicians);
technicianRouter.get('/performance', requirePermission('analytics:read'), technicianPerformance);

/* --------------------- الإشعارات والتدقيق والمعرفة --------------------- */
export const notificationRouter = Router();
notificationRouter.get('/', requirePermission('notification:read'), listNotifications);
notificationRouter.post('/read-all', authenticate, markAllNotificationsRead);
notificationRouter.post('/:id/read', requirePermission('notification:read'), markNotificationRead);
notificationRouter.post('/send', requirePermission('notification:send'), validate(sendMessageSchema), sendCustomMessage);

export const auditRouter = Router();
auditRouter.get('/', requirePermission('audit:read'), listAuditLogs);
auditRouter.get('/:resource/:resourceId', requirePermission('audit:read'), auditTrailForResource);

export const knowledgeRouter = Router();
knowledgeRouter.get('/', requirePermission('knowledge:read'), listKnowledge);
knowledgeRouter.get('/suggest', requirePermission('knowledge:read'), knowledgeSuggest);
knowledgeRouter.get('/:id', requirePermission('knowledge:read'), getKnowledge);
knowledgeRouter.post('/', requirePermission('knowledge:write'), validate(createKnowledgeSchema), createKnowledge);
knowledgeRouter.patch('/:id', requirePermission('knowledge:write'), validate(updateKnowledgeSchema), updateKnowledge);
knowledgeRouter.post('/:id/outcome', requirePermission('knowledge:write'), recordKnowledgeOutcome);

/* ------------------------ مسارات التذاكر الفرعية ------------------------ */
export const ticketPartsRouter = Router();
ticketPartsRouter.post('/:id/parts', requirePermission('part:manage'), validate(addRepairPartSchema), addRepairPart);
ticketPartsRouter.patch('/:id/parts/:partId', requirePermission('part:manage'), validate(updateRepairPartSchema), updateRepairPart);
ticketPartsRouter.delete('/:id/parts/:partId', requirePermission('part:manage'), removeRepairPart);
ticketPartsRouter.post('/:id/labor', requirePermission('ticket:update'), validate(addLaborSchema), addLabor);
ticketPartsRouter.delete('/:id/labor/:laborId', requirePermission('ticket:update'), removeLabor);

/* ----------------------- المسارات العامة (بدون تسجيل) ----------------------- */
export const publicRouter = Router();
publicRouter.get('/track/:token', trackRepair);
publicRouter.post('/track/:token/decide', decideByTrackingToken);
publicRouter.get('/track/:token/contact', trackingContact);

/* --------------------------- فهرس جميع --------------------------- */
export function registerRoutes(app: Application): void {
  const api = Router();

  api.use('/auth', authRoutes);
  api.use('/public', publicRouter);

  api.use('/customers', customerRouter);
  api.use('/devices', deviceRouter);
  api.use('/tickets', ticketRouter);
  api.use('/tickets', ticketPartsRouter);
  api.use('/estimates', estimateRouter);
  api.use('/parts', partRouter);
  api.use('/suppliers', supplierRouter);
  api.use('/purchases', purchaseRouter);
  api.use('/inventory', inventoryRouter);
  api.use('/quality-checks', qcRouter);
  api.use('/warranty', warrantyRouter);
  api.use('/finance', financeRouter);
  api.use('/analytics', analyticsRouter);
  api.use('/organizations', organizationRouter);
  api.use('/branches', branchRouter);
  api.use('/technicians', technicianRouter);
  api.use('/notifications', notificationRouter);
  api.use('/audit-logs', auditRouter);
  api.use('/knowledge', knowledgeRouter);
  api.use('/market', marketRouter);
  api.use('/platform', platformRouter);

  // فهرس نقاط النهاية للمطورين
  api.get('/meta/endpoints', (_req, res) => {
    res.json({
      success: true,
      data: {
        version: '1.0.0',
        prefix: env.API_PREFIX,
        groups: [
          { name: 'المصادقة والمستخدمون', base: '/auth' },
          { name: 'العملاء', base: '/customers' },
          { name: 'الأجهزة وجواز الجهاز', base: '/devices' },
          { name: 'تذاكر الصيانة ودورة العمل', base: '/tickets' },
          { name: 'العروض والموافقات', base: '/estimates' },
          { name: 'قطع الغيار', base: '/parts' },
          { name: 'الموردون', base: '/suppliers' },
          { name: 'أوامر الشراء وسداد الموردين', base: '/purchases' },
          { name: 'المخزون والتحويلات والجرد والتقييم', base: '/inventory' },
          { name: 'فحص الجودة', base: '/quality-checks' },
          { name: 'الضمان', base: '/warranty' },
          { name: 'الفواتير والمدفوعات والمصروفات ونقاط البيع', base: '/finance' },
          { name: 'التحليلات ولوحات المعلومات', base: '/analytics' },
          { name: 'المؤسسة', base: '/organizations' },
          { name: 'الفروع', base: '/branches' },
          { name: 'الفنيون', base: '/technicians' },
          { name: 'الإشعارات', base: '/notifications' },
          { name: 'سجل التدقيق', base: '/audit-logs' },
          { name: 'قاعدة المعرفة', base: '/knowledge' },
          { name: 'ماركت بلس وبورصة الأسعار', base: '/market' },
          { name: 'بوابة تتبع العميل (عام)', base: '/public/track/:token' },
          { name: 'إدارة المنصة (مدير المنصة)', base: '/platform' },
        ],
      },
    });
  });

  app.use(env.API_PREFIX, api);
}

/* ملاحظة: مخططات stockMovementValidation وposSaleSchema معرّفة في أعلى الملف
   قبل استخدامها في تعريف المسارات. */
