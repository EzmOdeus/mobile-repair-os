import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { requirePermission } from '../middleware/auth.js';
import {
  activateOrgSubscription,
  changeOrgPlan,
  getOrganizationDetail,
  listOrganizations,
  platformApproveRenewalRequest,
  platformListRenewalRequests,
  platformPlanCatalog,
  platformRejectRenewalRequest,
  platformRevenue,
  platformStats,
  setOrganizationActive,
} from '../controllers/platformController.js';
import {
  approveRenewalRequestSchema,
  platformActivateSubscriptionSchema,
  platformChangePlanSchema,
  rejectRenewalRequestSchema,
} from '../validators/orgValidators.js';
import {
  downloadBackup,
  listBackups,
  restoreBackupFromFile,
  runBackupNow,
} from '../controllers/backupController.js';
import {
  platformApproveMarketListing,
  platformListMarketListings,
  platformMarketStats,
  platformRejectMarketListing,
} from '../controllers/platformMarketController.js';
import {
  deactivatePriceGuide,
  platformListPriceGuides,
  updatePriceGuide,
  upsertPriceGuide,
} from '../controllers/marketPriceController.js';
import { priceGuideSchema, rejectMarketListingSchema, updatePriceGuideSchema } from '../validators/marketValidators.js';
import { z } from 'zod';

/**
 * مسارات إدارة المنصة (مدير المنصة فقط).
 *
 * هذه المسارات تعبر حدود المستأجر عمدًا: دور `platform` لا يتبع مركزًا،
 * والصلاحيات platform:* لا تُمنح لأي دور داخل مركز (انظر constants/roles.ts).
 * الحماية مزدوجة: requirePermission على كل مسار + subscriptionWriteGuard
 * يستثني المسارات تحت /platform صراحةً.
 */
const platformRouter = Router();

const setOrgActiveSchema = z.object({
  isActive: z.boolean(),
});

platformRouter.get('/organizations', requirePermission('platform:orgs:read'), listOrganizations);
platformRouter.get('/stats', requirePermission('platform:stats:read'), platformStats);
platformRouter.get('/plans', requirePermission('platform:orgs:read'), platformPlanCatalog);
platformRouter.get('/revenue', requirePermission('platform:stats:read'), platformRevenue);
platformRouter.get('/renewal-requests', requirePermission('platform:orgs:read'), platformListRenewalRequests);
platformRouter.post(
  '/renewal-requests/:id/approve',
  requirePermission('platform:orgs:manage'),
  validate(approveRenewalRequestSchema),
  platformApproveRenewalRequest,
);
platformRouter.post(
  '/renewal-requests/:id/reject',
  requirePermission('platform:orgs:manage'),
  validate(rejectRenewalRequestSchema),
  platformRejectRenewalRequest,
);
platformRouter.get('/organizations/:id', requirePermission('platform:orgs:read'), getOrganizationDetail);
platformRouter.patch(
  '/organizations/:id/status',
  requirePermission('platform:orgs:manage'),
  validate(setOrgActiveSchema),
  setOrganizationActive,
);
platformRouter.post(
  '/organizations/:id/subscription/activate',
  requirePermission('platform:orgs:manage'),
  validate(platformActivateSubscriptionSchema),
  activateOrgSubscription,
);
platformRouter.post(
  '/organizations/:id/subscription/change-plan',
  requirePermission('platform:orgs:manage'),
  validate(platformChangePlanSchema),
  changeOrgPlan,
);

/* إدارة النسخ الاحتياطية: قائمة/تشغيل فوري/تنزيل/استعادة من ملف محلي */
platformRouter.get('/backups', requirePermission('platform:orgs:manage'), listBackups);
platformRouter.post('/backups/run', requirePermission('platform:orgs:manage'), runBackupNow);
platformRouter.get('/backups/:file/download', requirePermission('platform:orgs:manage'), downloadBackup);
platformRouter.post('/backups/:file/restore', requirePermission('platform:orgs:manage'), restoreBackupFromFile);

/* مراجعة إعلانات ماركت بلس */
platformRouter.get('/market/stats', requirePermission('market:moderate'), platformMarketStats);
platformRouter.get('/market/listings', requirePermission('market:moderate'), platformListMarketListings);
platformRouter.post(
  '/market/listings/:id/approve',
  requirePermission('market:moderate'),
  platformApproveMarketListing,
);
platformRouter.post(
  '/market/listings/:id/reject',
  requirePermission('market:moderate'),
  validate(rejectMarketListingSchema),
  platformRejectMarketListing,
);

/* دليل أسعار بورصة التليفونات */
platformRouter.get('/market/prices', requirePermission('market:prices:manage'), platformListPriceGuides);
platformRouter.post(
  '/market/prices',
  requirePermission('market:prices:manage'),
  validate(priceGuideSchema),
  upsertPriceGuide,
);
platformRouter.patch(
  '/market/prices/:id',
  requirePermission('market:prices:manage'),
  validate(updatePriceGuideSchema),
  updatePriceGuide,
);
platformRouter.delete(
  '/market/prices/:id',
  requirePermission('market:prices:manage'),
  deactivatePriceGuide,
);

export default platformRouter;
