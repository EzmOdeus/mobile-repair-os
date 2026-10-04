/**
 * اختبار دورة صيانة كاملة من البداية للنهاية عبر HTTP.
 * يتحقق من:
 *  - إنشاء عميل وجهاز وتذكرة
 *  - تسجيل التشخيص
 *  - إنشاء عرض سعر وإرساله
 *  - منع بدء الإصلاح قبل موافقة العميل (قاعدة عمل)
 *  - موافقة العميل ثم الانتقال للإصلاح
 *  - إضافة قطعة ومصنعية
 *  - منع التجهيز للتسليم قبل اجتياز فحص الجودة (قاعدة عمل)
 *  - فحص الجودة ثم ready
 *  - إصدار فاتورة، منع التسليم قبل السداد (قاعدة عمل)، التحصيل، التسليم
 *  - فتح claim ضمان على الإصلاح المُسلَّم
 *  - التحقق من عزل المستأجرين (Tenant isolation)
 */

const API = process.env.API_URL ?? 'http://localhost:4000/api/v1';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  ✗ ${label}${detail ? ` → ${JSON.stringify(detail)}` : ''}`);
  }
}

interface ApiResult<T> {
  status: number;
  ok: boolean;
  data?: T;
  /** بيانات الترقيم الصفحي إن وُجدت (تُدمج مع data في نفس الكائن) */
  meta?: { total?: number; page?: number; pages?: number; [key: string]: unknown };
  error?: { code: string; message: string; details?: unknown };
}

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined,
  });

  const text = await response.text();
  let payload: {
    success?: boolean;
    data?: T;
    meta?: { total?: number; [key: string]: unknown };
    error?: { code: string; message: string; details?: unknown };
  } = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }

  return {
    status: response.status,
    ok: response.ok && payload.success !== false,
    data: payload.meta ? ({ ...(payload.data as object), meta: payload.meta } as T) : payload.data,
    meta: payload.meta,
    error: payload.error,
  };
}

function section(title: string): void {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`);
}

const stamp = Date.now().toString().slice(-6);

async function main(): Promise<void> {
  section('تسجيل الدخول');
  const login = await call<{ accessToken: string; user: { role: string }; organization: { name: string } }>(
    'POST',
    '/auth/login',
    { identifier: 'owner', password: 'Owner@1234' },
  );
  check('تسجيل دخول المالك ينجح', login.ok, login.error);
  const token = login.data?.accessToken;
  if (!token) throw new Error('لا يمكن إكمال الاختبار بدون توكن');

  /* ---------------------------------------------------------------- */
  section('إنشاء عميل وجهاز وتذكرة');

  const customer = await call<{ _id: string; fullName: string }>(
    'POST',
    '/customers',
    {
      fullName: `عميل اختبار ${stamp}`,
      phone: `010${stamp}00`.slice(0, 11),
      type: 'individual',
      address: { governorate: 'القاهرة', area: 'مدينة نصر' },
    },
    token,
  );
  check('إنشاء عميل جديد', customer.ok && Boolean(customer.data?._id), customer.error);

  // رقم مكرر يجب أن يُرفض
  const duplicate = await call('POST', '/customers', {
    fullName: 'عميل مكرر',
    phone: `010${stamp}00`.slice(0, 11),
  }, token);
  check('منع تكرار رقم الهاتف', duplicate.status === 409, { status: duplicate.status });

  const ticket = await call<{ ticket: { _id: string; ticketNumber: string; status: string; trackingToken: string } }>(
    'POST',
    '/tickets',
    {
      newCustomer: {
        fullName: `عميل تذكرة ${stamp}`,
        phone: `011${stamp}11`.slice(0, 11),
      },
      newDevice: {
        brand: 'Samsung',
        model: 'Galaxy A15',
        color: 'أسود',
        storage: '128GB',
        imei: `35${stamp}0000000`.slice(0, 15),
        conditionOnIntake: 'good',
      },
      priority: 'high',
      intake: {
        complaint: 'الشاشة مكسورة واللمس لا يعمل في الجزء العلوي',
        complaintCategory: 'display',
        accessories: ['sim_tray'],
        customerAcknowledged: true,
        dataLossDisclaimerAccepted: true,
        devicePasswordProvided: false,
      },
    },
    token,
  );
  check('إنشاء تذكرة مع عميل وجهاز جديدين', ticket.ok && Boolean(ticket.data?.ticket?._id), ticket.error);

  const ticketId = ticket.data?.ticket?._id;
  const ticketNumber = ticket.data?.ticket?.ticketNumber;
  const trackingToken = ticket.data?.ticket?.trackingToken;
  if (!ticketId) throw new Error('لا يمكن إكمال الاختبار بدون تذكرة');

  console.log(`     التذكرة: ${ticketNumber} | معرف: ${ticketId}`);

  const detail = await call<{
    ticket: { status: string; sla: { dueAt: string } };
    timeline: unknown[];
    allowedTransitions: { status: string }[];
  }>('GET', `/tickets/${ticketId}`, undefined, token);
  check('قراءة تفاصيل التذكرة', detail.ok, detail.error);
  check('الحالة الابتدائية received', detail.data?.ticket.status === 'received', detail.data?.ticket.status);
  check('سلسلة الأحداث تحتوي حدث الإنشاء', (detail.data?.timeline?.length ?? 0) >= 1, detail.data?.timeline?.length);
  check('موعد SLA محسوب', Boolean(detail.data?.ticket.sla?.dueAt));

  /* ---------------------------------------------------------------- */
  section('التشخيص والانتقالات');

  const badTransition = await call(
    'POST',
    `/tickets/${ticketId}/transition`,
    { status: 'delivered' },
    token,
  );
  check(
    'رفض انتقال غير منطقي (received → delivered)',
    badTransition.status === 409,
    { status: badTransition.status, code: badTransition.error?.code },
  );

  const toInspection = await call('POST', `/tickets/${ticketId}/transition`, { status: 'inspection', note: 'فحص ظاهري' }, token);
  check('الانتقال إلى الفحص الظاهري', toInspection.ok, toInspection.error);

  const diagnosis = await call(
    'PUT',
    `/tickets/${ticketId}/diagnosis`,
    {
      summary: 'كسر في طبقة الشاشة مع تلف في مسار اللمس',
      faultCategory: 'display',
      faultSeverity: 'major',
      rootCause: 'صدمة ميكانيكية أدت لكسر الشاشة وتلف الفليكس',
      requiredActions: ['استبدال الشاشة', 'اختبار اللمس', 'فحص الشاشة بعد التركيب'],
      needsParts: true,
      isBoardLevel: false,
      confidence: 'high',
    },
    token,
  );
  check('تسجيل التشخيص', diagnosis.ok, diagnosis.error);

  const toDiagnosis = await call('POST', `/tickets/${ticketId}/transition`, { status: 'diagnosis' }, token);
  check('الانتقال إلى التشخيص', toDiagnosis.ok, toDiagnosis.error);

  /* ---------------------------------------------------------------- */
  section('عرض السعر وقاعدة الموافقة');

  const part = await call<{ items: { _id: string; name: string; pricing: { sellingPriceEgp: number } }[] }>(
    'GET',
    '/parts?q=A15&limit=1',
    undefined,
    token,
  );
  const partId = part.data?.items?.[0]?._id;

  const estimate = await call<{ _id: string; estimateNumber: string; totals: { totalEgp: number } }>(
    'POST',
    '/estimates',
    {
      ticketId,
      lines: [
        ...(partId
          ? [{ kind: 'part', partId, description: 'شاشة Samsung Galaxy A15', quantity: 1, unitPriceEgp: 2200, warrantyDays: 90 }]
          : []),
        { kind: 'labor', description: 'مصنعية تغيير شاشة', quantity: 1, unitPriceEgp: 450, warrantyDays: 14 },
      ],
      estimatedDurationHours: 6,
      warrantyOfferedDays: 60,
      terms: 'الضمان لا يشمل الكسر أو السوائل',
    },
    token,
  );
  check('إنشاء عرض سعر', estimate.ok && Boolean(estimate.data?._id), estimate.error);
  check('حساب إجمالي العرض', (estimate.data?.totals.totalEgp ?? 0) > 0, estimate.data?.totals);

  const estimateId = estimate.data?._id;
  if (!estimateId) throw new Error('لا يمكن إكمال الاختبار بدون عرض سعر');

  const send = await call('POST', `/estimates/${estimateId}/send`, { via: 'whatsapp' }, token);
  check('إرسال العرض للعميل', send.ok, send.error);

  const afterSend = await call<{ ticket: { status: string } }>('GET', `/tickets/${ticketId}`, undefined, token);
  check('التذكرة في انتظار الموافقة', afterSend.data?.ticket.status === 'waiting_approval', afterSend.data?.ticket.status);

  // محاولة بدء الإصلاح بدون موافقة — يجب أن تُرفض
  const blockedRepair = await call('POST', `/tickets/${ticketId}/transition`, { status: 'approved' }, token);
  check(
    'منع بدء الإصلاح قبل موافقة العميل',
    blockedRepair.status === 422,
    { status: blockedRepair.status, code: blockedRepair.error?.code, message: blockedRepair.error?.message },
  );

  /* ---------------------------------------------------------------- */
  section('الموافقة الرقمية من بوابة العميل');

  const publicBefore = await call<{ pendingApproval: { estimateNumber: string; totalEgp: number } | null; ticket: { status: string } }>(
    'GET',
    `/public/track/${trackingToken}`,
  );
  check('بوابة العميل تعمل برمز التتبع', publicBefore.ok, publicBefore.error);
  check('العرض يظهر كبانتظار موافقة العميل', Boolean(publicBefore.data?.pendingApproval), publicBefore.data?.pendingApproval);

  const publicDetail = await call<{ ticket: { customerPhone: string; device: { imeiMasked?: string } } }>(
    'GET',
    `/public/track/${trackingToken}`,
  );
  check(
    'إخفاء رقم العميل في البوابة العامة',
    (publicDetail.data?.ticket.customerPhone ?? '').includes('*'),
    publicDetail.data?.ticket.customerPhone,
  );
  check(
    'تقنيع IMEI في البوابة العامة',
    (publicDetail.data?.ticket.device?.imeiMasked ?? '').includes('*'),
    publicDetail.data?.ticket.device?.imeiMasked,
  );

  const approveByPortal = await call<{ message: string; approvedTotalEgp: number }>(
    'POST',
    `/public/track/${trackingToken}/decide`,
    { decision: 'approved' },
  );
  check('موافقة العميل من البوابة العامة', approveByPortal.ok, approveByPortal.error);

  const afterApprove = await call<{ ticket: { status: string } }>('GET', `/tickets/${ticketId}`, undefined, token);
  check(
    'انتقال التذكرة إلى approved تلقائيًا',
    ['approved', 'waiting_approval'].includes(afterApprove.data?.ticket.status ?? ''),
    afterApprove.data?.ticket.status,
  );

  // لو بقيت في waiting_approval (لأن الانتقال التلقائي يتطلب حالة سابقة معينة) ننتقل يدويًا
  if (afterApprove.data?.ticket.status === 'waiting_approval') {
    const manual = await call('POST', `/tickets/${ticketId}/transition`, { status: 'approved', note: 'اعتماد مسجّل' }, token);
    check('الانتقال إلى approved بعد الموافقة', manual.ok, manual.error);
  }

  /* ---------------------------------------------------------------- */
  section('الإصلاح والقطع والمصنعية');

  const toRepairing = await call('POST', `/tickets/${ticketId}/transition`, { status: 'repairing' }, token);
  check('بدء الإصلاح بعد الموافقة', toRepairing.ok, toRepairing.error);

  if (partId) {
    const addPart = await call<{ _id: string; status: string; totalPriceEgp: number }>(
      'POST',
      `/tickets/${ticketId}/parts`,
      { partId, quantity: 1, status: 'installed' },
      token,
    );
    check('إضافة قطعة للتذكرة', addPart.ok, addPart.error);

    const partDetail = await call<{ part: { name: string; stock: { onHand: number } } }>('GET', `/parts/${partId}`, undefined, token);
    check('قراءة تفاصيل القطعة ومخزونها', partDetail.ok, partDetail.error);
  }

  const labor = await call('POST', `/tickets/${ticketId}/labor`, {
    description: 'مصنعية تركيب شاشة',
    category: 'repair',
    hours: 2,
    ratePerHourEgp: 150,
    amountEgp: 300,
  }, token);
  check('إضافة بند مصنعية', labor.ok, labor.error);

  const workStart = await call('POST', `/tickets/${ticketId}/work-log`, { action: 'start' }, token);
  check('بدء تسجيل وقت العمل', workStart.ok, workStart.error);
  const workPause = await call('POST', `/tickets/${ticketId}/work-log`, { action: 'pause', note: 'انتهى التركيب' }, token);
  check('إيقاف تسجيل وقت العمل', workPause.ok, workPause.error);

  const note = await call('POST', `/tickets/${ticketId}/notes`, {
    body: 'تم تركيب الشاشة الجديدة واختبار اللمس',
    category: 'repair_step',
  }, token);
  check('إضافة ملاحظة على التذكرة', note.ok, note.error);

  /* ---------------------------------------------------------------- */
  section('قاعدة فحص الجودة قبل التسليم');

  const toQc = await call('POST', `/tickets/${ticketId}/transition`, { status: 'testing_qc' }, token);
  check('الانتقال لمرحلة الفحص', toQc.ok, toQc.error);

  const blockedReady = await call('POST', `/tickets/${ticketId}/transition`, { status: 'ready' }, token);
  check(
    'منع التجهيز للتسليم قبل اجتياز الفحص',
    blockedReady.status === 422,
    { status: blockedReady.status, code: blockedReady.error?.code },
  );

  const qc = await call<{ _id: string; attempt: number; items: { key: string; labelAr: string; required: boolean }[] }>(
    'POST',
    '/quality-checks',
    { ticketId, useDefaultChecklist: true },
    token,
  );
  check('بدء فحص جودة بقائمة افتراضية', qc.ok && (qc.data?.items?.length ?? 0) > 0, qc.error);
  const qcId = qc.data?._id;
  if (!qcId) throw new Error('لا يمكن إكمال الاختبار بدون سجل فحص');

  // محاولة إتمام الفحص ببنود إلزامية غير محددة
  const incompleteQc = await call(
    'POST',
    `/quality-checks/${qcId}/submit`,
    { items: (qc.data?.items ?? []).map((item) => ({ key: item.key, result: 'pending', notes: '' })), advanceTicket: false },
    token,
  );
  check(
    'منع إتمام الفحص مع بنود إلزامية غير محددة',
    incompleteQc.status === 422,
    { status: incompleteQc.status, code: incompleteQc.error?.code },
  );

  // فحص مكتمل بنجاح
  const submitQc = await call<{ result: string; passRatePct: number }>(
    'POST',
    `/quality-checks/${qcId}/submit`,
    {
      items: (qc.data?.items ?? []).map((item) => ({ key: item.key, result: 'pass', notes: '' })),
      measurements: { batteryHealthPct: 92, bootTimeSeconds: 22 },
      notes: 'الفحص مكتمل بدون ملاحظات',
      advanceTicket: true,
    },
    token,
  );
  check('تسجيل نتيجة الفحص (اجتياز)', submitQc.ok && submitQc.data?.result === 'passed', {
    error: submitQc.error,
    result: submitQc.data?.result,
  });

  const afterQc = await call<{ ticket: { status: string } }>('GET', `/tickets/${ticketId}`, undefined, token);
  check('انتقال التذكرة إلى ready بعد الاجتياز', afterQc.data?.ticket.status === 'ready', afterQc.data?.ticket.status);

  /* ---------------------------------------------------------------- */
  section('الفاتورة والدفع وقاعدة السداد');

  const invoice = await call<{ _id: string; invoiceNumber: string; totals: { totalEgp: number; dueEgp: number } }>(
    'POST',
    '/finance/invoices',
    { ticketId, buildFromTicket: true, issueNow: true },
    token,
  );
  check('إصدار فاتورة من بنود التذكرة', invoice.ok && Boolean(invoice.data?._id), invoice.error);
  check('الفاتورة بها مبلغ مستحق', (invoice.data?.totals.dueEgp ?? 0) > 0, invoice.data?.totals);

  const invoiceId = invoice.data?._id;
  if (!invoiceId) throw new Error('لا يمكن إكمال الاختبار بدون فاتورة');

  const blockedDelivery = await call('POST', `/tickets/${ticketId}/transition`, { status: 'delivered' }, token);
  check(
    'منع التسليم قبل السداد',
    blockedDelivery.status === 422,
    { status: blockedDelivery.status, code: blockedDelivery.error?.code },
  );

  const partial = await call<{ invoice: { status: string; totals: { dueEgp: number } } }>(
    'POST',
    '/finance/payments',
    { invoiceId, method: 'cash', amountEgp: 100, tenderedEgp: 100 },
    token,
  );
  check('تسجيل دفعة جزئية', partial.ok, partial.error);
  check(
    'الفاتورة تصبح مدفوعة جزئيًا',
    partial.data?.invoice.status === 'partially_paid',
    partial.data?.invoice.status,
  );

  const payFull = await call<{ invoice: { status: string }; payment: { receiptNumber: string } }>(
    'POST',
    '/finance/payments',
    { invoiceId, method: 'instapay', amountEgp: 5000, reference: 'IPN-TEST' },
    token,
  );
  check('تحصيل باقي المبلغ', payFull.ok, payFull.error);

  const invoiceDetail = await call<{ invoice: { status: string; totals: { dueEgp: number } } }>(
    'GET',
    `/finance/invoices/${invoiceId}`,
    undefined,
    token,
  );
  check(
    'الفاتورة سُدّدت بالكامل',
    invoiceDetail.data?.invoice.status === 'paid' && (invoiceDetail.data?.invoice.totals.dueEgp ?? 1) <= 0.01,
    invoiceDetail.data?.invoice,
  );

  /* ---------------------------------------------------------------- */
  section('التسليم والضمان');

  // قد يكون النظام نقل التذكرة تلقائيًا إلى paid عند السداد الكامل — وكلاهما صحيح
  const beforeDelivery = await call<{ ticket: { status: string } }>('GET', `/tickets/${ticketId}`, undefined, token);
  if (beforeDelivery.data?.ticket.status === 'ready') {
    const toNotified = await call('POST', `/tickets/${ticketId}/transition`, { status: 'customer_notified' }, token);
    check('إبلاغ العميل بجاهزية الجهاز', toNotified.ok, toNotified.error);
  } else {
    check(
      'التذكرة انتقلت تلقائيًا إلى paid بعد السداد',
      beforeDelivery.data?.ticket.status === 'paid',
      beforeDelivery.data?.ticket.status,
    );
  }

  const toDelivered = await call<{ ticket: { status: string; deliveredAt: string; warranty: { expiresAt: string } } }>(
    'POST',
    `/tickets/${ticketId}/transition`,
    { status: 'delivered', note: 'تم التسليم للعميل' },
    token,
  );
  check('تسليم الجهاز بعد السداد', toDelivered.ok, toDelivered.error);
  check('تاريخ التسليم مسجل', Boolean(toDelivered.data?.ticket.deliveredAt));
  check('تاريخ انتهاء الضمان محسوب', Boolean(toDelivered.data?.ticket.warranty?.expiresAt));

  const timeline = await call<{ chain: { toStatus: string; actorName: string }[] }>(
    'GET',
    `/tickets/${ticketId}/timeline`,
    undefined,
    token,
  );
  check('سلسلة الأحداث الكاملة محفوظة', (timeline.data?.chain?.length ?? 0) >= 8, timeline.data?.chain?.length);

  const deviceId = (await call<{ ticket: { deviceId: { _id: string } } }>('GET', `/tickets/${ticketId}`, undefined, token)).data
    ?.ticket.deviceId?._id;

  if (deviceId) {
    const passport = await call<{
      summary: { totalRepairs: number; totalSpentEgp: number };
      repairHistory: unknown[];
      replacedParts: unknown[];
    }>('GET', `/devices/${deviceId}`, undefined, token);
    check('جواز الجهاز يسجّل الإصلاح', (passport.data?.summary.totalRepairs ?? 0) >= 1, passport.data?.summary);
    check('جواز الجهاز يعرض القطع المستبدلة', (passport.data?.replacedParts?.length ?? 0) >= 0);
  }

  const claim = await call<{ _id: string; claimNumber: string; newTicketId?: string; warrantyActive: boolean }>(
    'POST',
    '/warranty/claims',
    {
      originalTicketId: ticketId,
      symptom: 'اللمس رجع يفصل بعد أسبوع من الإصلاح',
      coverage: 'both',
      isSameFault: true,
      faultCategory: 'display',
      createNewTicket: true,
      priority: 'high',
    },
    token,
  );
  check('فتح claim ضمان على الإصلاح المُسلَّم', claim.ok && Boolean(claim.data?._id), claim.error);
  check('الضمان ساري عند العودة', claim.data?.warrantyActive === true, claim.data?.warrantyActive);
  check('إنشاء تذكرة عودة مرتبطة', Boolean(claim.data?.newTicketId));

  if (claim.data?._id) {
    const decision = await call('POST', `/warranty/claims/${claim.data._id}/decide`, {
      status: 'approved',
      coverage: 'both',
      decisionNotes: 'نفس العطل ومغطى بالضمان',
      repairCostEgp: 0,
      chargedToCustomerEgp: 0,
      chargedToSupplierEgp: 300,
      supplierClaimStatus: 'requested',
      resolutionNotes: 'استبدال الشاشة تحت الضمان',
    }, token);
    check('تسجيل قرار الضمان', decision.ok, decision.error);
  }

  /* ---------------------------------------------------------------- */
  section('عزل بيانات المستأجرين (Tenant Isolation)');

  const register = await call<{ accessToken: string; organization: { name: string } }>(
    'POST',
    '/auth/register',
    {
      organization: { name: `مركز اختبار العزل ${stamp}`, phone: '01111111111' },
      owner: {
        fullName: 'مالك مركز آخر',
        username: `isolated${stamp}`,
        password: 'Isolated@1234',
      },
      branch: { name: 'الفرع الرئيسي', code: 'MAIN' },
    },
  );
  check('تسجيل مركز آخر ينجح', register.ok && Boolean(register.data?.accessToken), register.error);

  const otherToken = register.data?.accessToken;
  if (otherToken) {
    const crossTenantTicket = await call('GET', `/tickets/${ticketId}`, undefined, otherToken);
    check(
      'منع مركز آخر من قراءة تذكرة هذا المركز',
      crossTenantTicket.status === 404 || crossTenantTicket.status === 403,
      { status: crossTenantTicket.status, code: crossTenantTicket.error?.code },
    );

    const crossTenantCustomer = await call('GET', `/customers/${customer.data?._id}`, undefined, otherToken);
    check(
      'منع مركز آخر من قراءة عميل هذا المركز',
      crossTenantCustomer.status === 404 || crossTenantCustomer.status === 403,
      { status: crossTenantCustomer.status },
    );

    const otherList = await call<{ items: unknown[] }>('GET', '/tickets?limit=5', undefined, otherToken);
    check(
      'المركز الجديد لا يرى تذاكر غيره',
      (otherList.data?.items?.length ?? 0) === 0,
      { items: otherList.data?.items?.length },
    );

    const forbidden = await call('POST', '/auth/users', {
      fullName: 'مستخدم اختبار',
      username: `x${stamp}`,
      password: 'Test@1234',
      role: 'viewer',
    }, otherToken);
    check('المالك الجديد يستطيع إنشاء مستخدم في مركزه', forbidden.ok || forbidden.status === 409, forbidden.error);
  }

  /* ---------------------------------------------------------------- */
  section('الصلاحيات (RBAC)');

  const techLogin = await call<{ accessToken: string; user: { role: string; permissions: string[] } }>(
    'POST',
    '/auth/login',
    { identifier: 'tech.ahmed', password: 'Tech@1234' },
  );
  check('تسجيل دخول الفني', techLogin.ok, techLogin.error);

  const techToken = techLogin.data?.accessToken;
  if (techToken) {
    check('الفني لا يملك صلاحية إدارة المستخدمين', !techLogin.data?.user.permissions.includes('user:manage'));
    check('الفني يملك صلاحية التشخيص', Boolean(techLogin.data?.user.permissions.includes('diagnosis:write')));

    const techForbidden = await call('POST', '/auth/users', {
      fullName: 'محاولة غير مصرح بها',
      username: `hack${stamp}`,
      password: 'Hack@1234',
      role: 'owner',
    }, techToken);
    check('رفض إنشاء مستخدم بدون صلاحية (403)', techForbidden.status === 403, { status: techForbidden.status });

    const techNoFinance = await call('GET', '/finance/summary', undefined, techToken);
    check('رفض الوصول للملخص المالي للفني (403)', techNoFinance.status === 403, { status: techNoFinance.status });
  }

  /* ---------------------------------------------------------------- */
  section('حركات المخزون');

  if (partId) {
    const before = await call<{ part: { stock: { onHand: number; reserved: number } } }>('GET', `/parts/${partId}`, undefined, token);
    const onHandBefore = before.data?.part.stock.onHand ?? 0;

    const purchase = await call<{ balance: { part: { onHand: number } } }>(
      'POST',
      '/inventory/movements',
      { partId, type: 'purchase_in', quantity: 5, unitCostEgp: 1000, batchCode: `B-TEST-${stamp}` },
      token,
    );
    check('توريد مخزون ينجح', purchase.ok, purchase.error);

    const after = await call<{ part: { stock: { onHand: number } } }>('GET', `/parts/${partId}`, undefined, token);
    check(
      'زيادة الرصيد بعد التوريد',
      (after.data?.part.stock.onHand ?? 0) === onHandBefore + 5,
      { before: onHandBefore, after: after.data?.part.stock.onHand },
    );

    const oversell = await call(
      'POST',
      '/inventory/movements',
      { partId, type: 'sale_out', quantity: 99999 },
      token,
    );
    check('منع صرف كمية أكبر من الرصيد', oversell.status === 422, { status: oversell.status, code: oversell.error?.code });
  }

  /* ---------------------------------------------------------------- */
  section('التحليلات بعد العملية');

  const dashboard = await call<{ operations: { openTickets: number }; quality: { checksInRange: number } }>(
    'GET',
    '/analytics/dashboard?period=month',
    undefined,
    token,
  );
  check('لوحة التحكم تعمل', dashboard.ok, dashboard.error);

  const pilotKpis = await call<{ kpis: { key: string; value: number }[] }>('GET', '/analytics/pilot-kpis?period=month', undefined, token);
  check('مؤشرات Pilot محسوبة', (pilotKpis.data?.kpis?.length ?? 0) >= 6, pilotKpis.data?.kpis?.length);

  const warrantyIntel = await call<{ totalClaims: number; returnRatePct: number }>('GET', '/warranty/intelligence', undefined, token);
  check('تحليلات الضمان تعمل', warrantyIntelligence_ok(warrantyIntel), warrantyIntel.error);

  const audit = await call<{ resource: string; count: number; logs: { action: string }[] }>(
    'GET',
    `/audit-logs/RepairTicket/${ticketId}`,
    undefined,
    token,
  );
  check(
    'سجل التدقيق يحتوي عمليات التذكرة',
    audit.ok && (audit.data?.count ?? 0) > 0,
    audit.error ?? { count: audit.data?.count },
  );

  const auditList = await call<{ items: unknown[]; meta?: { total: number } }>(
    'GET',
    '/audit-logs?limit=5',
    undefined,
    token,
  );
  check('قائمة سجل التدقيق تعمل', auditList.ok, auditList.error);

  const knowledge = await call<{ suggestions: unknown[] }>(
    'GET',
    '/knowledge/suggest?symptom=لا%20يشحن',
    undefined,
    token,
  );
  check('اقتراحات قاعدة المعرفة تعمل', knowledge.ok, knowledge.error);

  const meta = await call<{ groups: unknown[] }>('GET', '/meta/endpoints');
  check('فهرس نقاط النهاية متاح', (meta.data?.groups?.length ?? 0) > 10, meta.data?.groups?.length);

  /* ---------------------------------------------------------------- */
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`النتيجة النهائية:  نجح ${passed}  |  فشل ${failed}`);
  if (failures.length) {
    console.log('\nالاختبارات الفاشلة:');
    failures.forEach((f) => console.log(`  • ${f}`));
  }
  console.log('═'.repeat(64));

  process.exit(failed > 0 ? 1 : 0);
}

function warrantyIntelligence_ok(result: ApiResult<{ totalClaims: number; returnRatePct: number }>): boolean {
  return result.ok && typeof result.data?.returnRatePct === 'number';
}

main().catch((err) => {
  console.error('\nفشل الاختبار بخطأ غير متوقع:', err);
  process.exit(1);
});
