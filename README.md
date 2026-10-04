# Mobile Repair OS Egypt

منصة تشغيل متخصصة لمراكز ومحلات صيانة الهواتف في مصر — تربط دورة حياة الجهاز كاملة من لحظة الاستلام حتى التسليم والضمان.

> **تنفيذ بديل للدراسة الأصلية:** الدراسة اقترحت `Supabase + PostgreSQL`. هذا التنفيذ يستخدم **MongoDB + Express** كطبقة خلفية بديلة، مع الحفاظ على كل المتطلبات الوظيفية: عزل بيانات المستأجرين، الصلاحيات بالأدوار، سجل التدقيق، ودورة عمل الصيانة الكاملة. تفاصيل قرار الاستبدال في [docs/architecture.md](docs/architecture.md).

---

## نظرة سريعة

| الطبقة | التقنية |
|---|---|
| الواجهة الخلفية | Express 5 + TypeScript (ESM) |
| قاعدة البيانات | MongoDB 7 + Mongoose 8 |
| المصادقة | JWT (Access + Refresh) + RBAC مخصص |
| عزل البيانات | Tenant Context عبر `AsyncLocalStorage` + Mongoose plugin |
| تخزين الملفات | تخزين محلي على القرص (بديل Supabase Storage) |
| الواجهة الأمامية | Next.js 15 (App Router) + React 18 + Tailwind CSS |
| اللغة | عربي RTL كامل + EGP + توقيت القاهرة |
| الإشعارات | WhatsApp/SMS عبر طبقة قوالب (وضع `log` افتراضيًا للتطوير) |
| الرسوم البيانية | Recharts |

---

## التشغيل السريع

### المتطلبات

- Node.js **20.9+**
- **npm 10+** (يأتي مع Node.js)
- MongoDB **6+** يعمل محليًا (الافتراضي: `mongodb://127.0.0.1:27017`)

> المشروع يستخدم **npm workspaces** — كل الحزم تُثبَّت من الجذر بأمر واحد.

### 1) التثبيت

```bash
cd mobile-repair-os
npm install
```

يفتح npm ملف `.npmrc` الموجود في المشروع تلقائيًا، وفيه `cache=.npm-cache` (cache داخل المشروع) حتى يعمل التثبيت في البيئات المقيَّدة التي تمنع الكتابة في مجلد الـcache العام.

> **لو فشل التثبيت بخطأ `spawn EPERM` أثناء `postinstall`:** استخدم `npm install --ignore-scripts`. هذا يحدث في البيئات المقيَّدة التي تمنع تشغيل عمليات فرعية. المشروع يعمل بالكامل بهذه الطريقة لأن كل الأدوات الحرجة (TypeScript، Next.js مع SWC، esbuild) تُشحن كحزم ثنائية جاهزة تُثبَّتها npm تلقائيًا.

### 2) تهيئة البيئة

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

عدّل `apps/api/.env` إذا احتجت — أهم المتغيرات:

```env
MONGODB_URI=mongodb://127.0.0.1:27017/mobile_repair_os
JWT_ACCESS_SECRET=...        # 32 حرفًا على الأقل
JWT_REFRESH_SECRET=...       # 32 حرفًا على الأقل
PORT=4000
CORS_ORIGINS=http://localhost:3000
```

### 3) توليد بيانات تجريبية واقعية

```bash
npm run seed          # إنشاء البيانات لأول مرة
npm run seed:reset    # حذف كل شيء وإعادة البناء من الصفر
```

الـseed ينشئ: مركزًا بثلاثة فروع، 9 مستخدمين، 6 موردين، 25 قطعة، 46 عميلًا، 72 جهازًا، **84 تذكرة صيانة** بتواريخ حقيقية موزّعة على آخر 7 أشهر، مع سلسلة أحداث كاملة، عروض أسعار وموافقات، قطع مستخدمة، فحوص جودة، فواتير ومدفوعات، مصروفات، 9 claims ضمان، إشعارات، و120 سجل تدقيق، و4 مقالات في قاعدة المعرفة.

### 4) التشغيل

```bash
npm run dev            # الـAPI والواجهة معًا
# أو بشكل منفصل:
npm run dev:api        # http://localhost:4000
npm run dev:web        # http://localhost:3000
```

### توثيق الـAPI

بعد تشغيل الـAPI، افتح Swagger UI على `http://localhost:4000/docs` لاستعراض وتجربة نقاط النهاية. ملف OpenAPI بصيغة YAML موجود في [docs/openapi.yaml](docs/openapi.yaml)، والمرجع العربي التفصيلي في [docs/api.md](docs/api.md). استخدم زر **Authorize** في Swagger لإدخال access token بصيغة Bearer.

### 5) الدخول

**حسابك الخاص:** افتح `http://localhost:3000/register` أو اضغط «إنشاء حساب مركز جديد» من صفحة الدخول.
أي مدير مركز يقدر ينشئ حسابه بنفسه في خطوتين — بيانات المركز ثم حساب المالك — وبعدها يدخل مباشرة إلى لوحة التحكم كمالك بكل الصلاحيات، ومن صفحة الإعدادات يضيف باقي الموظفين والفنيين.

الباقة الافتراضية عند التسجيل الذاتي: **starter / تجريبية** — حتى 5 مستخدمين، فرعين، و300 تذكرة شهريًا، بدون بطاقة بنكية.

**أو استخدم الحسابات التجريبية** (بعد `npm run seed`):

| الدور | اسم المستخدم | كلمة المرور |
|---|---|---|
| مالك المركز | `owner` | `Owner@1234` |
| مدير فرع | `manager` | `Manager@1234` |
| استقبال | `reception` | `Reception@1234` |
| محاسب | `accountant` | `Account@1234` |
| فني | `tech.ahmed` | `Tech@1234` |
| فني | `tech.mostafa` | `Tech@1234` |

معرّف المركز التجريبي: `mobile-care-eg`

> حقل «معرّف المركز» اختياري — يُستخدم فقط لو نفس اسم المستخدم موجود في أكثر من مركز.
> المركز الجديد يحصل على معرّف تلقائي مشتق من اسمه (مثل `مركز النور` → `mrkz-alnor-ktc6`).

### 6) التحقق من أن كل شيء يعمل

```bash
# اختبار دورة صيانة كاملة من البداية للنهاية عبر الـAPI
npm run e2e
```

يغطي **70 تحققًا**: من إنشاء التذكرة حتى الضمان، مع اختبار فرض قواعد العمل (منع الإصلاح بلا موافقة، منع التسليم بلا فحص وجودة وبلا سداد)، وعزل بيانات المستأجرين، والصلاحيات.

> ملاحظة: يجب أن يكون الـAPI جاهزًا (`npm run dev:api`) والـseed مُنفَّذًا قبل تشغيل الاختبار.

---

## الموديولات المنفَّذة

### التشغيل الأساسي

- **Organizations & Branches** — مؤسسة متعددة الفروع، حدود الباقة، إعدادات تشغيل وسياسات
- **Users, Roles & Permissions** — 7 أدوار و54 صلاحية، صلاحيات إضافية/محجوبة لكل مستخدم
- **Customers** — بحث بالهاتف، تجار/شركات، ملخص حسابي، سجل
- **Devices & Device Passport** — IMEI/سيريال، علامات خطر (سوائل/بوردة/إصلاح سابق)، تاريخ كامل للجهاز
- **Repair Tickets** — دورة عمل كاملة بـ17 حالة وانتقالات مقيّدة
- **Digital Intake & Evidence** — شكوى العميل، الفحص الظاهري، الملحقات، الإقرارات، صور الاستلام، التوقيع
- **Diagnosis** — ملخص، تصنيف العطل، درجة الخطورة، السبب الجذري، الإجراءات المطلوبة، دقة التشخيص
- **Technician Workspace** — مهامي، بدء/إيقاف تسجيل الوقت، ملاحظات، طلب قطع، الترتيب حسب SLA والأولوية
- **Parts & Inventory** — كتالوج + رصيد لكل فرع (موجود/محجوز/تالف/وارد)، حد إعادة الطلب، حركات ذرّية
- **Suppliers** — أداء الموردين: زمن التوريد، معدل العيوب، الدفعات
- **Estimates & Customer Approval** — إصدارات متعددة، موافقة جزئية على البنود، توثيق قناة القرار وعنوان الـIP
- **Quality Control** — قائمة فحص قابلة للتخصيص (22 بندًا افتراضيًا)، بنود إلزامية، منع التسليم قبل الاجتياز
- **Warranty & Claims** — فتح claim، قرار بالقبول/الرفض، تحميل المورد، إنشاء تذكرة عودة تلقائيًا
- **POS & Payments** — بيع مباشر، تحصيل، استرداد، فواتير، مصروفات
- **WhatsApp/Notifications** — قوالب عربية مرتبطة بحالة الإصلاح + إشعارات داخلية
- **Reports & Analytics** — لوحة تحكم، اتجاهات، أزمنة مراحل، تحليل أعطال، مؤشرات Pilot، أداء فنيين وفروع
- **Audit Logs** — تسجيل تلقائي لكل عملية كتابة + تدقيق على مستوى المورد
- **Knowledge Base** — Brand → Model → Category → Symptom → Steps → Causes → Outcomes، مع بحث بالعَرَض والموديل
- **Customer Portal** — صفحة تتبع عامة برمز آمن، موافقة/رفض رقمي بدون تسجيل دخول

### الميزات التميزية

| الميزة | التنفيذ |
|---|---|
| **Device Passport** | صفحة تاريخ كاملة للجهاز: إصلاحات، قطع، فحوص، ضمان، علامات خطر |
| **Repair Timeline / Chain of Custody** | سجل غير قابل للتعديل لكل انتقال مع الفاعل والمدة والمحطة |
| **Parts Quality Intelligence** | معدل فشل القطعة حسب المورد والدفعة والموديل |
| **Warranty Intelligence** | معدل العودة حسب نوع العطل، الفني، الموديل، والقطعة |
| **Digital QC** | قائمة مع بنود إلزامية تُفرض في طبقة الخدمة لا في الواجهة |
| **SLA Engine** | موعد مستحق حسب الأولوية + إيقاف العدّاد عند انتظار العميل/القطعة |
| **Tenant Isolation** | فرض على مستوى الاستعلام (بديل RLS) وليس في الواجهة فقط |
| **AI Repair Assistant (أساس)** | اقتراحات من قاعدة معرفة موثقة + نسبة نجاح تاريخية، بدون ادعاء تشخيص |

---

## نتائج البيانات التجريبية

بعد `npm run seed:reset` تكون المؤشرات على النحو التالي (مركز بثلاثة فروع، 84 تذكرة عبر 7 أشهر):

| المؤشر | القيمة | الهدف | الحالة |
|---|---|---|---|
| نسبة الأجهزة الموثقة بصور استلام | 76.7% | 90% | يحتاج تحسين |
| نسبة الإقرار/التوقيع | 76.7% | 80% | قريب من الهدف |
| نسبة الموافقة على عروض الإصلاح | 100% | 65% | ✅ |
| معدل عودة الضمان | 13.0% | ≤5% | يحتاج تحسين |
| نسبة اجتياز QC من أول مرة | 95.4% | 85% | ✅ |
| دقة المخزون | 100% | 95% | ✅ |
| متوسط عمر التذاكر المفتوحة | 110.8 ساعة | ≤48 | يحتاج تحسين |

> **ملاحظة منهجية:** `GET /analytics/pilot-kpis` يرجع مع المؤشرات `notes[]` توضح أساس حساب كل نسبة، لأن بعض النسب تحتاج مقامًا من نافذة زمنية مختلفة (مثل معدل عودة الضمان: claims الفترة ÷ الإصلاحات المُسلَّمة في آخر 12 شهرًا) وإلا خرجت النسب مضللة.

---

## بنية المشروع

```
mobile-repair-os/
├── apps/
│   ├── api/                      # Express + MongoDB
│   │   ├── src/
│   │   │   ├── config/           # البيئة، السجل، الاتصال بقاعدة البيانات
│   │   │   ├── constants/        # دورة العمل، الأدوار والصلاحيات
│   │   │   ├── context/          # Tenant Context (AsyncLocalStorage)
│   │   │   ├── middleware/       # المصادقة، التحقق، رفع الملفات، الأخطاء
│   │   │   ├── models/           # 27 موديل Mongoose + tenantPlugin
│   │   │   ├── services/         # workflow، مخزون، إشعارات، ترقيم، تدقيق، تخزين
│   │   │   ├── controllers/      # منطق المسارات
│   │   │   ├── routes/           # تعريف المسارات وصلاحياتها
│   │   │   ├── validators/       # مخططات Zod
│   │   │   └── scripts/seed.ts   # بيانات تجريبية واقعية
│   │   └── uploads/              # الملفات المرفوعة (معزولة لكل مؤسسة)
│   └── web/                      # Next.js 15
│       └── src/
│           ├── app/
│           │   ├── (app)/        # الصفحات المحمية (dashboard, tickets, ...)
│           │   ├── login/        # تسجيل الدخول
│           │   ├── register/     # تسجيل مركز جديد (Onboarding)
│           │   └── track/[token] # بوابة العميل العامة
│           ├── components/       # AppShell، مكتبة UI
│           └── lib/              # عميل الـAPI، المصادقة، التنسيقات، الثوابت
└── docs/                         # التوثيق
```

---

## الأوامر

كل الأوامر تُشغَّل من جذر المشروع:

| الأمر | الوصف |
|---|---|
| `npm install` | تثبيت كل الحزم (workspaces: api + web) |
| `npm run dev` | بناء الـAPI ثم تشغيل الـAPI والواجهة معًا |
| `npm run dev:api` | الـAPI فقط |
| `npm run dev:web` | الواجهة فقط |
| `npm run dev:watch` | تشغيل الاثنين مع مراقبة تغييرات TypeScript (يحتاج `tsx`) |
| `npm run build` | بناء الإنتاج للطرفين |
| `npm run build:api` · `build:web` | بناء طرف واحد |
| `npm start` | تشغيل نسخة الإنتاج للطرفين |
| `npm run typecheck` | فحص أنواع TypeScript لكل المشروع |
| `npm run seed` | بناء الـAPI ثم توليد بيانات تجريبية |
| `npm run seed:reset` | إعادة بناء البيانات من الصفر |
| `npm run e2e` | اختبار دورة الصيانة الكاملة (70 تحققًا) |
| `npm run fix:indexes:dry` | فحص الفهارس والقيم الفاضية (معاينة بلا تعديل) |
| `npm run fix:indexes` | إصلاح الفهارس والقيم الفاضية |
| `npm test` | اختبارات الـAPI (Vitest) |
| `npm run clean` | حذف node_modules ومخرجات البناء |

### أوامر workspace مباشرة

npm workspaces تتيح تشغيل أوامر حزمة بعينها من الجذر:

```bash
# تشغيل أمر داخل حزمة الـAPI
npm run <script> --workspace @mros/api

# أمثلة
npm run build --workspace @mros/api
npm run typecheck --workspace @mros/web
npm run seed:reset --workspace @mros/api
```

### إضافة تبعية

```bash
# لِـAPI
npm install <package> --workspace @mros/api
npm install -D <package> --workspace @mros/api

# للواجهة
npm install <package> --workspace @mros/web
```

> ملاحظة: ملف `.npmrc` في الجذر يضبط `save-exact=true`، فالإصدارات تُثبَّت بدون `^` لضمان ثبات البنية.

---

## حل المشاكل الشائعة

### `Failed to fetch` / خطأ CORS عند تسجيل الدخول

**السبب:** الواجهة تعمل على منفذ مختلف عن المُسجَّل في `CORS_ORIGINS`.

Next.js ينتقل تلقائيًا إلى المنفذ التالي (3001، 3002…) إذا كان 3000 مشغولًا.

**الحل المُطبَّق في الكود:** في وضع التطوير يقبل الـAPI أي منفذ على `localhost` / `127.0.0.1` تلقائيًا، فلا يتكرر هذا الخطأ. في الإنتاج تبقى قائمة `CORS_ORIGINS` هي المرجع الوحيد.

لو احتجت أصلًا غير محلي:
```env
# apps/api/.env
CORS_ORIGINS=https://app.example.com,http://localhost:3000
```

### منفذ 3000 مشغول

```powershell
# اعرف من يشغل المنفذ
netstat -ano | Select-String ":3000\s+.*LISTENING"
```

في PowerShell 5.1 الأمر `Stop-Process` يحتاج PID مباشرًا؛ أو ببساطة شغّل على منفذ آخر:
```powershell
$env:PORT="3001"; npm run dev:web
```
(CORS يقبل أي منفذ محلي في التطوير، فلا حاجة لتعديل أي شيء آخر.)

### الواجهة ترجع 404 أو أخطاء chunks بعد إعادة تثبيت الحزم

أعِد تشغيل سيرفر التطوير — لأن Next.js يحتفظ بحالة بناء داخلية (`.next`) مرتبطة بالحزم المثبَّتة سابقًا:

```bash
# أوقف السيرفر القديم ثم
npm run dev:web
```

### أوامر `tsx` تفشل بـ`spawn EPERM`

`tsx` يعتمد على esbuild الذي يُشغّل عملية فرعية. في البيئات المقيَّدة:

```bash
# الافتراضي في المشروع يعمل بالمُترجَم — لا يحتاج tsx
npm run seed
npm run dev:api

# للمراقبة الحيّة (يحتاج بيئة بلا قيود)
npm run dev:watch
```

---

## قواعد العمل المفروضة (وليست في الواجهة فقط)

هذه القواعد تُفرض في طبقة الخدمة، فلا يمكن تجاوزها من الواجهة أو بالـAPI مباشرة:

| القاعدة | نتيجة المحاولة |
|---|---|
| الانتقال بين الحالات يتبع خريطة صريحة | `INVALID_TRANSITION` (409) |
| لا بدء إصلاح قبل موافقة العميل على عرض السعر | `BUSINESS_RULE` (422) |
| لا تجهيز للتسليم قبل اجتياز فحص الجودة | `BUSINESS_RULE` (422) |
| لا تسليم قبل سداد كامل المستحق | `BUSINESS_RULE` (422) |
| بنود الفحص الإلزامية لا تُترك معلّقة | `BUSINESS_RULE` (422) |
| لا صرف مخزون أكثر من الرصيد المتاح | `BUSINESS_RULE` (422) |
| لا تجاوز الحد الأقصى لمهام الفني | `BUSINESS_RULE` (422) |
| لا تجاوز حدود الباقة (مستخدمون/فروع/تذاكر شهرية) | `BUSINESS_RULE` (422) |
| لا وصول لبيانات مركز آخر | `TENANT_MISMATCH` (403) |
| لا تغيير دور آخر مالك في المركز | `BUSINESS_RULE` (422) |
| لا claim ضمان على تذكرة لم تُسلَّم | `BUSINESS_RULE` (422) |
| لا claim ضمان مفتوح مكرر | `CONFLICT` (409) |

---

## نقاط النهاية الأساسية

```
GET    /health                          فحص الصحة

POST   /api/v1/auth/login               تسجيل الدخول
POST   /api/v1/auth/refresh             تجديد التوكن
POST   /api/v1/auth/register            تسجيل مركز جديد
GET    /api/v1/auth/me                  بيانات المستخدم والمؤسسة

GET    /api/v1/customers                قائمة العملاء
GET    /api/v1/customers/lookup?phone=  بحث سريع بالهاتف
GET    /api/v1/customers/:id            ملف العميل + أجهزته + سجله

GET    /api/v1/devices                  قائمة الأجهزة
GET    /api/v1/devices/:id              جواز الجهاز (Passport)
GET    /api/v1/devices/:id/suggested-parts   قطع متوافقة

GET    /api/v1/tickets                  قائمة التذاكر
GET    /api/v1/tickets/board            لوحة العمل (Kanban)
GET    /api/v1/tickets/my-jobs          مهام الفني الحالي
POST   /api/v1/tickets                  إنشاء تذكرة (عميل/جهاز جديد أو موجود)
GET    /api/v1/tickets/:id              تفاصيل كاملة + الانتقالات المتاحة
POST   /api/v1/tickets/:id/transition   تغيير الحالة (يمر عبر محرّك دورة العمل)
POST   /api/v1/tickets/:id/assign       إسناد لفني
PUT    /api/v1/tickets/:id/diagnosis    تسجيل التشخيص
POST   /api/v1/tickets/:id/evidence     رفع صور/توقيع
POST   /api/v1/tickets/:id/parts        إضافة قطعة (تحجز من المخزون)
POST   /api/v1/tickets/:id/labor        إضافة بند مصنعية
POST   /api/v1/tickets/:id/work-log     تسجيل وقت العمل
GET    /api/v1/tickets/:id/timeline     سلسلة الأحداث

POST   /api/v1/estimates                إنشاء عرض سعر
POST   /api/v1/estimates/:id/send       إرسال للعميل
POST   /api/v1/estimates/:id/decide     تسجيل قرار العميل

GET    /api/v1/parts                    كتالوج القطع
GET    /api/v1/parts/low-stock          نواقص المخزون
GET    /api/v1/parts/consumption-report تقييم الاستهلاك
POST   /api/v1/inventory/movements      حركة مخزون
POST   /api/v1/inventory/adjust         جرد فعلي
POST   /api/v1/inventory/transfers      تحويل بين الفروع

GET    /api/v1/quality-checks           سجلات الفحص
POST   /api/v1/quality-checks           بدء فحص
POST   /api/v1/quality-checks/:id/submit   تسجيل النتيجة

GET    /api/v1/warranty/claims          claims الضمان
POST   /api/v1/warranty/claims          فتح claim
POST   /api/v1/warranty/claims/:id/decide  قرار الضمان
GET    /api/v1/warranty/intelligence    تحليلات الضمان
GET    /api/v1/warranty/failing-parts   القطع الأكثر فشلًا

GET    /api/v1/finance/invoices         الفواتير
POST   /api/v1/finance/payments         تحصيل
POST   /api/v1/finance/pos/sale         بيع مباشر
GET    /api/v1/finance/summary          الملخص المالي

GET    /api/v1/analytics/dashboard       لوحة التحكم
GET    /api/v1/analytics/pilot-kpis      مؤشرات نجاح التجربة
GET    /api/v1/analytics/turnaround      أزمنة التشغيل
GET    /api/v1/analytics/fault-analysis  تحليل الأعطال
GET    /api/v1/analytics/technicians/performance  أداء الفنيين

GET    /api/v1/knowledge                قاعدة المعرفة
GET    /api/v1/knowledge/suggest        اقتراحات تشخيص
GET    /api/v1/audit-logs               سجل التدقيق

GET    /api/v1/public/track/:token       تتبع عام (بوابة العميل)
POST   /api/v1/public/track/:token/decide  موافقة/رفض رقمي
```

قائمة كاملة: `GET /api/v1/meta/endpoints`

---

## الأمان والخصوصية

- **عزل المستأجرين:** كل استعلام يمر عبر `tenantPlugin` الذي يضيف `organizationId` تلقائيًا من `TenantContext`، وأي تعارض يرفع `TENANT_MISMATCH`. لا يمكن الوصول لبيانات مركز آخر حتى مع معرّف صحيح.
- **RBAC:** 54 صلاحية، وتُفحص على مستوى المسار قبل الوصول لمنطق العمل.
- **كلمات المرور:** bcrypt بـ12 دورة، ولا تُعاد أبدًا في أي استجابة (`select: false`).
- **أقفال الأجهزة:** لا تُخزَّن كلمة مرور/نمط قفل الجهاز — يُحفظ نوع القفل وإشارة `hasLockCode` فقط.
- **IMEI:** يُخزَّن كاملًا داخليًا ويُقنَّع في كل عرض عام (بوابة العميل، القوائم العامة).
- **بوابة العميل:** وصول برمز عشوائي 24 بايت (وليس برقم التذكرة)، بيانات محدودة، ولا ملاحظات داخلية.
- **سجل التدقيق:** كل عملية كتابة تُسجَّل تلقائيًا مع الفاعل والـIP ومعرّف الطلب، والحقول الحساسة تُستبعد.
- **تحديد المعدل:** حد عام 600 طلب/15 دقيقة، وحد أشد على مسار تسجيل الدخول (30 محاولة).
- **قفل الحساب:** 8 محاولات خاطئة ← قفل 15 دقيقة.

> المتطلبات القانونية المصرية لحماية البيانات الشخصية قبل الإطلاق التجاري تحتاج مراجعة مستشار قانوني.

---

## المعمارية والتحويل من Supabase

تفاصيل كاملة في [docs/architecture.md](docs/architecture.md): كيف تم استبدال كل خدمة من Supabase، وقواعد العمل المفروضة في طبقة الخدمة، ونموذج البيانات.

## واجهة الـAPI

مرجع تفصيلي في [docs/api.md](docs/api.md).

## خطة التطوير

[docs/roadmap.md](docs/roadmap.md) — ما تم تنفيذه مقابل مراحل الدراسة، والخطوات التالية المقترحة.
