/**
 * سكربت فحص وإصلاح الفهارس والبيانات المرتبطة بها.
 *
 * يعالج ثلاث مشكلات حقيقية ظهرت في التشغيل الفعلي:
 *
 * 1) **قيم فاضية/null داخل فهرس فريد sparse**
 *    الفهرس `{organizationId, email}` فريد وsparse. كلمة `sparse` في MongoDB تعني
 *    أنه يتجاهل المستندات التي **لا تحتوي الحقل** فقط — أما `''` أو `null` فيُفهرس
 *    ويُحسب تكرارًا. لذلك كان يُسمح بمستخدم واحد فقط بلا بريد لكل مركز (E11000).
 *    الإصلاح: تحويل `''` و`null` إلى «مفقود» عبر `$unset`، وإعادة بناء الفهرس.
 *
 * 2) **فهرس فريد على حقل اختياري**
 *    الفهرس الفريد `{organizationId, email}` يمنع أكثر من مستخدم بلا بريد في نفس
 *    المركز. نحوّله إلى فهرس **جزئي (partial)** بقاعدة `email: { $type: 'string' }`،
 *    وهي الطريقة الصحيحة في MongoDB لتقييد التفرد على المستندات التي تحتوي قيمة
 *    فعلية (أدق من sparse لأنها تستثني null و'' أيضًا).
 *
 * 3) **فهارس قديمة من إصدارات سابقة** تُقارن بأسماء المخطط وتُحذف.
 *
 * التشغيل:
 *   node dist/scripts/fix-indexes.js          # إصلاح فعلي
 *   node dist/scripts/fix-indexes.js --dry    # معاينة فقط بلا تعديل
 */
import { model, modelNames } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { registerAllModels } from '../models/register.js';
import { logger } from '../config/logger.js';
import { runAsSystem } from '../context/tenantContext.js';

const DRY_RUN = process.argv.includes('--dry');

/**
 * حقول اختيارية: القيم الفاضية/null فيها يجب أن تصبح «مفقودة».
 * كل عنصر: اسم الموديل → قائمة الحقول.
 */
const OPTIONAL_FIELDS: Record<string, string[]> = {
  User: ['email'],
};

/**
 * فهارس يجب تحويلها إلى **جزئية** لأن الحقل فيها اختياري.
 * المفتاح: `collection.indexName` — والقيمة: شرط partialFilterExpression.
 */
const PARTIAL_INDEXES: { collection: string; indexName: string; partialFilterExpression: Record<string, unknown> }[] = [
  {
    collection: 'users',
    indexName: 'organizationId_1_email_1',
    partialFilterExpression: { email: { $type: 'string' } },
  },
];

/** أسماء الفهارس التي يعرفها المخطط لكل موديل */
function schemaIndexNames(modelName: string): Set<string> {
  const names = new Set<string>();
  for (const [fields] of model(modelName).schema.indexes()) {
    const parts = Object.entries(fields)
      .map(([key, direction]) => `${key}_${typeof direction === 'number' ? direction : 1}`)
      .sort();
    names.add(parts.join('_'));
  }
  return names;
}

async function main(): Promise<void> {
  registerAllModels();
  await connectDatabase();

  logger.info(DRY_RUN ? 'وضع المعاينة (--dry): لن يُعدَّل شيء' : 'بدء فحص وإصلاح الفهارس');

  /* ---------- 1) تحويل القيم الفاضية/null إلى مفقودة ---------- */
  for (const [modelName, fields] of Object.entries(OPTIONAL_FIELDS)) {
    const target = model(modelName);
    for (const field of fields) {
      /**
       * ملاحظة مهمة: لا نستخدم `{ [field]: null }` كفلتر لأن MongoDB تطابق به
       * القيم null **والمفقودة معًا**، فيظهر عدد كبير كأنه يحتاج إصلاحًا وهو سليم،
       * ويصبح `modified: 0` بلا سبب مفهوم. الشرط الدقيق هو الوجود بقيمة فارغة/null.
       */
      const filter = { [field]: { $exists: true, $in: ['', null] } };
      const count = await target.collection.countDocuments(filter);
      if (!count) {
        logger.info({ model: modelName, field, count: 0 }, 'لا قيم فاضية تحتاج تنظيفًا');
        continue;
      }
      if (DRY_RUN) {
        logger.warn({ model: modelName, field, count }, 'سيتم تحويل القيم الفاضية/null إلى مفقودة');
        continue;
      }
      const result = await target.collection.updateMany(filter, { $unset: { [field]: '' } });
      logger.warn(
        { model: modelName, field, matched: result.matchedCount, modified: result.modifiedCount },
        'تم تحويل القيم الفاضية/null إلى مفقودة',
      );
    }
  }

  /* ---------- 2) تحويل الفهارس الفريدة على حقول اختيارية إلى جزئية ---------- */
  for (const spec of PARTIAL_INDEXES) {
    const target = modelNames().find((name) => model(name).collection.collectionName === spec.collection);
    if (!target) {
      logger.warn({ collection: spec.collection }, 'لم أجد الموديل المرتبط بالمجموعة');
      continue;
    }
    const collection = model(target).collection;
    const indexes = await collection.indexes();
    const current = indexes.find((index) => index.name === spec.indexName);

    if (!current) {
      logger.info({ collection: spec.collection, index: spec.indexName }, 'الفهرس غير موجود — لا حاجة للتحويل');
      continue;
    }

    const alreadyPartial = Boolean(current.partialFilterExpression);
    if (alreadyPartial) {
      logger.info({ collection: spec.collection, index: spec.indexName }, 'الفهرس جزئي بالفعل');
      continue;
    }

    if (DRY_RUN) {
      logger.warn(
        { collection: spec.collection, index: spec.indexName, partialFilterExpression: spec.partialFilterExpression },
        'سيتم تحويل الفهرس إلى جزئي',
      );
      continue;
    }

    try {
      await runAsSystem(async () => {
        await collection.dropIndex(spec.indexName);
        await collection.createIndex(current.key, {
          name: spec.indexName,
          unique: true,
          partialFilterExpression: spec.partialFilterExpression,
        });
      });
      logger.warn(
        { collection: spec.collection, index: spec.indexName, partialFilterExpression: spec.partialFilterExpression },
        'تم تحويل الفهرس إلى جزئي (التفرد على القيم الموجودة فقط)',
      );
    } catch (error) {
      logger.error({ collection: spec.collection, index: spec.indexName, err: error }, 'تعذر تحويل الفهرس');
    }
  }

  /* ---------- 3) حذف الفهارس غير المعرّفة في المخطط ---------- */
  const unknownIndexes: { model: string; collection: string; index: string }[] = [];
  let dropped = 0;

  for (const modelName of modelNames()) {
    const target = model(modelName);
    const actual = await target.collection.indexes();
    const expectedNormalized = new Set([...schemaIndexNames(modelName)].map((name) => name.split('_').sort().join('_')));

    for (const index of actual) {
      const indexName = index.name ?? '(بلا اسم)';
      if (indexName === '_id_') continue;
      if ('_fts' in (index.key as Record<string, unknown>)) continue;

      const normalized = indexName.split('_').sort().join('_');
      if (expectedNormalized.has(normalized)) continue;

      unknownIndexes.push({ model: modelName, collection: target.collection.collectionName, index: indexName });
      if (DRY_RUN) continue;

      try {
        await runAsSystem(async () => {
          await target.collection.dropIndex(indexName);
        });
        dropped += 1;
        logger.warn({ model: modelName, index: indexName }, 'حُذف فهرس غير معرّف في المخطط');
      } catch (error) {
        logger.error({ model: modelName, index: indexName, err: error }, 'تعذر حذف الفهرس');
      }
    }
  }

  logger.info(
    { unknownCount: unknownIndexes.length, dropped, unknown: unknownIndexes.slice(0, 40) },
    DRY_RUN ? 'تقرير الفهارس (معاينة — لم يُحذف شيء)' : 'انتهى فحص الفهارس',
  );

  await disconnectDatabase();
}

main().catch(async (error) => {
  logger.error({ err: error }, 'فشل سكربت الفهارس');
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
