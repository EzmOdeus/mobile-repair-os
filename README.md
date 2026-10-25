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
# مفتاح مستقل لتشفير أسرار 2FA (موصى به في الإنتاج؛ إن تُرك فارغًا يُشتق من JWT_ACCESS_SECRET)
TWO_FACTOR_ENCRYPTION_KEY=...
TWO_FACTOR_CHALLENGE_TTL_MINUTES=5
PORT=4000
CORS_ORIGINS=http://localhost:3000
```

### 3) توليد بيانات تجريبية واقعية

```bash
npm run seed          # إنشاء البيانات لأول مرة
npm run seed:reset    # حذف كل شيء وإعادة البناء من الصفر (للتطوير فقط)
```

> **أمان البيانات:** `seed:reset` يمسح كل مستندات قاعدة البيانات المتصلة، وليس بيانات المركز التجريبي فقط.
> لذلك يرفض العمل على `NODE_ENV=production` إلا مع `--force` بعد نسخة احتياطية. خُذ نسخة أولًا إن كانت القاعدة تحتوي بيانات تهمك.
>
> **تدقيق المالية (قراءة فقط):** `npm run audit:finance` يفحص اتساق الفواتير مع المدفوعات (paid/due/status/paidAt،
> الدفعات اليتيمة، تعارض المؤسسة/الفرع، تكرار الأرقام، ومجاميع البنود). أضف `--fix` لإصلاح الحقول المشتقة للفواتير
> فقط دون حذف أو تعديل أي مبالغ.
>
> ```bash
> npm run audit:finance
> npm run build:api && cd apps/api && node dist/scripts/audit-dev-data.js --fix
> ```

الـseed ينشئ: مركزًا بثلاثة فروع، 9 مستخدمين، 6 موردين، 25 قطعة، 46 عميلًا، 72 جهازًا، **84 تذكرة صيانة** بتواريخ حقيقية موزّعة على آخر 7 أشهر، مع سلسلة أحداث كاملة، عروض أسعار وموافقات، قطع مستخدمة، فحوص جودة، فواتير ومدفوعات، مصروفات، 9 claims ضمان، إشعارات، 120 سجل تدقيق، 4 مقالات في قاعدة المعرفة، ودليل أسعار مرجعيًا لبورصة التليفونات (11 موديلًا شائعًا).

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

# اختبارات المتصفح الفعلية عبر Playwright
npm run test:e2e
```

يغطي `npm run e2e` **69 تحققًا**: من إنشاء التذكرة حتى الضمان، مع اختبار فرض قواعد العمل (منع الإصلاح بلا موافقة، منع التسليم بلا فحص وجودة وبلا سداد)، وعزل بيانات المستأجرين، والصلاحيات.

أما `npm run test:e2e` فيشغّل Playwright على واجهة Next.js الحقيقية: تحويل الزائر غير المسجل إلى صفحة الدخول، دخول المالك إلى لوحة التحكم، فتح فاتورة وتحميل PDF من الخادم والتحقق من ترويسته، تسجيل manifest وService Worker وعرض صفحة عدم الاتصال عند فشل التنقل، ودورة كاملة لإنشاء تذكرة بلا اتصال ثم مزامنتها تلقائيًا عند عودة الشبكة.

ويشغّل `npm test` **66 اختبارًا آليًا** (Vitest) تغطي ترقيم المستندات، حساب درج الورديات، سلامة البيع في POS، معالجة الإشعارات، فاتورة PDF، التحقق بخطوتين (متجهات RFC 6238 + مسار HTTP كامل للإعداد والتفعيل والدخول والاسترداد والإيقاف)، وidempotency إنشاء التذاكر (إعادة نفس المفتاح، مفاتيح مختلفة، والمسار القديم بدون مفتاح)، على قاعدة اختبار معزولة تُسقط نفسها.

> المتطلبات: MongoDB يعمل والـseed مُنفَّذ، وتثبيت المتصفح مرة واحدة بـ `npx playwright install chromium`.
> الإعداد في `playwright.config.ts` يشغّل الـAPI والواجهة تلقائيًا إن لم يكونا يعملين، ويعيد استخدام الخوادم الجارية محليًا. لتعطيل التشغيل التلقائي استخدم `E2E_SKIP_WEBSERVER=1`.
> كل Push/PR يمر تلقائيًا عبر GitHub Actions (`.github/workflows/ci.yml`): تثبيت نظيف + `typecheck` + اختبارات Vitest على MongoDB + `build` + اختبارات Playwright على MongoDB منفصلة.

---

## الموديولات المنفَّذة

### التشغيل الأساسي

- **Organizations & Branches** — مؤسسة متعددة الفروع، حدود الباقة، إعدادات تشغيل وسياسات
- **Users, Roles & Permissions** — 8 أدوار (7 للمركز + مدير المنصة) و66 صلاحية، صلاحيات إضافية/محجوبة لكل مستخدم
- **Customers** — بحث بالهاتف، تجار/شركات، ملخص حسابي، سجل
- **Devices & Device Passport** — IMEI/سيريال، علامات خطر (سوائل/بوردة/إصلاح سابق)، تاريخ كامل للجهاز
- **Repair Tickets** — دورة عمل كاملة بـ17 حالة وانتقالات مقيّدة
- **Digital Intake & Evidence** — شكوى العميل، الفحص الظاهري، الملحقات، الإقرارات، صور الاستلام، التوقيع
- **PWA & Offline Intake** — تطبيق ويب قابل للتثبيت، صفحة عدم اتصال، وطابور تذاكر محلي يُزامَن تلقائيًا عند عودة الشبكة (مع مفتاح idempotency يمنع التكرار)
- **Diagnosis** — ملخص، تصنيف العطل، درجة الخطورة، السبب الجذري، الإجراءات المطلوبة، دقة التشخيص
- **Technician Workspace** — مهامي، بدء/إيقاف تسجيل الوقت، ملاحظات، طلب قطع، الترتيب حسب SLA والأولوية
- **Parts & Inventory** — كتالوج + رصيد لكل فرع (موجود/محجوز/تالف/وارد)، حد إعادة الطلب، حركات ذرّية
- **Procurement** — دورة أوامر شراء كاملة (مسودة → اعتماد → استلام كلي/جزئي → إلغاء)، دفعات موردين، أعمار الدائنين
- **Stocktake & Transfers** — جرد فعلي بتسوية تلقائية، تحويلات بين الفروع (إرسال/استلام)، تقييم المخزون
- **Suppliers** — أداء الموردين: زمن التوريد، معدل العيوب، الدفعات، كشف حساب
- **Estimates & Customer Approval** — إصدارات متعددة، موافقة جزئية على البنود، توثيق قناة القرار وعنوان الـIP
- **Quality Control** — قائمة فحص قابلة للتخصيص (22 بندًا افتراضيًا)، بنود إلزامية، منع التسليم قبل الاجتياز
- **Warranty & Claims** — فتح claim، قرار بالقبول/الرفض، تحميل المورد، إنشاء تذكرة عودة تلقائيًا
- **POS & Payments** — بيع مباشر مربوط برصيد الفرع النشط، تحصيل، استرداد، فواتير، مصروفات
- **Market Plus & Phone Price Exchange** — سوق عام بين المراكز (بمراجعة المنصة) وسوق داخلي بين فروع المركز، إعلانات بيع/مطلوب بصور وعروض شراء (قبول/رفض/سحب)، وبورصة أسعار هجينة تجمع دليل المنصة مع مؤشر مشتق من الإعلانات لتقييم الأجهزة
- **Financial Reports** — قائمة أرباح وخسائر، إقرار ضريبة القيمة المضافة، أعمار المستحقات، تقرير الكاشير، كشوف حساب العملاء والموردين
- **WhatsApp/Notifications** — قوالب عربية مرتبطة بحالة الإصلاح + إشعارات داخلية
- **Reports & Analytics** — لوحة تحكم، اتجاهات، أزمنة مراحل، تحليل أعطال، مؤشرات Pilot، أداء فنيين وفروع
- **Audit Logs** — تسجيل تلقائي لكل عملية كتابة + تدقيق على مستوى المورد
- **Knowledge Base** — Brand → Model → Category → Symptom → Steps → Causes → Outcomes، مع بحث بالعَرَض والموديل
- **Customer Portal** — صفحة تتبع عامة برمز آمن، موافقة/رفض رقمي بدون تسجيل دخول
- **Subscriptions & Billing** — تجربة 14 يومًا، تفعيل ذاتي مدفوع لـ growth/pro (طريقة ومرجع دفع إلزاميان)، enterprise من المنصة فقط، سجل مدفوعات، طلبات تجديد، تذكيرات 7/3/1، ومهلة سداد 7 أيام
- **Platform Admin** — إدارة المراكز والباقات والاشتراكات والنسخ الاحتياطي، اعتماد/رفض طلبات التجديد، وتقرير إيرادات الاشتراكات عبر `/platform`

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

### العمل بدون اتصال (PWA)

- **قابل للتثبيت:** `manifest.webmanifest` عربي RTL مع أيقونات 192/512 وأيقونة maskable، وService Worker يسجّل نفسه تلقائيًا.
- **Fallback للتنقل:** عند انقطاع الشبكة تُعرض صفحة `/offline.html` بدل خطأ المتصفح، وتُخزَّن أصول الواجهة فقط — **لا تُخزَّن استجابات الـAPI أو بيانات المستأجرين**.
- **طابور التذاكر:** شاشة «تذكرة جديدة» تعمل بلا اتصال (إدخال عميل وجهاز يدويًا)، وتُحفظ التذكرة في `localStorage` باسم `mros.offlineQueue.v1` مرتبطة بالمؤسسة والمستخدم والفرع.
- **مزامنة آمنة:** عند عودة الشبكة تُرسَل التذاكر بالترتيب؛ أخطاء الشبكة/5xx تُبقيها في الطابور، وأخطاء 4xx الدائمة تُعلَّم «تحتاج مراجعة» مع إعادة/حذف يدوي. شارة ثابتة تعرض العدد وتتيح المزامنة الفورية.
- **منع التكرار:** كل عنصر يحمل `clientRequestId` (UUID)؛ الـAPI يعيد نفس التذكرة عند إعادة الإرسال (200 مع `idempotentReplay: true`) بدل إنشاء نسخة ثانية، مع فهرس فريد لكل مؤسسة.

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
│       ├── public/               # manifest.webmanifest + sw.js + offline.html + أيقونات PWA
│       └── src/
│           ├── app/
│           │   ├── (app)/        # الصفحات المحمية (dashboard, tickets, ...)
│           │   ├── login/        # تسجيل الدخول
│           │   ├── register/     # تسجيل مركز جديد (Onboarding)
│           │   ├── offline/      # صفحة عدم الاتصال داخل التطبيق
│           │   └── track/[token] # بوابة العميل العامة
│           ├── components/       # AppShell، ServiceWorkerRegister، OfflineStatus، مكتبة UI
│           └── lib/              # عميل الـAPI، المصادقة، offlineQueue، التنسيقات، الثوابت
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
| `npm run bootstrap:platform` | إنشاء/تحديث مدير المنصة على قاعدة إنتاج فارغة |
| `npm run e2e` | اختبار دورة الصيانة الكاملة (69 تحققًا) |
| `npm run test:e2e` | اختبارات المتصفح Playwright (دخول + PDF + PWA وطابور Offline) |
| `npm run test:e2e:ui` | تشغيل Playwright بواجهة تفاعلية |
| `npm run audit:finance` | تدقيق مالي للبيانات (قراءة فقط بلا تعديل) |
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

## النشر على Vercel

المشروع مُهيَّأ للنشر **كمشروع Vercel واحد** من جذر المستودع، بخدمتين (`vercel.json` → `services`):
- `web` → `apps/web` (Next.js)
- `api` → `apps/api` (Express كنقطة دخول `server.js`)

الخدمتان تتشاركان نفس الدومين؛ لذلك:
- `NEXT_PUBLIC_API_URL=/api/v1` (رابط نسبي)
- `PUBLIC_API_URL=https://<your-domain>` بدون `/` في النهاية (يُستخدم في روابط الملفات الموقّعة وOpenAPI)
- `/api/*` و`/uploads/*` و`/health` و`/docs/*` تُوجَّه تلقائيًا لخدمة الـAPI، وباقي المسارات للواجهة.

> بديل: يمكن نشر مشروعين منفصلين (Root Directory = `apps/web` و`apps/api`). في هذه الحالة `apps/api/vercel.json` يعمل مستقلًا، واضبط `NEXT_PUBLIC_API_URL=https://<api-domain>/api/v1` وأضف دومين الواجهة إلى `CORS_ORIGINS`.

### 1) المتغيرات المطلوبة على Vercel

| المتغير | القيمة |
|---|---|
| `MONGODB_URI` | رابط **MongoDB Atlas** (وليس localhost). يُفضّل `MONGODB_MAX_POOL_SIZE=5` على Serverless |
| `JWT_ACCESS_SECRET` · `JWT_REFRESH_SECRET` | أسرار عشوائية 32 حرفًا على الأقل (`openssl rand -base64 48`) |
| `TWO_FACTOR_ENCRYPTION_KEY` · `UPLOAD_URL_SECRET` | أسرار عشوائية 32 حرفًا على الأقل (موصى بهما في الإنتاج) |
| `PUBLIC_API_URL` | `https://<your-domain>` |
| `PUBLIC_WEB_URL` | `https://<your-domain>` |
| `CORS_ORIGINS` | `https://<your-domain>` (أضف دومينات المعاينة إن استخدمت مشروعين منفصلين) |
| `STORAGE_DRIVER` | `s3` **إجباريًا** على Vercel — القرص هناك للقراءة فقط وغير دائم |
| `S3_ENDPOINT` · `S3_REGION` · `S3_BUCKET` · `S3_ACCESS_KEY_ID` · `S3_SECRET_ACCESS_KEY` | بيانات AWS S3 أو Cloudflare R2. لـR2/MinIO اضبط `S3_FORCE_PATH_STYLE=true` |
| `UPLOAD_MAX_FILE_MB` | `4` (حد جسم الطلب في Vercel هو 4.5MB) |
| `CRON_SECRET` | سرّ 16 حرفًا على الأقل؛ Vercel Cron يرسله كـ`Authorization: Bearer` |
| `BACKUP_ENABLED` | `false` (استخدم النسخ التلقائي في Atlas) |
| `NEXT_PUBLIC_API_URL` | اختياري في مشروع الخدمتين (الافتراضي `/api/v1` على أي دومين غير محلي)، ومطلوب برابط الـAPI الكامل عند نشر الواجهة منفصلة |

`NODE_ENV=production` يضبطه Vercel تلقائيًا. عند غياب `STORAGE_DRIVER=s3` أو استخدام `MONGODB_URI` محلي، يفشل تشغيل الـAPI برسالة عربية واضحة بدل قبول كتابة ملفات تضيع.

### 2) تهيئة قاعدة الإنتاج قبل أول دخول

شغّل هذه الأوامر من جهازك مع متغيرات الإنتاج (Atlas + الأسرار) في `apps/api/.env`:

```bash
# 1) مزامنة الفهارس — الإنتاج يعمل بـautoIndex=false
npm run fix:indexes

# 2) إنشاء مدير المنصة (بدون بيانات seed التجريبية)
PLATFORM_ADMIN_PASSWORD='كلمة-مرور-قوية-12-حرفًا-على-الأقل' npm run bootstrap:platform
```

- أضف عنوان IP لجهازك إلى Atlas عند التنفيذ، ثم اسمح لعناوين Vercel الديناميكية (`0.0.0.0/0` عمليًا) مع تقييد صلاحيات مستخدم قاعدة البيانات.
- **لا تشغّل `npm run seed` على الإنتاج** — ينشئ مركزًا تجريبيًا وكلمات مرور معروفة.
- الحساب الافتراضي لمدير المنصة: `platform.admin` (يمكن تغييره عبر `PLATFORM_ADMIN_USERNAME`).

### 3) المهام الدورية (Cron)

`setInterval` لا يعمل على Serverless. `vercel.json` يضبط مهمتين يوميتين:
- `/api/v1/internal/cron/subscription` — تحويل الاشتراكات المنتهية وإرسال التذكيرات
- `/api/v1/internal/cron/sla` — فحص تجاوزات SLA وإنشاء الإشعارات

Vercel Hobby يسمح بمرة واحدة يوميًا (وتوقيت غير دقيق ±ساعة). على Pro/Fluid يمكنك تعديل الجدولة إلى كل 5 دقائق/ساعة، أو استدعاء المسارين من مجدول خارجي مع نفس `Authorization: Bearer <CRON_SECRET>`.

### 4) قيود يجب معرفتها

- **الملفات:** تحتاج S3/R2؛ لا تُكتب على قرص Vercel بشكل دائم.
- **النسخ الاحتياطي:** النسخ المحلي المجدول معطّل على Vercel ويرفض العمل برسالة واضحة. استخدم النسخ التلقائي في Atlas.
- **حجم الطلب:** 4.5MB كحد أقصى من Vercel؛ لذلك سقف رفع الملف = 4MB.
- **المهام الطويلة:** الحد الافتراضي للدالة 60 ثانية في هذا الإعداد (`maxDuration`)؛ كافٍ للعمليات الحالية، وارفعه عند الحاجة حتى 300 ثانية على Hobby.
- **PWA:** يعمل كما هو؛ Service Worker يخزّن أصول الواجهة فقط.

بعد ضبط المتغيرات: `npx vercel link` من جذر المستودع ثم `npx vercel --prod`. لا تُنشئ مشروعًا من داخل `apps/web` أو `apps/api` إذا اخترت إعداد الخدمتين.

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

> **CORS ومبدّل الفروع:** بعد اختيار فرع، ترسل الواجهة الرأس `x-branch-id`. إذا لم يكن مسموحًا في `Access-Control-Allow-Headers` ستفشل كل الطلبات في المتصفح برسالة `Request header field x-branch-id is not allowed` رغم نجاحها من curl. القائمة في `apps/api/src/config/cors.ts` تتضمن الرأس الآن؛ أي رأس مخصص جديد يجب إضافته هناك أيضًا.

### مبدّل الفرع لا يعرض بيانات أو يرجع `Failed to fetch`

تأكد أن الـAPI وشاشة الويب على نفس نسخة الإعدادات، وأن `x-branch-id` مسموح في CORS (انظر أعلاه)، ثم أعد تحميل الصفحة. تغيير الفرع يُطلق `mutate(() => true)` لإعادة تحميل كل بيانات SWR؛ إذا ظهرت أرقام قديمة بعد إعادة تشغيل الـAPI فحدّث الصفحة كاملًا.

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
| المستخدم المقيّد بفرع لا يرى/يعدّل بيانات فرع آخر | `FORBIDDEN` (403) |
| لا بيع من نقاط البيع دون تحديد فرع نشط | `BUSINESS_RULE` / تعطيل الواجهة |
| لا استلام كمية أكبر من المتبقي في أمر الشراء | `BUSINESS_RULE` (422) |
| لا سداد لمورد أكبر من المتبقي على أمر الشراء | `BUSINESS_RULE` (422) |
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
GET    /api/v1/inventory/movements      سجل حركات المخزون
POST   /api/v1/inventory/adjust         جرد فعلي
GET    /api/v1/inventory/valuation      تقييم المخزون بالتكلفة والبيع
GET    /api/v1/inventory/counts         عمليات الجرد
POST   /api/v1/inventory/counts         بدء جرد (تسوية تلقائية عند الإغلاق)
POST   /api/v1/inventory/transfers      تحويل بين الفروع
POST   /api/v1/inventory/transfers/:id/send      إرسال التحويل
POST   /api/v1/inventory/transfers/:id/receive   استلام التحويل

GET    /api/v1/purchases                أوامر الشراء
POST   /api/v1/purchases                إنشاء أمر شراء
GET    /api/v1/purchases/payables       أعمار الدائنين للموردين
POST   /api/v1/purchases/payments       سداد لمورد (على الحساب أو أمر شراء)
POST   /api/v1/purchases/:id/order      اعتماد الأمر
POST   /api/v1/purchases/:id/receive    استلام كلي/جزئي (يدخل المخزون)
POST   /api/v1/purchases/:id/cancel     إلغاء الأمر
POST   /api/v1/purchases/:id/payments   سداد على أمر شراء محدد

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
GET    /api/v1/finance/reports/profit-loss  قائمة الأرباح والخسائر
GET    /api/v1/finance/reports/vat      إقرار ضريبة القيمة المضافة
GET    /api/v1/finance/reports/aging    أعمار المستحقات
GET    /api/v1/finance/reports/cashier  تقرير الكاشير
GET    /api/v1/finance/customers/:id/statement  كشف حساب عميل
GET    /api/v1/finance/suppliers/:id/statement  كشف حساب مورد

GET    /api/v1/auth/users               مستخدمو المركز
PATCH  /api/v1/auth/users/:id           تعديل مستخدم/دور/فروع/كلمة مرور
DELETE /api/v1/auth/users/:id           تعطيل مستخدم
GET    /api/v1/auth/roles               الأدوار والصلاحيات
POST   /api/v1/auth/users/:id/2fa/reset إعادة تعيين التحقق بخطوتين إداريًا
POST   /api/v1/auth/2fa/setup           بدء إعداد 2FA (QR + سر)
POST   /api/v1/auth/2fa/enable          تأكيد الرمز وتفعيل + رموز الاسترداد
POST   /api/v1/auth/2fa/verify          إتمام الدخول برمز TOTP أو استرداد
GET    /api/v1/auth/2fa/status          حالة 2FA والرموز المتبقية
POST   /api/v1/auth/2fa/disable         إيقاف 2FA
POST   /api/v1/auth/2fa/recovery-codes  تجديد رموز الاسترداد
GET    /api/v1/branches                 الفروع
POST   /api/v1/branches                 فرع جديد
PATCH  /api/v1/branches/:id             تعديل فرع
DELETE /api/v1/branches/:id             تعطيل فرع

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
- **RBAC:** 66 صلاحية، وتُفحص على مستوى المسار قبل الوصول لمنطق العمل.
- **كلمات المرور:** bcrypt بـ12 دورة، ولا تُعاد أبدًا في أي استجابة (`select: false`).
- **أقفال الأجهزة:** لا تُخزَّن كلمة مرور/نمط قفل الجهاز — يُحفظ نوع القفل وإشارة `hasLockCode` فقط.
- **IMEI:** يُخزَّن كاملًا داخليًا ويُقنَّع في كل عرض عام (بوابة العميل، القوائم العامة).
- **بوابة العميل:** وصول برمز عشوائي 24 بايت (وليس برقم التذكرة)، بيانات محدودة، ولا ملاحظات داخلية.
- **سجل التدقيق:** كل عملية كتابة تُسجَّل تلقائيًا مع الفاعل والـIP ومعرّف الطلب، والحقول الحساسة تُستبعد.
- **المصادقة الثنائية (2FA):** TOTP (RFC 6238) متوافق مع تطبيقات المصادقة، مفعّلة اختياريًا ويُوصى بها للمالك والمدير. السر مشفّر AES-256-GCM، و8 رموز استرداد تُخزَّن SHA-256 وتُستهلك مرة واحدة. توكن التحدي صالح 5 دقائق ولا يصلح كمصادقة، وتوكنات التجديد الصادرة قبل التفعيل تُرفض. يمكن للإدارة إعادة تعيين 2FA لمستخدم (`user:manage`) عند فقد الهاتف والرموز.
- **تحديد المعدل:** حد عام 600 طلب/15 دقيقة، وحد أشد على مساري الدخول والتحقق بخطوتين (30 محاولة).
- **قفل الحساب:** 8 محاولات خاطئة ← قفل 15 دقيقة (تشمل رمز 2FA الخاطئ).

> المتطلبات القانونية المصرية لحماية البيانات الشخصية قبل الإطلاق التجاري تحتاج مراجعة مستشار قانوني.

---

## المعمارية والتحويل من Supabase

تفاصيل كاملة في [docs/architecture.md](docs/architecture.md): كيف تم استبدال كل خدمة من Supabase، وقواعد العمل المفروضة في طبقة الخدمة، ونموذج البيانات.

## واجهة الـAPI

مرجع تفصيلي في [docs/api.md](docs/api.md).

## خطة التطوير

[docs/roadmap.md](docs/roadmap.md) — ما تم تنفيذه مقابل مراحل الدراسة، والخطوات التالية المقترحة.
