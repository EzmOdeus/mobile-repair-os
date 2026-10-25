import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { logger } from '../config/logger.js';
import { runAsSystem } from '../context/tenantContext.js';
import { registerAllModels } from '../models/register.js';
import { OrganizationModel } from '../models/Organization.js';
import { UserModel } from '../models/User.js';

/**
 * تهيئة أول مدير منصة على قاعدة إنتاج فارغة دون تشغيل seed التجريبي.
 *
 * seed ينشئ مركزًا تجريبيًا ببيانات وكلمات مرور معروفة، وهو غير مناسب للإنتاج.
 * هذا السكربت idempotent: ينشئ مؤسسة platform-hq الداخلية إن لزم، ثم ينشئ/يحدّث
 * حساب platform من متغيرات البيئة. تشغيله مرة أخرى يعيد ضبط كلمة المرور عمدًا.
 *
 * الاستخدام (من جهازك مع متغيرات الإنتاج):
 *   PLATFORM_ADMIN_PASSWORD='...' npm run bootstrap:platform
 */

const HQ_SLUG = 'platform-hq';
const DEFAULT_USERNAME = 'platform.admin';

async function main(): Promise<void> {
  const password = process.env.PLATFORM_ADMIN_PASSWORD ?? '';
  if (password.length < 12) {
    logger.error('PLATFORM_ADMIN_PASSWORD مطلوب بطول 12 حرفًا على الأقل');
    process.exit(1);
  }

  const username = (process.env.PLATFORM_ADMIN_USERNAME || DEFAULT_USERNAME).trim().toLowerCase();
  const fullName = process.env.PLATFORM_ADMIN_FULL_NAME?.trim() || 'مدير المنصة';

  registerAllModels();
  await connectDatabase();

  const result = await runAsSystem(async () => {
    let hq = await OrganizationModel.findOne({ slug: HQ_SLUG });
    if (!hq) {
      hq = await OrganizationModel.create({
        name: 'إدارة المنصة (داخلي)',
        nameEn: 'Platform HQ',
        slug: HQ_SLUG,
        isActive: true,
        onboardedAt: new Date(),
        subscription: { plan: 'enterprise', status: 'active' },
      });
    } else if (!hq.isActive || hq.subscription?.status !== 'active' || hq.subscription?.plan !== 'enterprise') {
      hq.isActive = true;
      hq.subscription = {
        ...hq.subscription,
        plan: 'enterprise',
        status: 'active',
        expiresAt: null,
        graceEndsAt: null,
      };
      await hq.save();
    }

    const existing = await UserModel.findOne({ organizationId: hq._id, username });
    const created = !existing;
    const user = existing ?? new UserModel({
      organizationId: hq._id,
      fullName,
      username,
      role: 'platform',
      isActive: true,
    });

    user.fullName = fullName;
    user.role = 'platform';
    user.isActive = true;
    await user.setPassword(password);
    await user.save();

    return { created, organizationId: String(hq._id), userId: String(user._id) };
  });

  logger.info(
    { username, organizationId: result.organizationId, created: result.created },
    result.created ? 'تم إنشاء مدير المنصة' : 'تم تحديث مدير المنصة',
  );

  await disconnectDatabase();
  process.exit(0);
}

main().catch(async (err) => {
  logger.error({ err }, 'فشل تهيئة مدير المنصة');
  await disconnectDatabase().catch(() => void 0);
  process.exit(1);
});
