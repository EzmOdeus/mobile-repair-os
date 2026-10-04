# مرجع الـAPI

يمكن تصفح وتجربة النقاط من واجهة Swagger على `http://localhost:4000/docs` بعد تشغيل الـAPI. مصدر OpenAPI المستخدم للواجهة في [openapi.yaml](openapi.yaml).

**القاعدة:** `http://localhost:4000/api/v1`
**المصادقة:** `Authorization: Bearer <accessToken>`
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
    "user": { "id": "...", "fullName": "أحمد محمد", "username": "ahmed", "role": "owner", "permissions": ["...54 صلاحية"] },
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

### `GET /auth/users` · `POST /auth/users` · `PATCH /auth/users/:id` · `DELETE /auth/users/:id`
إدارة المستخدمين (تحتاج `user:read` / `user:manage`).

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

### مثال: إنشاء تذكرة بجهاز وعميل جديدين
```json
POST /tickets
{
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

## الفواتير والمدفوعات والمصروفات ونقاط البيع

| الطريقة | المسار | الصلاحية | الوصف |
|---|---|---|---|
| GET | `/finance/summary` | `report:read` | ملخص مالي (إيراد، مصروفات، ربح، مستحقات) |
| GET | `/finance/invoices` | `invoice:read` | الفواتير |
| POST | `/finance/invoices` | `invoice:write` | إصدار فاتورة (يدويًا أو من التذكرة) |
| GET | `/finance/invoices/:id` | `invoice:read` | التفاصيل + المدفوعات |
| POST | `/finance/invoices/:id/void` | `invoice:write` | إلغاء (يُرفض إذا مدفوعة) |
| GET | `/finance/payments` | `payment:read` | المدفوعات |
| POST | `/finance/payments` | `payment:record` | تحصيل/استرداد |
| GET/POST/PATCH/DELETE | `/finance/expenses` | `expense:read`/`manage` | المصروفات |
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
| GET | `/branches` | `branch:read` | الفروع |
| POST/PATCH/DELETE | `/branches` | `branch:manage` | إدارة الفروع (يُفرض حد الباقة) |
| GET | `/technicians` | `technician:read` | الفنيون مع الحمل الحالي |
| GET | `/technicians/available` | `technician:read` | مرتبون حسب الأقل تحميلًا |
| GET | `/technicians/performance` | `analytics:read` | أدائهم التفصيلي |

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
| GET | `/knowledge/suggest?symptom=&model=&brand=` | `knowledge:read` | **اقتراحات تشخيص** بخطوات وأسباب ونتائج تاريخية |
| POST | `/knowledge` · PATCH | `knowledge:write` | إنشاء/تحديث مقال |
| POST | `/knowledge/:id/outcome` | `knowledge:write` | تسجيل نجاح/فشل تطبيق المقال |

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
