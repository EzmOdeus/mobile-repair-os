# المعمارية وقرارات التصميم

## 1. لماذا MongoDB + Express بدل Supabase

الدراسة الأصلية اقترحت `Supabase (PostgreSQL + Auth + Storage + Realtime)` مع `Next.js`. هذا التنفيذ يحقق نفس المتطلبات الوظيفية بمنظومة **MongoDB + Express**، مع بديل مكافئ لكل خدمة:

| خدمة Supabase | البديل في هذا التنفيذ | كيف تحقق المتطلب |
|---|---|---|
| PostgreSQL | MongoDB 7 + Mongoose 8 | مرونة في مخطط الأجهزة والتذاكر ذي البنية المتغيرة (موديلات متعددة، فحوص مختلفة لكل فئة) |
| Supabase Auth | JWT (Access 15 دقيقة + Refresh 30 يوم) + bcrypt | تسجيل دخول، تجديد جلسة، قفل الحساب بعد محاولات خاطئة |
| Supabase RLS | `tenantPlugin` + `TenantContext` (AsyncLocalStorage) | فرض `organizationId` على مستوى **كل استعلام** لا على الواجهة فقط |
| Supabase Storage | تخزين محلي معزول لكل مؤسسة | المجلد `<orgId>/<kind>/<yyyy>/<mm>/…` + صلاحيات وسائط |
| Supabase Realtime | Polling بـSWR في الواجهة | تحديث تلقائي كل 30–60 ثانية للألواح الحرجة |
| Postgres Views/Triggers | خدمات تطبيقية (`workflowService`, `inventoryService`) | قواعد العمل منطق مُختبَر بدل triggers متفرقة |

### لماذا كان MongoDB مناسبًا هنا

- **بنية الجهاز والتذكرة غير ثابتة:** كل موديل له فحوص مختلفة، والقطع المتوافقة قوائم مفتوحة. الـdocument model يقلل الجداول الوسيطة.
- **Timeline وAudit كسجلات append-only:** كتابة عالية بدون تحديثات، وهو ما يناسب MongoDB.
- **التقارير التحليلية:** Aggregation Pipeline غني، وقد استُخدم فعليًا في Warranty/Parts Intelligence.
- **مرونة MVP:** إضافة حقول جديدة (مثل تصنيف عطل جديد) لا تحتاج ترحيل قاعدة بيانات.

### الفروق التي تحتاج انتباهًا

| الجانب | PostgreSQL (الخطة الأصلية) | MongoDB (التنفيذ الحالي) | التعويض المُطبَّق |
|---|---|---|---|
| العلاقات | Foreign Keys تفرضها القاعدة | لا FK — التحقق في طبقة الخدمة | تحقق صريح قبل الإنشاء (مثال: الجهاز يجب أن يتبع العميل، القطعة موجودة، الفني نشط) |
| المعاملات المتعددة | ACID كامل | يتطلب Session/Transaction | `$inc` ذرّي للمخزون مع منع الرصيد السالب + تسلسل ترقيم ذرّي لكل فرع |
| عزل الصفوف | RLS في القاعدة | plugin على مستوى الاستعلام | `tenantPlugin` يرفض أي استعلام بلا نطاق أو بنطاق متعارض |
| القيود الفريدة | UNIQUE معقدة | فهارس فريدة مركّبة | فهارس `{organizationId, field}` على كل ما يجب أن يكون فريدًا داخل المركز |
| التقارير المالية | SQL مباشر | Aggregation Pipeline | تجميعات مُختبَرة في `analyticsController` و`financeController` |

---

## 2. عزل المستأجرين (Tenant Isolation) — بديل RLS

### المبدأ

لا يمكن الاعتماد على الواجهة لإخفاء البيانات. العزل مفروض في **طبقة الوصول للبيانات**.

```
طلب مصادق عليه
   → authenticate middleware
      → enterTenantContext({ organizationId, branchId, actor })
         → كل استعلام Mongoose
            → tenantPlugin يضيف organizationId تلقائيًا
               → أي تعارض = TENANT_MISMATCH (403)
```

### التنفيذ

`apps/api/src/models/plugins/tenantPlugin.ts` يُسجَّل على **كل** موديل (27 موديل). يضيف:

1. **حقلين إلزاميين:** `organizationId` (غير قابل للتعديل) و`branchId`.
2. **pre-hooks على 11 نوع استعلام:** `find`, `findOne`, `countDocuments`, `updateOne/Many`, `deleteOne/Many`, `distinct`… تضيف `organizationId` من السياق.
3. **Hook على `aggregate`:** يضيف `$match` أول إذا لم يكن مُقيَّدًا.
4. **Hook على `save`/`validate`:** يمنع كتابة مستند بمؤسسة مختلفة عن السياق.

### الحالات الأربع

| الحالة | السلوك |
|---|---|
| سياق مؤسسة موجود | يُضاف `organizationId` تلقائيًا، وأي تعارض يُرفض |
| مرشّح يحمل `organizationId` صريحًا | يُقبل كما هو (المرشّح نفسه هو القيد) — يُستخدم في بوابة العميل |
| `runAsSystem()` | بلا مرشّح — للـseed والترحيل فقط |
| لا سياق ولا مرشّح ولا علم نظام | **رفض 403** |

### درس مهم اكتُشف أثناء الاختبار

Mongoose Queries **كسولة (lazy)**: تنفيذها يحدث في microtask بعد `storage.run`. لذلك:

- `runAsSystem(() => Model.find(...))` **لا يعمل** — السياق ينتهي قبل التنفيذ.
- الحل: المساعد يلفّ الدالة في `async () => await fn()` داخل `storage.run` فيبقى السياق حيًّا.
- في الـmiddleware نستخدم `enterWith` (متزامن) حتى يستمر السياق عبر بقية الطلب.
- `populate` **لا يحمل مرشّح المؤسسة** في استعلاماته الداخلية، فيرفضه العزل. لذلك كل الكيانات المرتبطة تُقرأ باستعلامات صريحة النطاق (`{ _id, organizationId }`) ثم تُربط في الذاكرة.

---

## 3. دورة عمل الصيانة (Workflow Engine)

17 حالة وانتقالات مقيّدة في `apps/api/src/constants/repair.ts`:

```
Received → Intake → Inspection → Diagnosis → Estimate → Waiting Approval → Approved
→ Waiting Part → Repairing → Testing/QC → Ready → Customer Notified → Paid → Delivered → Warranty
```

مع مسارات جانبية: `Cancelled`, `Unrepairable`.

### ضمانات مُختبَرة (70/70 اختبار E2E)

| القاعدة | أين تُفرض | الاختبار |
|---|---|---|
| الانتقالات تُتبع خريطة صريحة | `canTransition()` | رفض `received → delivered` |
| لا إصلاح قبل موافقة العميل على عرض السعر | `assertApprovalSatisfied` | رفض `waiting_approval → approved` بدون عرض معتمد |
| لا تجهيز للتسليم قبل اجتياز فحص الجودة | `assertQcSatisfied` | رفض `testing_qc → ready` بدون QC ناجح |
| لا تسليم قبل سداد المستحق | `assertPaymentSatisfied` | رفض `→ delivered` مع فاتورة غير مسددة |
| كل انتقال يُسجَّل في Chain of Custody | `recordTimelineEvent` | 8+ أحداث مسجلة لكل دورة كاملة |
| البنود الإلزامية في الفحص لا تُترك معلّقة | `submitQualityCheck` | رفض الفحص مع بنود إلزامية `pending` |
| منع الرصيد السالب في المخزون | `applyStockMovement` | رفض صرف 99999 من قطعة رصيدها أقل |
| منع تجاوز الحمل الأقصى للفني | `assignTechnician` | فحص `maxActiveJobs` |
| الخدمة لا تُسلَّم بدون كامل السداد | `recordPayment` + transition | انتقال تلقائي إلى `paid` بعد السداد الكامل |

### الـSLA

- موعد مستحق حسب الأولوية: عاجلة 6 ساعات، مرتفعة 24، عادية 72، منخفضة 120.
- **إيقاف العدّاد** عند `waiting_approval` و`waiting_part` (لا نحاسب المركز على انتظار العميل أو المورد).
- تسجيل تجاوز الموعد تلقائيًا.

---

## 4. نموذج البيانات (27 مجموعة)

```
المؤسسة والوصول
  organizations ─ branches ─ users
                                        └ (RBAC: 7 أدوار × 54 صلاحية)

العميل والجهاز
  customers ─ devices ─ storedfiles
              └ passport (تاريخ تراكمي: إصلاحات، مصروف، علامات خطر)

دورة الصيانة
  repairtickets ─┬─ repairstatushistories   (Timeline / Chain of Custody)
                 ├─ repairnotes
                 ├─ repairparts ─┬─ parts ─┬─ stockbatches ─ suppliers
                 │               │         └─ inventoryitems (رصيد كل فرع)
                 │               └────────── stockmovements (سجل غير قابل للتعديل)
                 ├─ repairlabors
                 ├─ estimates ─ approvals
                 ├─ qualitychecks
                 ├─ invoices ─ payments
                 └─ warrantyclaims (مرتبطة بالتذكرة الأصلية والقطعة والفني)

المال والتشغيل
  expenses · notifications · auditlogs · knowledgearticles · stocktransfers
```

### قرارات تصميم مهمة

| القرار | السبب |
|---|---|
| فصل `parts` (كتالوج) عن `inventoryitems` (رصيد فرع) | القطعة الواحدة لها أرصدة مختلفة لكل فرع |
| `stockmovements` append-only مع `balanceAfter` | تدقيق كامل لدقة المخزون وكشف التلاعب |
| `stockbatches` مربوطة بالتوريد | أساس Parts Quality Intelligence: معدل الفشل حسب المورد والدفعة |
| `repairparts` تحمل `supplierId` و`batchId` و`warrantyExpiresAt` | يجعل تتبع الضمان إلى القطعة والمورد ممكنًا فعليًا |
| `repairstatushistories` بدون `updatedAt` | سجل لا يُعدَّل — أساس Chain of Custody |
| `auditlogs` مع `changes[]` وحقول مُستبعَدة | تدقيق قابل للمراجعة مع حماية البيانات الحساسة |
| `estimate.version` بدل تعديل العرض | الموافقة مرتبطة بإصدار بعينه — دليل عند النزاع |
| `trackingToken` (24 بايت) بدل رقم التذكرة | بوابة العميل بلا تسجيل دخول ولا تخمين |

---

## 5. الأمان والخصوصية

| الطبقة | الإجراء |
|---|---|
| النقل | CORS مُقيَّد بقائمة أصول، Helmet، ضغط |
| المصادقة | JWT منفصلان (Access/Refresh)، bcrypt 12 دورة، `select: false` لكلمة المرور |
| الصلاحيات | 54 صلاحية تُفحص على المسار + دعم صلاحيات إضافية/محجوبة لكل مستخدم |
| عزل البيانات | `tenantPlugin` على كل الموديلات |
| سجل التدقيق | تلقائي لكل كتابة + تدقيق على المورد مع IP و requestId |
| تحديد المعدل | 600/15د عام، 30/15د على المصادقة |
| قفل الحساب | 8 محاولات خاطئة ← 15 دقيقة |
| ملفات | تحقق MIME وسعة، عزل مسار لكل مؤسسة، تقديم بعد مصادقة فقط |
| IMEI | يُخزَّن كاملًا داخليًا، مُقنَّع في كل عرض عام |
| بيانات حساسة | لا تُخزَّن كلمة مرور/نمط قفل الجهاز — إشارة `hasLockCode` فقط |
| بوابة العميل | اسم مقنّع، هاتف مقنّع، IMEI مقنّع، لا ملاحظات داخلية، لا بيانات مستخدمين |

---

## 6. الأداء

| التحسين | التفاصيل |
|---|---|
| فهارس مركّبة | `{organizationId, status, priority, createdAt}` على التذاكر، مماثلة على كل المجموعات |
| فهارس نصية | بحث في العملاء والأجهزة والقطع والمعرفة |
| `$inc` ذرّي | تحديث أرصدة المخزون بدون read-modify-write |
| Pagination | كل القوائم محدودة (30–50 افتراضيًا، 200 كحد أقصى) |
| Aggregation | التقارير تُجمَّع في القاعدة لا في الذاكرة |
| تخفيف populate | قراءة المرتبطات باستعلامات مُجمَّعة (find with $in) بدل N+1 |
| SWR caching | الواجهة تُخزّن وتُحدّث تلقائيًا فقط الألواح الحرجة |
