/**
 * مزامنة عدّادات الترقيم مع الأرقام الفعلية في قاعدة البيانات.
 *
 * **المشكلة التي يعالجها:** زرع البيانات أو استعادة نسخة احتياطية تُدخل مستندات
 * بأرقام جاهزة (مثل `EST-2610-000060`) بلا المرور بخدمة الترقيم، فيبقى العدّاد
 * `counterSeq` متأخرًا أو فارغًا. النتيجة: أول عرض سعر/فاتورة/إيصال/تذكرة حقيقي
 * يبدأ من 1 ويصطدم برقم موجود ⇒ E11000 ⇒ 409 على عملية سليمة تمامًا.
 *
 * (خدمة الترقيم تعالج التصادمات العابرة بإعادة المحاولة، لكن مزامنة العدّادات
 * تُزيل سببها من الجذر وتُبقي الأرقام متسلسلة بلا فجوات.)
 *
 * التشغيل:
 *   node dist/scripts/fix-counters.js          # مزامنة فعلية
 *   node dist/scripts/fix-counters.js --dry    # معاينة فقط بلا كتابة
 */
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { logger } from '../config/logger.js';
import { BranchModel } from '../models/Branch.js';
import { runAsSystem } from '../context/tenantContext.js';
import { syncNumberCounters } from '../services/numberingService.js';

const DRY_RUN = process.argv.includes('--dry');

async function main(): Promise<void> {
  await connectDatabase();

  logger.info(DRY_RUN ? 'وضع المعاينة (--dry): لن يُعدَّل شيء' : 'بدء مزامنة عدّادات الترقيم');

  const before = await runAsSystem(async () => {
    const branches = await BranchModel.find({}).select('counterSeq organizationId').lean();
    const byOrg: Record<string, Record<string, number>> = {};
    for (const branch of branches) {
      const orgId = String(branch.organizationId ?? '');
      if (!orgId) continue;
      const counters = (byOrg[orgId] ??= {});
      for (const [key, seq] of Object.entries((branch.counterSeq ?? {}) as Record<string, number>)) {
        if (typeof seq !== 'number') continue;
        counters[key] = Math.max(counters[key] ?? 0, seq);
      }
    }
    return byOrg;
  });

  const after = await syncNumberCounters({ apply: !DRY_RUN });

  logger.info(
    { before, after, dryRun: DRY_RUN },
    DRY_RUN ? 'العدّادات المستهدفة (معاينة — لم تُكتب)' : 'تمت مزامنة العدّادات على فروع كل مؤسسة',
  );

  await disconnectDatabase();
}

main().catch(async (error) => {
  logger.error({ err: error }, 'فشل سكربت مزامنة العدّادات');
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
