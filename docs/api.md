# مرجع الـAPI

يمكن تصفح وتجربة النقاط من واجهة Swagger على `http://localhost:4000/docs` بعد تشغيل الـAPI. مصدر OpenAPI المستخدم للواجهة في [openapi.yaml](openapi.yaml).

**القاعدة:** `http://localhost:4000/api/v1`
**المصادقة:** `Authorization: Bearer <accessToken>`
**نطاق الفرع:** أضف `x-branch-id: <branchId>` لتقييد الطلب بفرع محدد. هذا الرأس **إلزامي عمليًا** لعمليات نقاط البيع، ويُرفض تلقائيًا لأي مستخدم مقيّد بفرع إذا حاول قراءة/تعديل بيانات فرع آخر (`FORBIDDEN`). بدون الرأس: المالك/المدير/المحاسب يرون كل الفروع، وبقية الأدوار يُقيَّدون بفرعهم من التوكن.
**الصيغة:** كل الاستجابات `{ success, data, meta? }` أو `{ success: false, error: { code, message, details }, requestId }`

## أكواد الأخطاء

| الكود | HTTP | المعنى |
|---|---|---|
| `VALIDATION_ERROR` | 422 | بيانات الطلب غير صحيحة (مع تفاصيل الحقول) |
| `UNAUTHORIZED` | 401 | لا توكن أو منتهي |
| `FORBIDDEN` | 403 | صلاحية ناقصة أو خروج عن نطاق المؤسسة |
| `NOT_FOUND` | 404 | العنصر غير موجود |
| `CONFLICT` | 409 | تكرار (هاتف، SKU، رقم تذكرة…) |
| `INVALID_TRANSITION` | 409 | انتقال حالة غير مسموح |
| `BUSINESS_RULE` | 422 | رفض وفق قواعد العمل (موافقة/فحص/سداد) |
| `TENANT_MISMATCH` | 403 | محاولة وصول لبيانات مركز آخر |
| `RATE_LIMITED` | 429 | تجاوز حد الطلبات |

---

## المصادقة

### `POST /auth/login`
```json
{ "identifier": "owner", "password": "Owner@1234", "organizationSlug": "mobile-care-eg" }
```
`organizationSlug` اختياري ويُستخدم فقط إذا كان اسم المستخدم موجودًا في أكثر من مركز.

**الرد:** `{ accessToken, refreshToken, expiresIn, user, organization }`

> إذا كان التحقق بخطوتين مفعّلًا للحساب، لا يعيد الدخول توكنات، بل `{ twoFactorRequired: true, challengeToken, expiresIn }`. أكمل الدخول عبر `POST /auth/2fa/verify` بالحق.

### `POST /auth/refresh`
```json
{ "refreshToken": "..." }
```

### `POST /auth/register` — تسجيل مركز جديد (عام، بلا مصادقة)

الرحلة الكاملة في طلب واحد: ينشئ **المؤسسة + الفرع الرئيسي + حساب المالك**، ويُرجع توكن دخول مباشر فيصبح الحساب جاهزًا فورًا.

```json
{
  "organization": {
    "name": "مركز النور للموبايل",
    "nameEn": "Al Nour Mobile",
    "phone": "01111111111",
    "email": "info@alnour.eg",
    "governorate": "القاهرة",
    "city": "مدينة نصر"
  },
  "owner": {
    "fullName": "أحمد محمد",
    "username": "ahmed",
    "password": "Ahmed@1234",
    "email": "ahmed@example.com",
    "phone": "01012345678"
  },
  "branch": { "name": "الفرع الرئيسي", "code": "MAIN" }
}
```

**الرد** (`201`): نفس شكل رد تسجيل الدخول + تفاصيل الفرع والباقة:
```json
{
  "success": true,
  "data": {
    "accessToken": "...",
    "refreshToken": "...",
    "expiresIn": 900,
    "user": { "id": "...", "fullName": "أحمد محمد", "username": "ahmed", "role": "owner", "permissions": ["..."] },
    "organization": {
      "id": "...",
      "name": "مركز النور للموبايل",
      "slug": "mrkz-alnor-llmobail-ktc6",
      "role": "owner",
      "subscription": { "plan": "starter", "status": "trialing", "maxUsers": 5, "maxBranches": 2, "monthlyTicketLimit": 300 }
    },
    "branch": { "id": "...", "name": "الفرع الرئيسي", "code": "MAIN" }
  }
}
```

**قواعد مهمة:**

| القاعدة | السلوك |
|---|---|
| الباقة الافتراضية | `starter` بحالة `trialing` — 5 مستخدمين، فرعان، 300 تذكرة شهريًا |
| دور المالك | `owner` بكل الصلاحيات (54)، ولا يمكن تقييده |
| تفرد اسم المستخدم | على مستوى المنصة كلها (لا يمكن لمركزين استخدام نفس الاسم) → `CONFLICT` |
| تفرد البريد | على مستوى المنصة كلها إن أُدخل → `CONFLICT` |
| كلمة المرور | 8 أحرف على الأقل، وتحتوي حرفًا ورقمًا → `VALIDATION_ERROR` |
| اسم المستخدم | حروف إنجليزية صغيرة وأرقام و `. _ -` فقط، 3–40 حرفًا |
| **معرّف المركز (slug)** | يُولَّد تلقائيًا: الأسماء العربية تُحوَّل صوتيًا (`مركز النور` → `mrkz-alnor`)، ثم لاحقة عشوائية قصيرة للتفرد. لو كان الاسم غير عربي بالكامل يُستخدم `nameEn`، وإلا `org-xxxx` |
| العزل | المركز الجديد يبدأ ببيانات فارغة تمامًا — لا يرى أي بيانات من مراكز أخرى ولا العكس |

> **ملاحظة عن البريد:** مطلوب على مستوى المنصة كلها فقط إذا أُدخل. اسم المستخدم هو المُعرّف الأساسي للدخول.

**صفحة الواجهة:** `/register` — نموذج على خطوتين (بيانات المركز ← حساب المالك) مع اقتراح تلقائي لاسم المستخدم ومؤشر قوة كلمة المرور، وينتهي بتسجيل دخول مباشر إلى لوحة التحكم.

---

### باقات الاشتراك وحدودها

الحدود معرّفة في `apps/api/src/constants/plans.ts` وتُفرض في `services/planService.ts`، **عند لحظة الإنشاء** لا عند العرض. كل محاولة تجاوز تُرجع `422 BUSINESS_RULE` مع تفاصيل الحد.

| الباقة | المستخدمون | الفروع | تذاكر/شهر | السعر الشهري |
|---|---|---|---|---|
| `trial` | 2 | 1 | 50 | مجاني |
| `starter` (الافتراضية عند التسجيل) | 5 | 2 | 300 | مجاني |
| `growth` | 15 | 4 | 1,200 | 1,500 ج.م |
| `pro` | 40 | 10 | 5,000 | 3,500 ج.م |
| `enterprise` | 500 | 100 | 100,000 | بالتفاوض |

**أين تُفرض:**

| المورد | نقطة الفرض |
|---|---|
| المستخدمون | `POST /auth/users` |
| الفروع | `POST /branches` |
| تذاكر الشهر | `POST /tickets` |

**أولوية الحدود:** القيمة المخزَّنة في `organization.subscription` تتقدّم على قيمة الكتالوج — حتى تُحترم الاتفاقيات المخصّصة والتعديلات الإدارية. يُقرأ الاستخدام الفعلي لحظيًا من القاعدة (بلا عدّادات).

**عرض الاستخدام:** `GET /organizations` يُرجع:
```json
{
  "usage": {
    "activeUsers": 5, "activeBranches": 2, "monthlyTickets": 41,
    "plan": {
      "key": "starter", "nameAr": "المبتدئة", "priceEgp": 0,
      "users": { "used": 5, "limit": 5 },
      "branches": { "used": 2, "limit": 2 },
      "monthlyTickets": { "used": 41, "limit": 300 }
    }
  }
}
```

**رسالة التجاوز:**
```json
{
  "success": false,
  "error": {
    "code": "BUSINESS_RULE",
    "message": "وصلت للحد الأقصى لعدد المستخدمين في باقة «المبتدئة» (5). قم بترقية الباقة للمتابعة.",
    "details": { "resource": "users", "used": 5, "limit": 5, "plan": "المبتدئة", "code": "PLAN_LIMIT_REACHED" }
  }
}
```

### `GET /auth/me`
بيانات المستخدم + المؤسسة + الفروع المتاحة.

### `PATCH /auth/me` · `POST /auth/change-password`
تحديث الملف الشخصي / تغيير كلمة المرور.

### المصادقة الثنائية (2FA)

تفعيل اختياري لكل حساب ويُوصى به للمالك والمدير والمشرف (`recommended: true` لهذه الأدوار). تعتمد **TOTP (RFC 6238)** متوافقًا مع Google Authenticator وAuthy و1Password، مع 8 رموز استرداد تُعرض مرة واحدة فقط.

| الطريقة | المسار | الصلاحية | الوصف |
|---|---|---|---|
| POST | `/auth/2fa/verify` | عامة | إتمام الدخول بعد كلمة المرور برمز TOTP أو رمز استرداد |
| GET | `/auth/2fa/status` | مسجّل | حالة 2FA وعدد رموز الاسترداد المتبقية |
| POST | `/auth/2fa/setup` | مسجّل | بدء الإعداد: يُرجع السر ورابط `otpauth` وصورة QR (لا يفعّل بعد) |
| POST | `/auth/2fa/enable` | مسجّل | تأكيد رمز 6 أرقام وتفعيل 2FA + إرجاع رموز الاسترداد |
| POST | `/auth/2fa/disable` | مسجّل | إيقاف 2FA بكلمة المرور + TOTP أو رمز استرداد |
| POST | `/auth/2fa/recovery-codes` | مسجّل | تجديد رموز الاسترداد (يُلغي القديم) بكلمة المرور + TOTP |
| POST | `/auth/users/:id/2fa/reset` | `user:manage` | إعادة تعيين 2FA لمستخدم آخر عند فقد الهاتف والرموز |

**تدفق الدخول عند التفعيل:**
```json
// 1) POST /auth/login
{ "identifier": "owner", "password": "Owner@1234" }

// 200
{ "twoFactorRequired": true, "challengeToken": "...", "expiresIn": 300 }

// 2) POST /auth/2fa/verify
{ "challengeToken": "...", "code": "123456" }
// أو برمز استرداد: { "challengeToken": "...", "code": "A1B2-C3D4-E5F6" }

// 200: نفس رد الدخول الكامل
{ "accessToken": "...", "refreshToken": "...", "expiresIn": 900, "user": { "twoFactorEnabled": true }, "organization": {...} }
```

**بدء الإعداد والتفعيل:**
```json
// POST /auth/2fa/setup → 200
{
  "secret": "JBSWY3DPEHPK3PXP",
  "otpauthUri": "otpauth://totp/owner%40mobile-care-eg?secret=...&issuer=Mobile+Repair+OS&algorithm=SHA1&digits=6&period=30",
  "qrDataUrl": "data:image/png;base64,...",
  "message": "..."
}

// POST /auth/2fa/enable { "code": "123456" } → 200
{ "twoFactorEnabled": true, "recoveryCodes": ["A1B2-C3D4-E5F6", "... 8 رموز"], "message": "..." }
```

**حالة الأمان:** `GET /auth/2fa/status` → `{ enabled, enabledAt, recoveryCodesRemaining, recommended }`.

```json
// POST /auth/2fa/disable
{ "password": "Owner@1234", "code": "123456" }

// POST /auth/2fa/recovery-codes
{ "password": "Owner@1234", "code": "123456" }
```

**ضوابط أمنية:**

| الضابط | التفصيل |
|---|---|
| تشفير السر | AES-256-GCM بمفتاح مشتق من `TWO_FACTOR_ENCRYPTION_KEY` (أو `JWT_ACCESS_SECRET` عند تركه فارغًا)، ولا يُعاد بعد التفعيل |
| رموز الاسترداد | 8 رموز، تُخزَّن SHA-256 فقط، وكل رمز يُستهلك ذريًا في تحديث واحد (مرة واحدة) |
| توكن التحدي | صالح 5 دقائق، موقّع بمفتاح مشتق من مفتاح الوصول ونوع `2fa_challenge`، ولا يصلح كمصادقة على أي مسار |
| المحاولات الخاطئة | تُحتسب ضمن قفل الحساب: 8 محاولات ← قفل 15 دقيقة |
| الجلسات القديمة | توكنات التجديد الصادرة قبل تفعيل 2FA تُرفض بعد التفعيل، فتُجبر الأجهزة القديمة على إعادة الدخول |
| التدقيق | `two_factor_enabled` / `two_factor_disabled` / `two_factor_recovery_regenerated` مع إعادة تعيين الإدارة بدرجة `critical` |

> **ملاحظة تشغيلية:** إعادة تعيين 2FA بواسطة الإدارة هي المسار الوحيد للاستعادة عند فقد الهاتف وكل رموز الاسترداد. لا يستطيع المدير إعادة تعيين حساب نفسه — يستخدم الإيقاف العادي بكلمة المرور والرمز.

### `GET /auth/users` · `POST /auth/users` · `PATCH /auth/users/:id` · `DELETE /auth/users/:id`
إدارة المستخدمين (تحتاج `user:read` / `user:manage`). إعادة تعيين 2FA لمستخدم: `POST /auth/users/:id/2fa/reset`.

### `GET /auth/roles`
كتالوج الأدوار والصلاحيات.

---

## العملاء

| الطريقة | المسار | الصلاحية | الوصف |
|---|---|---|---|
| GET | `/customers` | `customer:read` | قائمة مع بحث وترقيم |
| GET | `/customers/lookup?phone=` | `customer:read` | بحث سريع بالهاتف + أجهزة العميل |
| GET | `/customers/:id` | `customer:read` | ملف كامل: أجهزة + سجل تذاكر + ملخص |
| POST | `/customers` | `customer:create` | إنشاء (يمنع تكرار الهاتف) |
| PATCH | `/customers/:id` | `customer:update` | تحديث |
| DELETE | `/customers/:id` | `customer:delete` | تعطيل منطقي (يُرفض مع تذاكر مفتوحة) |

**معاملات القائمة:** `q`, `type` (individual/company/reseller), `tags`, `isActive`, `isBlacklisted`, `page`, `limit`, `sort`

---

## الأجهزة وجواز الجهاز

| الطريقة | المسار | الصلاحية | الوصف |
|---|---|---|---|
| GET | `/devices` | `device:read` | قائمة ببحث (موديل، IMEI، سيريال) |
| GET | `/devices/problematic` | `device:read` | أجهزة تحتاج متابعة (3+ إصلاحات أو claim ضمان أو سوائل) |
| GET | `/devices/:id` | `device:read` | **جواز الجهاز:** تاريخ كامل + قطع + صور + claims |
| GET | `/devices/:id/suggested-parts` | `part:read` | قطع متوافقة مع الموديل |
| GET | `/devices/files` | `evidence:read` | ملفات الجهاز/التذكرة |
| POST | `/devices` | `device:create` | إضافة جهاز |
| PATCH | `/devices/:id` | `device:update` | تحديث |
| DELETE | `/devices/:id` | `device:delete` | تعطيل |

**رد جواز الجهاز:**
```json
{
  "device": { "brand": "...", "maskedImei": "...", "passport": { "totalRepairs": 3, "riskFlags": ["liquid_damage"] } },
  "customer": { "fullName": "...", "phone": "..." },
  "repairHistory": [{ "ticketNumber": "REP-2610-000012", "statusLabel": "تم التسليم", "cost": {...} }],
  "replacedParts": [{ "partId": { "name": "شاشة" }, "supplierId": { "name": "..." }, "warrantyExpiresAt": "..." }],
  "photos": [{ "url": "...", "stage": "before_repair" }],
  "warrantyClaims": [...],
  "timeline": [...],
  "summary": { "totalRepairs": 3, "totalSpentEgp": 4500, "openTickets": 1, "warrantyClaims": 1 }
}
```

---

## تذاكر الصيانة

| الطريقة | المسار | الصلاحية | الوصف |
|---|---|---|---|
| GET | `/tickets` | `ticket:read` | قائمة/بحث |
| GET | `/tickets/board` | `ticket:read` | لوحة Kanban مجمّعة بالحالة |
| GET | `/tickets/my-jobs` | `ticket:read` | مهام الفني الحالي |
| GET | `/tickets/sla-report` | `ticket:read` | إحصائيات الالتزام بالمواعيد |
| POST | `/tickets` | `ticket:create` | إنشاء (عميل/جهاز جديد أو موجود) |
| GET | `/tickets/:id` | `ticket:read` | تفاصيل كاملة + الانتقالات المتاحة |
| PATCH | `/tickets/:id` | `ticket:update` | تحديث |
| POST | `/tickets/:id/transition` | `ticket:transition` | **تغيير الحالة عبر محرّك الـworkflow** |
| POST | `/tickets/:id/assign` | `ticket:assign` | إسناد لفني |
| PUT | `/tickets/:id/diagnosis` | `diagnosis:write` | تسجيل التشخيص |
| POST | `/tickets/:id/notes` | `ticket:update` | ملاحظة |
| POST | `/tickets/:id/work-log` | `ticket:update` | بدء/إيقاف تسجيل الوقت |
| POST | `/tickets/:id/evidence` | `evidence:upload` | رفع صور/توقيع |
| GET | `/tickets/:id/timeline` | `ticket:read` | سلسلة الأحداث |
| POST | `/tickets/:id/parts` | `part:manage` | إضافة قطعة (تحجز من المخزون) |
| PATCH | `/tickets/:id/parts/:partId` | `part:manage` | تحديث حالة القطعة |
| DELETE | `/tickets/:id/parts/:partId` | `part:manage` | إزالة القطعة |
| POST | `/tickets/:id/labor` | `ticket:update` | بند مصنعية |
| DELETE | `/tickets/:id/labor/:laborId` | `ticket:update` | حذف بند |

**معاملات القائمة:** `q`, `status` (CSV), `priority` (CSV), `customerId`, `deviceId`, `technicianId` (`unassigned` للبدون فني), `openOnly`, `slaBreached`, `from`, `to`

### إنشاء تذكرة آمن التكرار (طابور Offline)
أرسل `clientRequestId` اختياريًا في جسم الطلب: نص من 8 إلى 120 حرفًا (يُفضَّل UUID جديد لكل تذكرة). يُخزَّن مع فهرس فريد `(organizationId, clientRequestId)` ويجعل إعادة الإرسال آمنة:

- أول طلب ينشئ العميل/الجهاز/التذكرة كالمعتاد ويعيد **201** مع `{ ticket, trackingUrl }`.
- إعادة إرسال **نفس المفتاح من نفس المستخدم** تُرجع نفس التذكرة برمز **200** دون أي كتابة جديدة، مع `idempotentReplay: true`.
- الطلبات المتزامنة بنفس المفتاح: الفهرس الفريد يحسم السباق، والطلب الخاسر يعيد التذكرة القائمة بدل خطأ.
- المفتاح يُفحص قبل حدود الباقة وقبل إنشاء العميل/الجهاز، فلا تُحتسب محاولة مكررة على حد التذاكر الشهري.
- بدون المفتاح يعمل السلوك القديم كما هو. لا تُعِد استخدام مفتاح تذكرة أخرى.

### مثال: إنشاء تذكرة بجهاز وعميل جديدين
```json
POST /tickets
{
  "clientRequestId": "8f14e45f-ceea-467f-a8d0-3b1f0f2d9a21",
  "newCustomer": { "fullName": "أحمد محمد", "phone": "01012345678" },
  "newDevice": { "brand": "Samsung", "model": "Galaxy A15", "imei": "350000000000001", "conditionOnIntake": "good" },
  "priority": "high",
  "intake": {
    "complaint": "الشاشة مكسورة واللمس لا يعمل",
    "complaintCategory": "display",
    "accessories": ["sim_tray"],
    "customerAcknowledged": true,
    "dataLossDisclaimerAccepted": true
  }
}
```

### مثال: تغيير الحالة
```json
POST /tickets/:id/transition
{ "status": "repairing", "note": "تم استلام موافقة العميل هاتفيًا", "station": "طاولة 2" }
```
**احتمالات الرفض:**
- `INVALID_TRANSITION` إذا لم يكن الانتقال في خريطة دورة العمل.
- `BUSINESS_RULE` إذا لم يكن هناك عرض سعر معتمد (قبل الإصلاح)، أو فحص جودة ناجح (قبل التجهيز)، أو سداد كامل (قبل التسليم).

### حالات دورة العمل
`received` → `intake` → `inspection` → `diagnosis` → `estimate` → `waiting_approval` → `approved` → `waiting_part` → `repairing` → `testing_qc` → `ready` → `customer_notified` → `paid` → `delivered` → `warranty`
+ جانبية: `cancelled`, `unrepairable`

---

## عروض السعر والموافقات

| الطريقة | المسار | الصلاحية | الوصف |
|---|---|---|---|
| GET | `/estimates` | `estimate:read` | قائمة |
| POST | `/estimates` | `estimate:write` | إنشاء إصدار جديد |
| GET | `/estimates/:id` | `estimate:read` | التفاصيل + الموافقات |
| PATCH | `/estimates/:id` | `estimate:write` | تعديل (مرفوض بعد الاعتماد) |
| POST | `/estimates/:id/send` | `estimate:write` | إرسال للعميل + نقل التذكرة لانتظار الموافقة |
| POST | `/estimates/:id/decide` | `estimate:approve` | تسجيل قرار العميل |

**إنشاء عرض:**
```json
POST /estimates
{
  "ticketId": "...",
  "lines": [
    { "kind": "part", "partId": "...", "description": "شاشة A15", "quantity": 1, "unitPriceEgp": 2200, "warrantyDays": 90 },
    { "kind": "labor", "description": "مصنعية تغيير شاشة", "quantity": 1, "unitPriceEgp": 450, "warrantyDays": 14 }
  ],
  "discountEgp": 100,
  "estimatedDurationHours": 6,
  "warrantyOfferedDays": 60,
  "terms": "الضمان لا يشمل الكسر أو السوائل"
}
```

**تسجيل القرار:**
```json
POST /estimates/:id/decide
{
  "decision": "partially_approved",
  "approvedLineIds": ["<lineId1>"],
  "channel": "whatsapp",
  "customerComment": "موافق على الشاشة فقط",
  "otpVerified": true
}
```
`decision`: `approved` | `partially_approved` | `rejected` | `no_response`

---

## قطع الغيار والمخزون

| الطريقة | المسار | الصلاحية | الوصف |
|---|---|---|---|
| GET | `/parts` | `part:read` | كتالوج ببحث وتصفية |
| GET | `/parts/low-stock` | `part:read` | نواقص تحت حد إعادة الطلب |
| GET | `/parts/consumption-report` | `report:read` | تقييم الاستهلاك والهامش ومعدل الفشل |
| GET | `/parts/:id` | `part:read` | تفاصيل + دفعات + حركات + رصيد كل فرع |
| POST | `/parts` | `part:manage` | إضافة قطعة (+ رصيد افتتاحي) |
| PATCH | `/parts/:id` | `part:manage` | تحديث |
| DELETE | `/parts/:id` | `part:manage` | تعطيل |
| GET | `/suppliers` | `supplier:read` | الموردون |
| GET | `/suppliers/performance` | `report:read` | أداء الموردين ومعدل العيوب |
| POST | `/suppliers` · PATCH · DELETE | `supplier:manage` | إدارة الموردين |
| GET | `/inventory/stock` | `stock:read` | أرصدة الفروع |
| GET | `/inventory/valuation` | `report:read` | تقييم المخزون (كمية × تكلفة/بيع) لكل فرع |
| GET/POST | `/inventory/counts` | `stock:read`/`stock:move` | عمليات الجرد وبدء جرد جديد |
| GET | `/inventory/counts/:id` | `stock:read` | تفاصيل الجرد وفروقاته |
| POST | `/inventory/movements` | `stock:move` | حركة مخزون |
| GET | `/inventory/movements` | `stock:read` | سجل الحركات |
| POST | `/inventory/adjust` | `stock:move` | جرد فعلي |
| GET/POST | `/inventory/transfers` | `stock:read`/`stock:move` | تحويلات الفروع |
| POST | `/inventory/transfers/:id/send` · `/receive` | `stock:move` | إرسال/استلام التحويل |

**حركة مخزون:**
```json
POST /inventory/movements
{ "partId": "...", "type": "purchase_in", "quantity": 5, "unitCostEgp": 1000, "batchCode": "B-2024-01" }
```
`type`: `purchase_in` | `sale_out` | `repair_consume` | `repair_return` | `transfer_out` | `transfer_in` | `adjustment_in` | `adjustment_out` | `defective_in` | `defective_out` | `reserve` | `release` | `initial`

> يُمنع أي حركة تُنتج رصيدًا سالبًا (`BUSINESS_RULE`)، وتُسجَّل كل حركة مع الأرصدة قبل/بعد.

**جرد فعلي:**
```json
POST /inventory/counts
{
  "branchId": "...",
  "lines": [{ "partId": "...", "countedOnHand": 7, "note": "فرق 2 قطعة" }],
  "notes": "جرد أسبوعي"
}
```
يقارن الكمية المعدودة برصيد الفرع في لحظة الإنشاء، ثم يسجّل حركة تسوية (`adjustment_in/out`) لكل فرق تلقائيًا.

**تقييم المخزون:** `GET /inventory/valuation?branchId=` يعيد لكل فرع: عدد القطع، الموجود، المحجوز، التالف، قيمة التكلفة، قيمة البيع، والهامش المحتمل.

---

## المشتريات والموردون

| الطريقة | المسار | الصلاحية | الوصف |
|---|---|---|---|
| GET | `/purchases` | `purchase:read` | أوامر الشراء (تصفية بالحالة/المورد/الفرع) |
| POST | `/purchases` | `purchase:manage` | إنشاء أمر شراء (مسودة) |
| GET | `/purchases/:id` | `purchase:read` | التفاصيل |
| PATCH | `/purchases/:id` | `purchase:manage` | تعديل المسودة فقط |
| POST | `/purchases/:id/order` | `purchase:manage` | اعتماد الأمر (draft → ordered) |
| POST | `/purchases/:id/receive` | `purchase:receive` | استلام كلي/جزئي (يدخل المخزون + تحديث التكلفة) |
| POST | `/purchases/:id/cancel` | `purchase:manage` | إلغاء (ممنوع بعد استلام كامل أو مع وجود مدفوعات) |
| GET | `/purchases/payables` | `purchase:read` | أعمار الدائنين وأرصدة الموردين |
| POST | `/purchases/payments` | `supplier_payment:record` | سداد على الحساب أو على أمر شراء |
| POST | `/purchases/:id/payments` | `supplier_payment:record` | سداد مرتبط بأمر الشراء |

**استلام أمر شراء:**
```json
POST /purchases/:id/receive
{
  "lines": [{ "lineId": "...", "receivedQty": 3, "batchCode": "B-2026-11", "unitCostEgp": 980 }],
  "notes": "استلام جزئي"
}
```
- الكمية المستلمة لا تتجاوز المتبقي في البند.
- تُنشأ دفعة مخزون (`StockBatch`) وتُسجَّل حركة `purchase_in` لكل بند.
- يُحدّث `Part.pricing.lastCostEgp` من تكلفة الاستلام.

**سداد مورد:**
```json
POST /purchases/payments
{ "supplierId": "...", "purchaseOrderId": "...", "amountEgp": 5000, "method": "bank_transfer", "reference": "TRX-991" }
```
`purchaseOrderId` اختياري: بدونه يُسجَّل على حساب المورد العام. يُرفض السداد فوق المتبقي على الأمر.

---

## فحص الجودة

| الطريقة | المسار | الصلاحية | الوصف |
|---|---|---|---|
| GET | `/quality-checks` | `qc:read` | سجلات الفحص |
| GET | `/quality-checks/stats` | `report:read` | نسبة الاجتياز من أول مرة + أداء الفنيين |
| POST | `/quality-checks` | `qc:perform` | بدء فحص (قائمة افتراضية أو مخصصة) |
| GET | `/quality-checks/:id` | `qc:read` | تفاصيل الفحص |
| POST | `/quality-checks/:id/submit` | `qc:perform` | تسجيل النتيجة |

**تسجيل النتيجة:**
```json
POST /quality-checks/:id/submit
{
  "items": [{ "key": "display", "result": "pass", "notes": "" }],
  "measurements": { "batteryHealthPct": 92, "bootTimeSeconds": 22 },
  "notes": "الفحص مكتمل",
  "advanceTicket": true
}
```
- البنود **الإلزامية** يجب تحديدها، وإلا يُرفض الطلب.
- أي بند إلزامي `fail` ← الرسوب وإعادة الجهاز للإصلاح تلقائيًا.
- الاجتياز مع `advanceTicket: true` ينقل التذكرة إلى `ready`.

---

## الضمان

| الطريقة | المسار | الصلاحية | الوصف |
|---|---|---|---|
| GET | `/warranty/claims` | `warranty:read` | claims الضمان |
| POST | `/warranty/claims` | `warranty:manage` | فتح claim (ينشئ تذكرة عودة اختياريًا) |
| GET | `/warranty/claims/:id` | `warranty:read` | التفاصيل |
| POST | `/warranty/claims/:id/decide` | `warranty:manage` | قرار الضمان |
| GET | `/warranty/intelligence` | `analytics:read` | معدل العودة حسب العطل/الفني/الموديل |
| GET | `/warranty/failing-parts` | `analytics:read` | القطع الأكثر فشلًا |
| GET | `/warranty/supplier-quality` | `analytics:read` | جودة الموردين |

**فتح claim:**
```json
POST /warranty/claims
{
  "originalTicketId": "...",
  "symptom": "اللمس رجع يفصل بعد أسبوع",
  "coverage": "both",
  "isSameFault": true,
  "faultCategory": "display",
  "misuseSuspected": false,
  "createNewTicket": true,
  "priority": "high"
}
```
يُرفض إذا لم تكن التذكرة الأصلية مُسلَّمة، أو إذا وُجد claim مفتوح بالفعل.

---

## الفواتير والمدفوعات والمصروفات والورديات ونقاط البيع

| الطريقة | المسار | الصلاحية | الوصف |
|---|---|---|---|
| GET | `/finance/summary` | `report:read` | ملخص مالي (إيراد، مصروفات، ربح، مستحقات) |
| GET | `/finance/invoices` | `invoice:read` | الفواتير |
| POST | `/finance/invoices` | `invoice:write` | إصدار فاتورة (يدويًا أو من التذكرة) |
| GET | `/finance/invoices/:id` | `invoice:read` | التفاصيل + المدفوعات |
| GET | `/finance/invoices/:id/pdf` | `invoice:read` | فاتورة PDF عربية RTL + QR ضريبي (تُسجَّل في التدقيق) |
| POST | `/finance/invoices/:id/void` | `invoice:write` | إلغاء (يُرفض إذا مدفوعة) |
| GET | `/finance/payments` | `payment:read` | المدفوعات |
| POST | `/finance/payments` | `payment:record` | تحصيل/استرداد |
| GET/POST/PATCH/DELETE | `/finance/expenses` | `expense:read`/`manage` | المصروفات |
| GET | `/finance/shifts` | `shift:read` | سجل الورديات مع المتوقع/المعدود/الفرق |
| GET | `/finance/shifts/current` | `shift:read` | الوردية المفتوحة للفرع مع ملخص النقد والحركات غير المرتبطة |
| GET | `/finance/shifts/:id` | `shift:read` | تفاصيل وردية ومدفوعاتها ومصروفاتها |
| POST | `/finance/shifts/open` | `shift:manage` | فتح وردية (وردية مفتوحة واحدة لكل فرع) |
| POST | `/finance/shifts/:id/close` | `shift:manage` | إغلاق الوردية بمطابقة النقد المعدود |
| POST | `/finance/pos/sale` | `pos:operate` | بيع مباشر |

**فاتورة من التذكرة (تنشئ بنودًا من القطع والمصنعية):**
```json
POST /finance/invoices
{ "ticketId": "...", "buildFromTicket": true, "issueNow": true }
```

**تحصيل:**
```json
POST /finance/payments
{ "invoiceId": "...", "method": "instapay", "amountEgp": 500, "reference": "IPN-12345" }
```
- يُحدّث الفاتورة والتذكرة تلقائيًا.
- عند السداد الكامل لتذكرة `ready` → انتقال تلقائي إلى `paid`.
- إشعار العميل بالتحصيل.

**تحميل الفاتورة PDF:**
```http
GET /finance/invoices/:id/pdf
Authorization: Bearer <token>
x-branch-id: <branchId>
```
- يُولَّد على الخادم بـPDFKit وخط Cairo المرفق؛ لا يحتاج متصفحًا أو Chromium.
- تخطيط عربي RTL مع dithering للكلمات المختلطة (عربي/لاتيني/أرقام) دون كسر تشكيل الحروف.
- QR يحمل خمسة حقول TLV/base64: اسم البائع، الرقم الضريبي، تاريخ الإصدار، الإجمالي، الضريبة.
  هذا تنسيق بيانات ضريبية شائع، وليس توقيعًا أو إرسالًا لمنظومة ETA؛ الربط الرسمي خطوة منفصلة.
- كل تنزيل يُسجَّل في سجل التدقيق (`action=export`, `resource=Invoice`).
- الصلاحية `invoice:read` مع احترام عزل الفرع؛ الرد `application/pdf` و`Cache-Control: private, no-store`.

**الورديات والخزينة:**
```json
POST /finance/shifts/open
{ "openingCashEgp": 500, "notes": "وردية صباحية" }
```
- المدفوعات النقدية والمصروفات النقدية تُربط تلقائيًا بالوردية المفتوحة للفرع وقت الحركة؛ الحركات بتاريخ سابق لفتح الوردية لا تُربط.
- `expectedCashEgp` = رصيد الافتتاح + النقد الداخل − النقد الخارج − المصروفات النقدية.
- الإغلاق يسجّل `countedCashEgp` و`varianceEgp`، وبعده يُمنع تعديل أو حذف مصروفات الوردية.
- المستخدم المركزي يختار الفرع عبر `branchId` في جسم الفتح أو `x-branch-id`؛ موظف الفرع محصور في فرعه.

**بيع نقاط البيع:**
```json
POST /finance/pos/sale
{
  "customerPhone": "01012345678",
  "items": [{ "partId": "...", "description": "شاشة حماية", "quantity": 1, "unitPriceEgp": 150 }],
  "paymentMethod": "cash",
  "amountPaidEgp": 200,
  "discountEgp": 0
}
```
يخصم المخزون أولًا، ثم يصدر الفاتورة والدفعة.
> البيع يتطلب تحديد فرع نشط عبر `x-branch-id` (أو ربط مستخدم بفرع واحد)؛ الكميات المعروضة والمخصومة هي رصيد هذا الفرع تحديدًا. الضريبة تُحسب وفق `settings.taxInclusive` في المؤسسة.

**التقارير المالية وكشوف الحسابات:**
| الطريقة | المسار | الصلاحية | الوصف |
|---|---|---|---|
| GET | `/finance/reports/profit-loss?from=&to=` | `report:read` | إيراد، تكلفة قطع، مصروفات، صافي ربح |
| GET | `/finance/reports/vat?from=&to=` | `report:read` | ضريبة المخرجات/المدخلات والصافي |
| GET | `/finance/reports/aging` | `report:read` | أعمار المستحقات (0–30/31–60/61–90/+90) |
| GET | `/finance/reports/cashier?from=&to=` | `report:read` | تحصيل حسب طريقة الدفع والكاشير |
| GET | `/finance/customers/:id/statement` | `payment:read` | كشف حساب عميل (فواتير + مدفوعات + رصيد) |
| GET | `/finance/suppliers/:id/statement` | `purchase:read` | كشف حساب مورد (أوامر شراء + مدفوعات + رصيد) |

كل التقارير تحترم نطاق الفرع النشط تلقائيًا عند إرسال `x-branch-id`.

---

## التحليلات

| الطريقة | المسار | الوصف |
|---|---|---|
| GET | `/analytics/dashboard?period=` | مؤشرات لوحة التحكم |
| GET | `/analytics/trends?period=` | اتجاه يومي (30–180 يومًا) + شهري |
| GET | `/analytics/status-distribution?period=` | توزيع التذاكر على الحالات |
| GET | `/analytics/fault-analysis?period=` | أكثر الأعطال + الموديلات + الخطورة |
| GET | `/analytics/turnaround?period=` | **متوسط زمن كل مرحلة** + الالتزام بالمواعيد |
| GET | `/analytics/pilot-kpis?period=` | **مؤشرات نجاح التجربة** (7 مؤشرات مقابل أهداف) |
| GET | `/analytics/sources?period=` | التذاكر حسب مصدرها |
| GET | `/analytics/technicians/performance?period=` | أداء الفنيين (تذاكر، زمن، QC، عوائد ضمان) |
| GET | `/analytics/branches/performance?period=` | أداء الفروع (تذاكر، إيراد، تحصيل، مستحقات) |

`period`: `today` | `week` | `month` | `quarter` | `year` | `last30` — أو `from`/`to` صريحين.

**مؤشرات Pilot المُقاسة:**
| المؤشر | الهدف | ملاحظة |
|---|---|---|
| نسبة الأجهزة الموثقة بصور استلام | 90% | ↑ أفضل |
| نسبة الإقرار/التوقيع | 80% | ↑ أفضل |
| نسبة الموافقة على عروض الإصلاح | 65% | ↑ أفضل |
| معدل عودة الضمان | 5% | ↓ أفضل |
| نسبة اجتياز QC من أول مرة | 85% | ↑ أفضل |
| دقة المخزون | 95% | ↑ أفضل |
| متوسط عمر التذاكر المفتوحة | 48 ساعة | ↓ أفضل |

---

## المؤسسة والفروع والفنيون

| الطريقة | المسار | الصلاحية | الوصف |
|---|---|---|---|
| GET | `/organizations` | `org:read` | بيانات المركز + الفروع + حدود الباقة |
| PATCH | `/organizations` | `org:update` | تحديث البيانات والإعدادات والسياسات |
| GET | `/organizations/subscription/plans` | `org:read` | كتالوج الباقات وأعلام السياسة (`selfService` / `trialOnly` / `customPricing`) |
| POST | `/organizations/subscription/change-plan` | `org:update` | تغيير الباقة (الذاتي لـ growth/pro فقط — المؤسسية عبر المنصة) |
| POST | `/organizations/subscription/activate` | `org:update` | تفعيل/تجديد بعد دفع خارج المنصة — `paymentMethod` + `paymentReference` إلزاميان ويُسجَّلان في سجل المدفوعات |
| GET | `/organizations/subscription/payments` | `org:update` | سجل مدفوعات اشتراك المركز |
| GET/POST | `/organizations/subscription/renewal-requests` | `org:update` | طلبات التجديد — طلب معلّق واحد لكل مركز (متاح في وضع القراءة فقط) |
| GET | `/organizations/backup/export` | `org:update` | نسخة JSON كاملة لبيانات المركز |
| GET | `/branches` | `branch:read` | الفروع |
| POST/PATCH/DELETE | `/branches` | `branch:manage` | إدارة الفروع (يُفرض حد الباقة) |
| GET | `/technicians` | `technician:read` | الفنيون مع الحمل الحالي |
| GET | `/technicians/available` | `technician:read` | مرتبون حسب الأقل تحميلًا؛ مع فرع نشط تُقصر القائمة على فنييه، والحمل يُحسب عبر كل فروعه ليطابق سقف الإسناد |
| GET | `/technicians/performance` | `analytics:read` | أدائهم التفصيلي |

**سياسة الاشتراك:**
- `starter` تجربة 14 يومًا فقط — لا تُباع ولا يمكن تفعيلها بعد انتهاء التجربة.
- `growth` و`pro` تفعيل ذاتي من مالك المركز (`org:update`) بعد سداد خارج المنصة؛ الدفعة (طريقة + مرجع) تُسجَّل إلزاميًا في `SubscriptionPayment`.
- `enterprise` من إدارة المنصة فقط بتسعير مخصص.
- عند الانتهاء تُمنح مهلة سداد `SUBSCRIPTION_GRACE_DAYS` (افتراضي 7 أيام) يظل فيها المركز يعمل، ثم يتحوّل لوضع قراءة فقط مع بقاء مسارات الاشتراك/الفوترة متاحة للتفاعل.
- تذكيرات تلقائية قبل الانتهاء حسب `SUBSCRIPTION_REMINDER_DAYS` (افتراضي `7,3,1`) — مرة واحدة لكل يوم لكل دورة.

**إدارة المنصة (دور `platform` فقط):**
| الطريقة | المسار | الوصف |
|---|---|---|
| GET | `/platform/organizations` | كل المراكز مع حالة الاشتراك والاستخدام |
| GET | `/platform/stats` | إحصاءات المنصة (MRR، توزيع الحالات) |
| GET | `/platform/organizations/:id` | تفاصيل مركز |
| PATCH | `/platform/organizations/:id/status` | إيقاف/تفعيل مركز |
| POST | `/platform/organizations/:id/subscription/activate` | تفعيل اشتراك مركز (دفعة اختيارية للمنح/التسويات، سعر مخصص، وباقة enterprise) |
| POST | `/platform/organizations/:id/subscription/change-plan` | تغيير باقة مركز (يشمل enterprise بسعر مخصص) |
| GET | `/platform/plans` | كتالوج الباقات الكامل |
| GET | `/platform/revenue?from=&to=&plan=&method=` | تقرير إيرادات الاشتراكات: المحصّل، التوزيع حسب الباقة/الطريقة، آخر المدفوعات |
| GET | `/platform/renewal-requests?status=&plan=` | طلبات التجديد (افتراضيًا المعلّقة) |
| POST | `/platform/renewal-requests/:id/approve` | اعتماد الطلب: تفعيل الباقة + تسجيل دفعة مرتبطة بالطلب |
| POST | `/platform/renewal-requests/:id/reject` | رفض الطلب بسبب إلزامي + إشعار مالكي المركز |
| GET/POST | `/platform/backups` · `/platform/backups/run` | قائمة/تشغيل نسخة احتياطية |
| GET/POST | `/platform/backups/:file/download` · `/restore` | تنزيل/استعادة نسخة |

**سياسات قابلة للتعديل في `PATCH /organizations`:**
```json
{
  "settings": {
    "taxRate": 14,
    "taxInclusive": true,
    "defaultWarrantyDays": 30,
    "partsWarrantyDays": 90,
    "laborWarrantyDays": 14,
    "requireApprovalBeforeRepair": true,
    "requireIntakePhotos": true,
    "requireQcBeforeReady": true,
    "defaultSlaHours": 72,
    "whatsappEnabled": false
  }
}
```

---

## الإشعارات وسجل التدقيق وقاعدة المعرفة

| الطريقة | المسار | الصلاحية | الوصف |
|---|---|---|---|
| GET | `/notifications` | `notification:read` | سجل الإشعارات |
| POST | `/notifications/send` | `notification:send` | إرسال رسالة مخصصة |
| POST | `/notifications/:id/read` · `/read-all` | — | تعليم كمقروء |
| GET | `/audit-logs` | `audit:read` | سجل التدقيق (تصفية بالفاعل، المورد، الخطورة، التاريخ) |
| GET | `/audit-logs/:resource/:resourceId` | `audit:read` | تدقيق عنصر بعينه |
| GET | `/knowledge` | `knowledge:read` | مقالات المعرفة |

**مزوّد الرسائل (WhatsApp/SMS):**
- الافتراضي `WHATSAPP_MODE=log` و`SMS_MODE=log`: يُحفظ الإشعار في قاعدة البيانات ويُسجَّل محليًا دون استدعاء خارجي.
- `WHATSAPP_MODE=cloud-api`: يتطلب `WHATSAPP_PHONE_NUMBER_ID` و`WHATSAPP_ACCESS_TOKEN` و`WHATSAPP_API_VERSION`.
  - واتساب يحوّل الأرقام المصرية المحلية تلقائيًا إلى صيغة `2010...`.
  - عند وجود قالب معتمد في `WHATSAPP_TEMPLATE_MAP` يُرسل كقالب Meta مع وسائطه؛ وإلا يُرسل نصًا حرًا (مسموح داخل نافذة 24 ساعة فقط).
  - مثال: `WHATSAPP_TEMPLATE_MAP={"ready_for_pickup":{"name":"repair_ready","language":"ar","params":["customerName","device","total","ticketNumber"]}}`
- `SMS_MODE=http`: يرسل `POST` JSON إلى `SMS_API_URL` بالشكل `{ "to": "01...", "message": "...", "sender": "..." }` مع `Authorization: Bearer SMS_API_KEY`.
- تُعاد المحاولة عند أخطاء الشبكة و`408/429/5xx` حتى `NOTIFICATION_MAX_ATTEMPTS` (افتراضي 3) مع حفظ `attempts` و`errorMessage` و`providerMessageId` على الإشعار.
| GET | `/knowledge/suggest?symptom=&model=&brand=` | `knowledge:read` | **اقتراحات تشخيص** بخطوات وأسباب ونتائج تاريخية |
| POST | `/knowledge` · PATCH | `knowledge:write` | إنشاء/تحديث مقال |
| POST | `/knowledge/:id/outcome` | `knowledge:write` | تسجيل نجاح/فشل تطبيق المقال |

---

## ماركت بلس وبورصة الأسعار

**الصلاحيات:** `market:read` للقراءة، `market:manage` للنشر وإدارة الإعلانات والعروض. إعلانات السوق العام يمر نشرها بمراجعة المنصة (`market:moderate`)، ودليل الأسعار تديره المنصة (`market:prices:manage`).

### الإعلانات

| الطريقة | المسار | الصلاحية | الوصف |
|---|---|---|---|
| GET | `/market/stats` | `market:read` | عدادات السوق (عام/داخلي/بانتظار المراجعة/عروض واردة ومرسلة) |
| GET | `/market/listings?scope=public\|internal&q=&category=&condition=&kind=&governorate=&minPrice=&maxPrice=&sort=&page=` | `market:read` | تصفح السوق |
| GET | `/market/my/listings` | `market:read` | إعلانات مركزك بكل الحالات |
| POST | `/market/listings` | `market:manage` | إنشاء إعلان (عام أو داخلي) |
| GET | `/market/listings/:id` | `market:read` | تفاصيل إعلان + عروضه إن كنت مالكه |
| PATCH | `/market/listings/:id` | `market:manage` | تعديل إعلان مركزك |
| DELETE | `/market/listings/:id` | `market:manage` | حذف/سحب الإعلان (مع `reason` اختياري) |
| POST | `/market/listings/:id/images` | `market:manage` | رفع حتى 6 صور (multipart: `files`) |
| DELETE | `/market/listings/:id/images/:fileId` | `market:manage` | حذف صورة |
| POST | `/market/listings/:id/mark-sold` | `market:manage` | تأكيد البيع (`soldPriceEgp` اختياري) |
| POST | `/market/listings/:id/reopen` | `market:manage` | إعادة فتح إعلان محجوز/مباع |

```json
POST /market/listings
{
  "scope": "public",
  "kind": "sell",
  "category": "smartphone",
  "title": "آيفون 13 128 جيجا حالة ممتازة",
  "description": "بطارية 89% مع العلبة والشاحن",
  "brand": "Apple",
  "model": "iPhone 13",
  "storage": "128GB",
  "ram": "4GB",
  "color": "أزرق",
  "condition": "excellent",
  "batteryHealth": 89,
  "priceEgp": 15500,
  "negotiable": true,
  "quantity": 1,
  "expiresInDays": 30,
  "contactName": "أحمد المصري",
  "contactPhone": "01012345678"
}
```

**الحالات:** `pending_review` (عام بانتظار المراجعة) → `active` (نشط) → `reserved` (محجوز بعد قبول عرض) → `sold` (مباع) / `rejected` (مرفوض بسبب) / `expired` (منتهي) / `removed` (محذوف).

- الإعلان الداخلي يُنشر فورًا بين فروع المركز، والعام ينتظر اعتماد المنصة.
- تعديل إعلان عام نشط أو رفع صور جديدة يعيده إلى `pending_review`.
- تأكيد البيع من `active` أو `reserved`، ويرفض تلقائيًا كل العروض المعلّقة الأخرى.
- لا يمكن تقديم عرض على إعلان مركزك العام، ويُسمح بالعرض بين فروع المركز على الإعلانات الداخلية فقط.
- الصور تُخزَّن معزولة لكل مؤسسة وتُعرض بروابط موقّعة صالحة أسبوعًا.

### العروض

| الطريقة | المسار | الصلاحية | الوصف |
|---|---|---|---|
| GET | `/market/my/offers` | `market:read` | العروض التي أرسلتها |
| GET | `/market/listings/:id/offers` | `market:manage` | العروض الواردة على إعلاناتك |
| POST | `/market/listings/:id/offers` | `market:manage` | تقديم عرض (`amountEgp`، `quantity`، `message`) |
| PATCH | `/market/offers/:id` | `market:manage` | قرار على العرض: `accept` / `reject` / `withdraw` مع `note` |

- عرض معلّق واحد فقط لكل (إعلان + فرع مشترٍ)؛ التكرار يعيد `CONFLICT`.
- البائع يقبل العرض فتُحجز الكمية/الإعلان ذريًا وتُرفض بقية العروض المعلّقة، أو يرفض مع ملاحظة.
- المشتري يسحب عرضه ما دام معلّقًا.
- عند القبول يظهر التواصل بين الطرفين داخل الإعلان؛ الدفع والتسليم **خارج النظام** ولا يتحمل النظام مسؤولية الصفقة.
- كل حدث (عرض/قبول/رفض/اعتماد/رفض إعلان) ينتج إشعارًا داخليًا للأطراف المعنية.

### البورصة والتقييم

| الطريقة | المسار | الصلاحية | الوصف |
|---|---|---|---|
| GET | `/market/prices?condition=used&grade=good&brand=Apple&model=iPhone%2013&storage=128GB&q=` | `market:read` | صفوف السوق: دليل المنصة + مؤشر الإعلانات لكل موديل/سعة/حالة |
| GET | `/market/prices/valuation?brand=Apple&model=iPhone%2013&storage=128GB&condition=used&grade=good` | `market:read` | تقييم جهاز بسعر مقترح ونطاق وثقة |

**مصدران يُدمجان:**
1. **دليل المنصة** — صف لكل (ماركة/موديل/سعة/حالة/تصنيف) مع حد أدنى ومتوسط وأعلى، تديره المنصة من `/platform/prices`.
2. **مؤشر السوق** — متوسط الإعلانات العامة النشطة/المحجوزة من نوع «بيع» لنفس المفتاح، ولا يُحتسب حتى تصل العينة إلى **3 إعلانات**.

عند توفر المصدرين: `المتوسط المدمج = 60% دليل + 40% مؤشر`. لكل حالة مستعمل معامل (كالجديد/ممتاز/جيد/مقبول/تالف)، والسعر المقترح يُقرَّب لأقرب 50 جنيهًا. غياب البيانات يرجع `available: false` مع رسالة توضح المطلوب.

**أمثلة:**
```json
GET /market/prices/valuation?brand=Apple&model=iPhone%2013&storage=128GB&condition=used&grade=good

{
  "available": true,
  "guide": { "avgEgp": 15000, "factor": 1, "basis": "base" },
  "market": { "avgEgp": 14167, "count": 3 },
  "valuation": {
    "lowEgp": 12800,
    "avgEgp": 14650,
    "highEgp": 17000,
    "suggestedPriceEgp": 14650,
    "confidence": "high",
    "basis": ["سعر دليل المنصة", "مؤشر إعلانات السوق"]
  }
}
```

### مسارات المنصة

| الطريقة | المسار | الصلاحية | الوصف |
|---|---|---|---|
| GET | `/platform/market/stats` | `market:moderate` | عدادات المراجعة |
| GET | `/platform/market/listings?status=pending_review` | `market:moderate` | كل الإعلانات العامة عبر المراكز |
| POST | `/platform/market/listings/:id/approve` | `market:moderate` | اعتماد النشر |
| POST | `/platform/market/listings/:id/reject` | `market:moderate` | رفض مع `reason` إلزامي (3–500 حرف) |
| GET | `/platform/market/prices` | `market:prices:manage` | دليل الأسعار |
| POST | `/platform/market/prices` | `market:prices:manage` | إنشاء/تحديث صف بالمسار الفريد (upsert) |
| PATCH | `/platform/market/prices/:id` | `market:prices:manage` | تعديل صف |
| DELETE | `/platform/market/prices/:id` | `market:prices:manage` | تعطيل الصف (لا حذف فيزيائي) |

---

## بوابة العميل (عامة — بلا تسجيل دخول)

| الطريقة | المسار | الوصف |
|---|---|---|
| GET | `/public/track/:token` | حالة التذكرة، التكاليف، الضمان، الصور، العروض، الأحداث |
| POST | `/public/track/:token/decide` | **موافقة/رفض رقمي** على عرض السعر |
| GET | `/public/track/:token/contact` | بيانات التواصل مع المركز |

**الخصوصية:** الاسم والهاتف والـIMEI مقنّعة، لا ملاحظات داخلية، لا بيانات مستخدمين، لا مستندات حساسة.

**قرار العميل:**
```json
POST /public/track/:token/decide
{ "decision": "approved", "comment": "موافق" }
```
يُسجَّل مع عنوان الـIP وUser-Agent كإثبات، ويُنقل العرض والتذكرة تلقائيًا.

---

## فحص الصحة والفهرس

| الطريقة | المسار | الوصف |
|---|---|---|
| GET | `/health` | حالة الخدمة وقاعدة البيانات |
| GET | `/api/v1/meta/endpoints` | فهرس مجموعات نقاط النهاية |
