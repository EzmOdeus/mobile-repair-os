import 'dotenv/config';
import { Types } from 'mongoose';
import bcrypt from 'bcryptjs';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { logger } from '../config/logger.js';
import { runAsSystem, runWithTenantContext } from '../context/tenantContext.js';
import { registerAllModels } from '../models/register.js';

import { OrganizationModel } from '../models/Organization.js';
import { BranchModel } from '../models/Branch.js';
import { UserModel, type UserDoc } from '../models/User.js';
import { CustomerModel } from '../models/Customer.js';
import { DeviceModel } from '../models/Device.js';
import { SupplierModel } from '../models/Supplier.js';
import { PartModel } from '../models/Part.js';
import { InventoryItemModel } from '../models/InventoryItem.js';
import { StockMovementModel } from '../models/StockMovement.js';
import { StockBatchModel } from '../models/StockBatch.js';
import { RepairTicketModel } from '../models/RepairTicket.js';
import { RepairStatusHistoryModel } from '../models/RepairStatusHistory.js';
import { RepairNoteModel } from '../models/RepairNote.js';
import { RepairPartModel } from '../models/RepairPart.js';
import { RepairLaborModel } from '../models/RepairLabor.js';
import { EstimateModel } from '../models/Estimate.js';
import { ApprovalModel } from '../models/Approval.js';
import { QualityCheckModel, DEFAULT_QC_ITEMS } from '../models/QualityCheck.js';
import { WarrantyClaimModel } from '../models/WarrantyClaim.js';
import { InvoiceModel } from '../models/Invoice.js';
import { PaymentModel } from '../models/Payment.js';
import { ExpenseModel } from '../models/Expense.js';
import { NotificationModel } from '../models/Notification.js';
import { AuditLogModel } from '../models/AuditLog.js';
import { KnowledgeArticleModel } from '../models/KnowledgeArticle.js';

import { syncNumberCounters } from '../services/numberingService.js';
import { ACTIVE_REPAIR_STATUSES, type RepairStatus, type TicketPriority } from '../constants/repair.js';
import { money } from '../utils/money.js';
import { addDays, addHours } from '../utils/dates.js';
import { formatSequenceNumber, publicToken, slugifyWithSuffix } from '../utils/ids.js';

/* ------------------------------------------------------------------ */
/* أدوات مساعدة                                                        */
/* ------------------------------------------------------------------ */

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function daysAgo(days: number, hours = 0): Date {
  return new Date(Date.now() - days * 86_400_000 - hours * 3_600_000);
}

const FIRST_NAMES = [
  'أحمد', 'محمد', 'مصطفى', 'محمود', 'كريم', 'ياسمين', 'منى', 'هبة', 'سارة', 'نورهان',
  'إسلام', 'عمرو', 'شريف', 'هاني', 'رضا', 'أميرة', 'دينا', 'مريم', 'فاطمة', 'خالد',
  'طارق', 'وليد', 'سامح', 'علاء', 'أيمن', 'سمير', 'نادية', 'رانيا', 'إيمان', 'بسمة',
];

const LAST_NAMES = [
  'عبدالله', 'السيد', 'حسن', 'إبراهيم', 'فؤاد', 'شعبان', 'الزيني', 'منصور', 'قنديل',
  'الشريف', 'عبدالرحمن', 'سليمان', 'رمضان', 'الجندي', 'بدوي', 'عطية', 'حجازي', 'نصار',
];

const GOVERNORATES = ['القاهرة', 'الجيزة', 'الإسكندرية', 'الدقهلية', 'الشرقية', 'أسيوط'];
const AREAS_BY_GOV: Record<string, string[]> = {
  القاهرة: ['مدينة نصر', 'المعادي', 'مصر الجديدة', 'التجمع الخامس', 'شبرا'],
  الجيزة: ['المهندسين', 'فيصل', 'الدقي', 'الهرم', '6 أكتوبر'],
  الإسكندرية: ['سموحة', 'العجمي', 'المنشية', 'محرم بك'],
  الدقهلية: ['المنصورة', 'طلخا', 'ميت غمر'],
  الشرقية: ['الزقازيق', 'بلبيس', 'العاشر من رمضان'],
  أسيوط: ['أسيوط', 'ديروط', 'أبنوب'],
};

const CARRIERS = ['010', '011', '012', '015'];
function randomEgyptPhone(): string {
  return `${pick(CARRIERS)}${String(randInt(10_000_000, 99_999_999))}`;
}

const DEVICE_CATALOG = [
  { brand: 'Samsung', model: 'Galaxy A15', storage: '128GB', ram: '4GB', price: 9500 },
  { brand: 'Samsung', model: 'Galaxy A55', storage: '256GB', ram: '8GB', price: 21000 },
  { brand: 'Samsung', model: 'Galaxy S23', storage: '256GB', ram: '8GB', price: 38000 },
  { brand: 'Xiaomi', model: 'Redmi Note 13', storage: '128GB', ram: '6GB', price: 11000 },
  { brand: 'Xiaomi', model: 'Poco X6 Pro', storage: '256GB', ram: '8GB', price: 18500 },
  { brand: 'Xiaomi', model: 'Redmi 13C', storage: '128GB', ram: '4GB', price: 6800 },
  { brand: 'Oppo', model: 'Reno 11', storage: '256GB', ram: '8GB', price: 24000 },
  { brand: 'Oppo', model: 'A78', storage: '128GB', ram: '8GB', price: 10500 },
  { brand: 'Realme', model: 'C67', storage: '128GB', ram: '6GB', price: 8900 },
  { brand: 'Realme', model: '12 Pro', storage: '256GB', ram: '8GB', price: 19500 },
  { brand: 'Infinix', model: 'Hot 40i', storage: '128GB', ram: '4GB', price: 6200 },
  { brand: 'Vivo', model: 'Y28', storage: '128GB', ram: '6GB', price: 9800 },
  { brand: 'Honor', model: 'X9b', storage: '256GB', ram: '8GB', price: 17500 },
  { brand: 'Apple', model: 'iPhone 13', storage: '128GB', ram: '4GB', price: 42000 },
  { brand: 'Apple', model: 'iPhone 14 Pro', storage: '256GB', ram: '6GB', price: 68000 },
  { brand: 'Apple', model: 'iPhone 11', storage: '64GB', ram: '4GB', price: 27000 },
  { brand: 'Nokia', model: 'G21', storage: '64GB', ram: '4GB', price: 5400 },
  { brand: 'Tecno', model: 'Spark 20', storage: '128GB', ram: '8GB', price: 7400 },
];

const COLORS = ['أسود', 'أبيض', 'أزرق', 'أحمر', 'ذهبي', 'أخضر', 'بنفسجي', 'رمادي'];

const COMPLAINTS: { text: string; category: string }[] = [
  { text: 'الشاشة مكسورة بعد السقوط واللمس لا يعمل في الجزء العلوي', category: 'display' },
  { text: 'الجهاز لا يشحن والكابل يهتز عند توصيله', category: 'charging' },
  { text: 'البطارية تفرغ بسرعة شديدة وتسخن أثناء الاستخدام', category: 'battery' },
  { text: 'السبيكر صوته مكتوم وبيشخشخ', category: 'audio' },
  { text: 'المايك لا يعمل أثناء المكالمات، الطرف الآخر لا يسمعني', category: 'audio' },
  { text: 'الجهاز وقع في الماء ولا يعمل بعدها', category: 'water_damage' },
  { text: 'الكاميرا الخلفية الصورة مشوشة وفيها نقط سوداء', category: 'camera' },
  { text: 'الشبكة تفصل والشريحة غير مقروءة أحيانًا', category: 'network' },
  { text: 'الجهاز بيسخن ويفصل لوحده ثم يرجع', category: 'power' },
  { text: 'الجهاز واقع في بوت لووب ولا يقلع', category: 'software' },
  { text: 'زر الباور مش بيستجيب إلا بصعوبة', category: 'hardware' },
  { text: 'الظهور الزجاجي مكسور والكاميرا متأثرة', category: 'back_glass' },
  { text: 'بصمة الإصبع لا تعمل بعد تحديث النظام', category: 'biometrics' },
  { text: 'منفذ الشحن بيسخن جدًا عند الشحن', category: 'charging' },
  { text: 'الشاشة فيها خطوط عمودية بعد ما اتحطت في الجيب', category: 'display' },
];

const DIAGNOSES: Record<string, { summary: string; cause: string; severity: string; boardLevel: boolean }> = {
  display: { summary: 'كسر في طبقة الشاشة مع تلف في اللمس', cause: 'صدمة ميكانيكية أدت لكسر الشاشة وتلف الفلات', severity: 'major', boardLevel: false },
  charging: { summary: 'تلف في منفذ الشحن وتأكسد أطرافه', cause: 'استخدام شاحن غير أصلي مع إدخال الكابل بعنف', severity: 'moderate', boardLevel: false },
  battery: { summary: 'استهلاك البطارية أعلى من الحد الطبيعي (صحة 71%)', cause: 'دورات شحن تجاوزت 800 دورة', severity: 'moderate', boardLevel: false },
  audio: { summary: 'تلف في السماعة الداخلية وتراكم أتربة على شبكة المايك', cause: 'تراكم أتربة ورطوبة', severity: 'minor', boardLevel: false },
  water_damage: { summary: 'آثار تأكسد على لوحة الأم ومنطقة الباور', cause: 'تعرض لسائل أدى لتأكسد مسارات الباور', severity: 'critical', boardLevel: true },
  camera: { summary: 'عدسة الكاميرا الخلفية مخدوشة وحساس الصورة متأثر', cause: 'خدش في العدسة الخارجية', severity: 'moderate', boardLevel: false },
  network: { summary: 'مشكلة في IC الشبكة وأطراف الشريحة', cause: 'خلل في IC الشبكة', severity: 'major', boardLevel: true },
  power: { summary: 'خلل في دائرة الباور وتلف مكثف', cause: 'ارتفاع حرارة أدى لتلف مكثف في دائرة الباور', severity: 'major', boardLevel: true },
  software: { summary: 'ملفات النظام تالفة تحتاج إعادة برمجة', cause: 'انقطاع تحديث النظام', severity: 'minor', boardLevel: false },
  hardware: { summary: 'تلف ميكانيكي في زر الباور', cause: 'استخدام عنيف للزر', severity: 'minor', boardLevel: false },
  back_glass: { summary: 'كسر في الظهر الزجاجي وضغط على الكاميرا', cause: 'سقوط الجهاز', severity: 'moderate', boardLevel: false },
  biometrics: { summary: 'حساس البصمة متأثر بعد التحديث - يحتاج إعادة معايرة', cause: 'تعارض برمجي بعد التحديث', severity: 'minor', boardLevel: false },
};

const PARTS_CATALOG = [
  { name: 'شاشة Samsung Galaxy A15', sku: 'SCR-A15', category: 'screen', grade: 'aftermarket_a', cost: 1450, sell: 2200, brand: 'Samsung', models: ['Galaxy A15'] },
  { name: 'شاشة Samsung Galaxy A55', sku: 'SCR-A55', category: 'screen', grade: 'oem', cost: 3100, sell: 4500, brand: 'Samsung', models: ['Galaxy A55'] },
  { name: 'شاشة iPhone 13 أصلية', sku: 'SCR-IP13', category: 'screen', grade: 'original', cost: 7200, sell: 9800, brand: 'Apple', models: ['iPhone 13'] },
  { name: 'شاشة Redmi Note 13', sku: 'SCR-RN13', category: 'screen', grade: 'aftermarket_a', cost: 1250, sell: 1950, brand: 'Xiaomi', models: ['Redmi Note 13'] },
  { name: 'شاشة Oppo A78', sku: 'SCR-A78', category: 'screen', grade: 'aftermarket_b', cost: 980, sell: 1600, brand: 'Oppo', models: ['A78'] },
  { name: 'بطارية Samsung A15', sku: 'BAT-A15', category: 'battery', grade: 'oem', cost: 420, sell: 750, brand: 'Samsung', models: ['Galaxy A15'] },
  { name: 'بطارية iPhone 11', sku: 'BAT-IP11', category: 'battery', grade: 'aftermarket_a', cost: 950, sell: 1500, brand: 'Apple', models: ['iPhone 11'] },
  { name: 'بطارية Redmi 13C', sku: 'BAT-R13C', category: 'battery', grade: 'oem', cost: 380, sell: 680, brand: 'Xiaomi', models: ['Redmi 13C'] },
  { name: 'بطارية Poco X6 Pro', sku: 'BAT-PX6', category: 'battery', grade: 'oem', cost: 520, sell: 900, brand: 'Xiaomi', models: ['Poco X6 Pro'] },
  { name: 'منفذ شحن Type-C Samsung A15', sku: 'CHG-A15', category: 'charging_port', grade: 'aftermarket_a', cost: 130, sell: 300, brand: 'Samsung', models: ['Galaxy A15'] },
  { name: 'منفذ شحن iPhone Lightning', sku: 'CHG-IPL', category: 'charging_port', grade: 'oem', cost: 320, sell: 600, brand: 'Apple', models: ['iPhone 11', 'iPhone 13'] },
  { name: 'فليكس شحن Oppo A78', sku: 'CHG-A78F', category: 'charging_port', grade: 'aftermarket_a', cost: 110, sell: 260, brand: 'Oppo', models: ['A78'] },
  { name: 'سبيكر Samsung A15', sku: 'SPK-A15', category: 'speaker', grade: 'oem', cost: 95, sell: 220, brand: 'Samsung', models: ['Galaxy A15'] },
  { name: 'سبيكر iPhone 11', sku: 'SPK-IP11', category: 'speaker', grade: 'aftermarket_a', cost: 180, sell: 380, brand: 'Apple', models: ['iPhone 11'] },
  { name: 'مايك Redmi Note 13', sku: 'MIC-RN13', category: 'microphone', grade: 'aftermarket_a', cost: 70, sell: 180, brand: 'Xiaomi', models: ['Redmi Note 13'] },
  { name: 'كاميرا خلفية iPhone 13', sku: 'CAM-IP13', category: 'camera', grade: 'oem', cost: 2100, sell: 3100, brand: 'Apple', models: ['iPhone 13'] },
  { name: 'كاميرا خلفية Realme C67', sku: 'CAM-C67', category: 'camera', grade: 'aftermarket_a', cost: 340, sell: 650, brand: 'Realme', models: ['C67'] },
  { name: 'ظهر زجاج Samsung A55', sku: 'BGL-A55', category: 'back_glass', grade: 'aftermarket_a', cost: 260, sell: 520, brand: 'Samsung', models: ['Galaxy A55'] },
  { name: 'IC باور أجهزة أندرويد', sku: 'IC-PWR1', category: 'ic_chip', grade: 'oem', cost: 480, sell: 900, brand: 'Generic', models: [] },
  { name: 'IC شبكة Snapdragon', sku: 'IC-NET1', category: 'ic_chip', grade: 'oem', cost: 620, sell: 1150, brand: 'Qualcomm', models: [] },
  { name: 'فليكس بصمة iPhone 11', sku: 'FLX-HM11', category: 'flex_cable', grade: 'aftermarket_a', cost: 210, sell: 430, brand: 'Apple', models: ['iPhone 11'] },
  { name: 'شاشة Infinix Hot 40i', sku: 'SCR-H40I', category: 'screen', grade: 'aftermarket_b', cost: 780, sell: 1350, brand: 'Infinix', models: ['Hot 40i'] },
  { name: 'بطارية Nokia G21', sku: 'BAT-G21', category: 'battery', grade: 'oem', cost: 290, sell: 550, brand: 'Nokia', models: ['G21'] },
  { name: 'شاشة Tecno Spark 20', sku: 'SCR-SP20', category: 'screen', grade: 'aftermarket_a', cost: 820, sell: 1400, brand: 'Tecno', models: ['Spark 20'] },
  { name: 'منفذ شحن Tecno Spark 20', sku: 'CHG-SP20', category: 'charging_port', grade: 'aftermarket_a', cost: 90, sell: 220, brand: 'Tecno', models: ['Spark 20'] },
];

const SUPPLIERS = [
  { name: 'الشرق الأوسط لقطع غيار المحمول', type: 'local_wholesale', area: 'العتبة', gov: 'القاهرة' },
  { name: 'النور للتوريدات الإلكترونية', type: 'local_wholesale', area: 'الموسكي', gov: 'القاهرة' },
  { name: 'أبو حنفي لقطع الغيار', type: 'local_wholesale', area: 'شبرا', gov: 'القاهرة' },
  { name: 'تكنو ستور للاستيراد', type: 'importer', area: 'مدينة نصر', gov: 'القاهرة' },
  { name: 'دلتا للإلكترونيات', type: 'local_wholesale', area: 'المنصورة', gov: 'الدقهلية' },
  { name: 'سامسونج قطع غيار معتمدة', type: 'authorized_distributor', area: 'المهندسين', gov: 'الجيزة' },
];

const EXPENSE_TITLES: { title: string; category: 'rent' | 'salaries' | 'utilities' | 'internet_phone' | 'tools' | 'parts_purchase' | 'marketing' | 'maintenance' | 'transport' | 'taxes' | 'misc'; min: number; max: number }[] = [
  { title: 'إيجار المحل الشهري', category: 'rent', min: 8000, max: 14000 },
  { title: 'مرتبات الفنيين', category: 'salaries', min: 12000, max: 30000 },
  { title: 'فاتورة كهرباء', category: 'utilities', min: 900, max: 2400 },
  { title: 'فاتورة مياه', category: 'utilities', min: 150, max: 400 },
  { title: 'اشتراك الإنترنت والخط الأرضي', category: 'internet_phone', min: 500, max: 900 },
  { title: 'شراء أدوات صيانة', category: 'tools', min: 300, max: 3500 },
  { title: 'شراء قطع غيار من المورد', category: 'parts_purchase', min: 3000, max: 18000 },
  { title: 'حملة إعلانية على السوشيال', category: 'marketing', min: 500, max: 3000 },
  { title: 'صيانة تكييف المحل', category: 'maintenance', min: 300, max: 1200 },
  { title: 'مواصلات ومشاوير', category: 'transport', min: 100, max: 600 },
  { title: 'مصروفات متنوعة', category: 'misc', min: 100, max: 900 },
];

/* ------------------------------------------------------------------ */
/* السكربت الرئيسي                                                     */
/* ------------------------------------------------------------------ */

const SEED_ORG_SLUG = 'mobile-care-eg';

const counts: Record<string, number> = {};

async function wipe(): Promise<void> {
  logger.warn('حذف البيانات القديمة...');
  await runAsSystem(async () => {
    await Promise.all([
      OrganizationModel.deleteMany({}),
      BranchModel.deleteMany({}),
      UserModel.deleteMany({}),
      CustomerModel.deleteMany({}),
      DeviceModel.deleteMany({}),
      SupplierModel.deleteMany({}),
      PartModel.deleteMany({}),
      InventoryItemModel.deleteMany({}),
      StockMovementModel.deleteMany({}),
      StockBatchModel.deleteMany({}),
      RepairTicketModel.deleteMany({}),
      RepairStatusHistoryModel.deleteMany({}),
      RepairNoteModel.deleteMany({}),
      RepairPartModel.deleteMany({}),
      RepairLaborModel.deleteMany({}),
      EstimateModel.deleteMany({}),
      ApprovalModel.deleteMany({}),
      QualityCheckModel.deleteMany({}),
      WarrantyClaimModel.deleteMany({}),
      InvoiceModel.deleteMany({}),
      PaymentModel.deleteMany({}),
      ExpenseModel.deleteMany({}),
      NotificationModel.deleteMany({}),
      AuditLogModel.deleteMany({}),
      KnowledgeArticleModel.deleteMany({}),
    ]);
  });
}

/**
 * تصفير العدّادات ومسح البيانات الاختبارية.
 * السبب: العدّادات تُخزَّن في مستند الفرع وتستمر عبر عمليات seed،
 * فبدون تصفيرها يبدأ الترقيم من حيث انتهى مما يُنتج أرقامًا مكررة.
 */
async function resetCounters(): Promise<void> {
  await runAsSystem(async () => {
    await BranchModel.updateMany({}, { $set: { ticketCounter: 0, invoiceCounter: 0 } });
  });
}

async function seed(): Promise<void> {
  registerAllModels();
  await connectDatabase();

  const shouldReset = process.argv.includes('--reset');
  const existing = await runAsSystem(() => OrganizationModel.findOne({ slug: SEED_ORG_SLUG }).lean());

  if (existing && !shouldReset) {
    logger.warn(
      { slug: SEED_ORG_SLUG },
      'البيانات التجريبية موجودة بالفعل. شغّل "pnpm seed:reset" لإعادة البناء من الصفر.',
    );
    await disconnectDatabase();
    return;
  }
  if (shouldReset) {
    await wipe();
    await resetCounters();
  }

  /* ---------------------- المؤسسة والفروع ---------------------- */
  const organization = await OrganizationModel.create({
    name: 'موبايل كير - مركز صيانة',
    nameEn: 'Mobile Care Egypt',
    slug: SEED_ORG_SLUG,
    legalName: 'موبايل كير للتجارة والصيانة',
    taxId: '512-847-963',
    commercialRegister: 'CR-2019-88431',
    phone: '0223456789',
    email: 'info@mobilecare-eg.com',
    website: 'https://mobilecare-eg.com',
    address: { governorate: 'القاهرة', city: 'القاهرة', area: 'مدينة نصر', street: 'عباس العقاد', building: '42' },
    branding: { primaryColor: '#0f766e', receiptFooterText: 'شكرًا لثقتك في موبايل كير — الضمان لا يشمل الكسر أو السوائل' },
    settings: {
      currency: 'EGP',
      timezone: 'Africa/Cairo',
      locale: 'ar-EG',
      taxRate: 14,
      taxInclusive: true,
      defaultWarrantyDays: 30,
      partsWarrantyDays: 90,
      laborWarrantyDays: 14,
      requireApprovalBeforeRepair: true,
      requireIntakePhotos: true,
      requireQcBeforeReady: true,
      defaultSlaHours: 72,
      ticketPrefix: 'REP',
      invoicePrefix: 'INV',
      whatsappEnabled: false,
      notifyOnStatusChange: true,
    },
    subscription: {
      plan: 'pro',
      status: 'active',
      startedAt: daysAgo(240),
      expiresAt: addDays(new Date(), 120),
      maxUsers: 12,
      maxBranches: 3,
      monthlyTicketLimit: 1500,
      priceEgp: 349,
    },
    isActive: true,
    onboardedAt: daysAgo(240),
  });

  const organizationId = organization._id as Types.ObjectId;
  counts.organizations = 1;

  const branchNasr = await BranchModel.create({
    organizationId,
    name: 'فرع مدينة نصر',
    code: 'NSR',
    phone: '0223456789',
    address: { governorate: 'القاهرة', city: 'القاهرة', area: 'مدينة نصر', street: 'عباس العقاد', building: '42' },
    isDefault: true,
    isActive: true,
    ticketCounter: 0,
    invoiceCounter: 0,
  });

  const branchMaadi = await BranchModel.create({
    organizationId,
    name: 'فرع المعادي',
    code: 'MAA',
    phone: '0223456790',
    address: { governorate: 'القاهرة', city: 'القاهرة', area: 'المعادي', street: 'شارع 9', building: '18' },
    isActive: true,
    ticketCounter: 0,
    invoiceCounter: 0,
  });

  const branchSmouha = await BranchModel.create({
    organizationId,
    name: 'فرع سموحة - الإسكندرية',
    code: 'SMH',
    phone: '034234567',
    address: { governorate: 'الإسكندرية', city: 'الإسكندرية', area: 'سموحة', street: 'فوزي معاذ', building: '7' },
    isActive: true,
    ticketCounter: 0,
    invoiceCounter: 0,
  });

  const branches = [branchNasr, branchMaadi, branchSmouha];
  counts.branches = branches.length;

  /* ---------------------- المستخدمون ---------------------- */
  const usersData: {
    fullName: string;
    username: string;
    role: 'owner' | 'admin' | 'manager' | 'receptionist' | 'technician' | 'accountant';
    password: string;
    branchIdx: number[];
    tech?: { specialities: string[]; skillLevel: 'junior' | 'mid' | 'senior' | 'lead'; maxActiveJobs: number; workbench: string; hourlyCost: number };
  }[] = [
    { fullName: 'م. هشام عبدالرحمن', username: 'owner', role: 'owner', password: 'Owner@1234', branchIdx: [0, 1, 2] },
    { fullName: 'أ. منى السيد', username: 'manager', role: 'manager', password: 'Manager@1234', branchIdx: [0] },
    { fullName: 'أ. سارة فؤاد', username: 'reception', role: 'receptionist', password: 'Reception@1234', branchIdx: [0] },
    { fullName: 'أ. كريم منصور', username: 'accountant', role: 'accountant', password: 'Account@1234', branchIdx: [0, 1] },
    {
      fullName: 'م. أحمد عبدالله',
      username: 'tech.ahmed',
      role: 'technician',
      password: 'Tech@1234',
      branchIdx: [0],
      tech: { specialities: ['hardware', 'board-level', 'android'], skillLevel: 'senior', maxActiveJobs: 5, workbench: 'طاولة 1', hourlyCost: 70 },
    },
    {
      fullName: 'م. مصطفى الزيني',
      username: 'tech.mostafa',
      role: 'technician',
      password: 'Tech@1234',
      branchIdx: [0],
      tech: { specialities: ['iphone', 'software', 'hardware'], skillLevel: 'lead', maxActiveJobs: 4, workbench: 'طاولة 2', hourlyCost: 90 },
    },
    {
      fullName: 'م. محمود شعبان',
      username: 'tech.mahmoud',
      role: 'technician',
      password: 'Tech@1234',
      branchIdx: [0, 1],
      tech: { specialities: ['software', 'android'], skillLevel: 'mid', maxActiveJobs: 6, workbench: 'طاولة 3', hourlyCost: 55 },
    },
    {
      fullName: 'م. ياسمين حسن',
      username: 'tech.yasmin',
      role: 'technician',
      password: 'Tech@1234',
      branchIdx: [1],
      tech: { specialities: ['hardware', 'displays'], skillLevel: 'mid', maxActiveJobs: 5, workbench: 'طاولة 1 - المعادي', hourlyCost: 60 },
    },
    {
      fullName: 'م. إسلام الجندي',
      username: 'tech.islam',
      role: 'technician',
      password: 'Tech@1234',
      branchIdx: [2],
      tech: { specialities: ['board-level', 'water-damage'], skillLevel: 'senior', maxActiveJobs: 4, workbench: 'طاولة سموحة 1', hourlyCost: 75 },
    },
  ];

  const users: UserDoc[] = [];
  for (const data of usersData) {
    const user = new UserModel({
      organizationId,
      branchIds: data.branchIdx.map((i) => branches[i]!._id),
      fullName: data.fullName,
      username: data.username,
      email: `${data.username}@mobilecare-eg.com`,
      phone: randomEgyptPhone(),
      role: data.role,
      isActive: true,
      technicianProfile: data.tech
        ? {
            isTechnician: true,
            specialities: data.tech.specialities,
            skillLevel: data.tech.skillLevel,
            maxActiveJobs: data.tech.maxActiveJobs,
            hourlyCostEgp: data.tech.hourlyCost,
            workbench: data.tech.workbench,
          }
        : { isTechnician: false },
      lastLoginAt: daysAgo(randInt(0, 3)),
    });
    user.passwordHash = await bcrypt.hash(data.password, 12);
    user.passwordChangedAt = new Date();
    await user.save();
    users.push(user);
  }

  const owner = users[0]!;
  const technicians = users.filter((u) => u.role === 'technician');
  const receptionist = users.find((u) => u.role === 'receptionist')!;

  organization.createdBy = owner._id as Types.ObjectId;
  await organization.save();
  branchNasr.managerId = users[1]!._id as Types.ObjectId;
  await branchNasr.save();

  counts.users = users.length;

  const actor = { userId: String(owner._id), fullName: owner.fullName, role: owner.role };

  await runWithTenantContext(
    {
      actor: {
        userId: String(owner._id),
        organizationId,
        branchId: branchNasr._id as Types.ObjectId,
        role: 'owner',
        fullName: owner.fullName,
      },
      organizationId,
      branchId: branchNasr._id as Types.ObjectId,
      requestId: 'seed',
    },
    async () => {
      /* ---------------------- الموردون ---------------------- */
      const suppliers = [];
      for (const s of SUPPLIERS) {
        const supplier = await SupplierModel.create({
          organizationId,
          branchId: branchNasr._id,
          name: s.name,
          code: `SUP-${randInt(100, 999)}`,
          type: s.type,
          contactPerson: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
          phone: randomEgyptPhone(),
          address: { governorate: s.gov, area: s.area },
          paymentTerms: pick(['نقدي', 'أسبوع', 'نصف شهر', 'شهر']),
          performance: {
            avgLeadTimeDays: randInt(1, 6),
            rating: Number((3 + Math.random() * 2).toFixed(1)),
            totalPurchasedEgp: randInt(50_000, 400_000),
          },
          createdBy: owner._id,
        });
        suppliers.push(supplier);
      }
      counts.suppliers = suppliers.length;

      /* ---------------------- القطع والمخزون ---------------------- */
      const parts = [];
      for (const p of PARTS_CATALOG) {
        const supplier = pick(suppliers);
        const onHand = randInt(0, 26);
        const reserved = Math.min(onHand, randInt(0, 4));

        const part = await PartModel.create({
          organizationId,
          branchId: branchNasr._id,
          sku: p.sku,
          name: p.name,
          nameEn: p.sku.replace(/-/g, ' '),
          category: p.category,
          grade: p.grade,
          brand: p.brand,
          barcode: `62${randInt(1_000_000_000, 9_999_999_999)}`,
          compatibility: { deviceBrands: p.brand ? [p.brand] : [], deviceModels: p.models },
          pricing: {
            costEgp: p.cost,
            sellingPriceEgp: p.sell,
            wholesalePriceEgp: money(p.sell * 0.85),
            lastCostEgp: p.cost,
          },
          stock: {
            onHand,
            reserved,
            defective: randInt(0, 2),
            incoming: randInt(0, 10),
            reorderLevel: randInt(2, 5),
            reorderQty: randInt(5, 15),
          },
          warranty: { days: pick([30, 60, 90]), supplierDays: pick([7, 14, 30]), terms: 'ضمان ضد عيوب الصناعة فقط' },
          defaultSupplierId: supplier._id,
          createdBy: owner._id,
        });
        parts.push(part);

        await InventoryItemModel.create({
          organizationId,
          branchId: branchNasr._id,
          partId: part._id,
          quantity: { onHand, reserved, defective: randInt(0, 2), incoming: 0 },
          binLocation: `رف ${pick(['A', 'B', 'C'])}-${randInt(1, 12)}`,
          lastCountedAt: daysAgo(randInt(1, 40)),
          lastMovementAt: daysAgo(randInt(0, 20)),
          reorderLevel: part.stock?.reorderLevel ?? 3,
          reorderQty: part.stock?.reorderQty ?? 8,
          avgCostEgp: p.cost,
        });

        await StockMovementModel.create({
          organizationId,
          branchId: branchNasr._id,
          partId: part._id,
          type: 'initial',
          quantity: onHand,
          effect: { onHand },
          balanceAfter: { onHand },
          unitCostEgp: p.cost,
          totalCostEgp: money(onHand * p.cost),
          supplierId: supplier._id,
          reason: 'رصيد افتتاحي (بيانات تجريبية)',
          actorId: owner._id,
          actorName: owner.fullName,
          occurredAt: daysAgo(randInt(60, 200)),
        });

        // دفعة توريد
        if (onHand > 0) {
          await StockBatchModel.create({
            organizationId,
            branchId: branchNasr._id,
            partId: part._id,
            supplierId: supplier._id,
            batchCode: `B-${randInt(1000, 9999)}`,
            invoiceNumber: `PINV-${randInt(1000, 9999)}`,
            receivedAt: daysAgo(randInt(10, 90)),
            receivedBy: owner._id,
            unitCostEgp: p.cost,
            quantityReceived: onHand + randInt(0, 8),
            quantityAvailable: onHand,
            quantityUsed: randInt(0, 12),
            quantityDefective: randInt(0, 2),
            grade: p.grade,
            warrantyDays: 30,
            qualityStatus: pick(['good', 'good', 'good', 'unverified', 'suspect']),
            failureStats: { unitsFailed: randInt(0, 2), avgFailureAfterDays: randInt(5, 60), notes: '' },
          });
        }
      }
      counts.parts = parts.length;

      /* ---------------------- العملاء والأجهزة ---------------------- */
      const customers = [];
      const devices = [];

      for (let i = 0; i < 46; i += 1) {
        const isCompany = i % 11 === 0;
        const fullName = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
        const gov = pick(GOVERNORATES);
        const phone = randomEgyptPhone();

        const customer = await CustomerModel.create({
          organizationId,
          branchId: pick(branches)._id,
          code: `C${String(i + 1).padStart(5, '0')}`,
          fullName,
          phone,
          phoneAlt: Math.random() > 0.75 ? randomEgyptPhone() : '',
          email: Math.random() > 0.6 ? `customer${i}@example.com` : '',
          whatsapp: phone,
          type: isCompany ? 'company' : Math.random() > 0.9 ? 'reseller' : 'individual',
          companyName: isCompany ? `${pick(['تكنو', 'سمارت', 'دلتا', 'النخبة'])} ${pick(['للتجارة', 'للإلكترونيات', 'للتوريدات'])}` : '',
          address: { governorate: gov, area: pick(AREAS_BY_GOV[gov] ?? ['وسط البلد']) },
          tags: Math.random() > 0.7 ? [pick(['VIP', 'تاجر', 'عميل دائم'])] : [],
          consent: { marketingOptIn: Math.random() > 0.3, dataProcessingAcceptedAt: daysAgo(randInt(30, 200)) },
          createdBy: receptionist._id,
        });
        customers.push(customer);

        const deviceCount = randInt(1, 2);
        for (let d = 0; d < deviceCount; d += 1) {
          const catalog = pick(DEVICE_CATALOG);
          const device = await DeviceModel.create({
            organizationId,
            branchId: customer.branchId,
            customerId: customer._id,
            category: 'smartphone',
            brand: catalog.brand,
            model: catalog.model,
            modelNumber: `${catalog.brand.slice(0, 2).toUpperCase()}${randInt(1000, 9999)}`,
            imei: String(randInt(10_000_000_000_000, 99_999_999_999_999)),
            serial: `SN${randInt(1_000_000, 9_999_999)}`,
            color: pick(COLORS),
            storage: catalog.storage,
            ram: catalog.ram,
            hasLockCode: Math.random() > 0.4,
            lockType: pick(['none', 'pin', 'pattern', 'fingerprint'] as const),
            lockProvidedByCustomer: Math.random() > 0.5,
            conditionOnIntake: pick(['excellent', 'good', 'good', 'fair', 'poor'] as const),
            purchase: {
              purchasedFrom: pick(['المحل', 'توكيل', 'مستورد', 'من الخارج']),
              purchaseDate: daysAgo(randInt(60, 900)),
              warrantyStatus: pick(['unknown', 'in_warranty', 'out_of_warranty', 'shop_warranty'] as const),
            },
            createdBy: receptionist._id,
          });
          devices.push(device);
        }
      }
      counts.customers = customers.length;
      counts.devices = devices.length;

      /* ---------------------- تذاكر الصيانة ---------------------- */
      const statusesForHistory: RepairStatus[] = [
        'received', 'intake', 'inspection', 'diagnosis', 'estimate', 'waiting_approval',
        'approved', 'waiting_part', 'repairing', 'testing_qc', 'ready', 'customer_notified',
        'paid', 'delivered', 'warranty', 'cancelled',
      ];

      let ticketSeq = 0;
      let invoiceSeq = 0;
      let receiptSeq = 0;
      let claimSeq = 0;
      let estimateSeq = 0;

      const tickets = [];

      for (let i = 0; i < 84; i += 1) {
        const customer = pick(customers);
        const customerDevices = devices.filter((d) => String(d.customerId) === String(customer._id));
        if (!customerDevices.length) continue;
        const device = pick(customerDevices);
        const branch = pick(branches);
        const complaint = pick(COMPLAINTS);
        const priority = pick(['low', 'normal', 'normal', 'normal', 'high', 'high', 'urgent'] as const) as TicketPriority;

        /**
         * توزيع الحالات بشكل واقعي:
         * - التذاكر النشطة الآن أُنشئت خلال آخر 10 أيام فقط (الجهاز لا يبقى شهورًا في الورشة).
         * - التذاكر الأقدم انتهت (تسليم/ضمان/إلغاء).
         * الاعتماد على `ACTIVE_REPAIR_STATUSES` في الحالة النشطة كان يُنتج «تذاكر مفتوحة
         * منذ 200 يوم» وهو ما يجعل مؤشر متوسط عمر التذاكر المفتوحة غير منطقي.
         */
        const isActive = i < 30;
        let finalStatus: RepairStatus;
        if (isActive) {
          // مراحل التشغيل النشطة فقط، وبلا حالات نهائية
          finalStatus = pick([
            'received',
            'inspection',
            'diagnosis',
            'waiting_approval',
            'approved',
            'waiting_part',
            'repairing',
            'repairing',
            'testing_qc',
            'ready',
          ] as RepairStatus[]);
        } else {
          /**
           * التذاكر القديمة انتهت. لا نستخدم `warranty` كحالة نهائية هنا لأنها تعني
           * «تم التسليم مع claim ضمان مفتوح» — وclaims الضمان تُنشأ لاحقًا في السكربت
           * لكل تذكرة مُسلَّمة. جعل الحالة `warranty` مباشرة كان يُنتج claims مكررة
           * ويُفسد مؤشرات الضمان.
           */
          finalStatus = pick(['delivered', 'delivered', 'delivered', 'delivered', 'cancelled'] as RepairStatus[]);
        }

        const createdAt = isActive ? daysAgo(randInt(0, 9), randInt(0, 20)) : daysAgo(randInt(15, 220));
        const slaHours: Record<TicketPriority, number> = { low: 120, normal: 72, high: 24, urgent: 6 };
        const dueAt = addHours(createdAt, slaHours[priority]);

        const diag = DIAGNOSES[complaint.category] ?? DIAGNOSES.hardware!;
        const catalog = DEVICE_CATALOG.find((c) => c.brand === device.brand && c.model === device.model);

        ticketSeq += 1;
        const ticketNumber = formatSequenceNumber('REP', ticketSeq, createdAt);

        const labor = randInt(120, 750);
        const partsQuoted = randInt(1, 4) * randInt(300, 3200);
        const discount = Math.random() > 0.8 ? randInt(50, 200) : 0;

        const reachedDiagnosis = !['received', 'intake', 'inspection', 'cancelled'].includes(finalStatus) || Math.random() > 0.5;
        const reachedEstimate = reachedDiagnosis && !['received', 'intake', 'inspection', 'diagnosis', 'cancelled'].includes(finalStatus);
        const isDelivered = finalStatus === 'delivered' || finalStatus === 'warranty';

        const totalQuoted = money(labor + partsQuoted);
        const approvedTotal = finalStatus === 'cancelled' ? 0 : money(totalQuoted - discount);
        const isPaid = isDelivered || finalStatus === 'paid';
        const warrantyDays = isDelivered ? pick([30, 60, 90]) : 30;

        const ticket = await RepairTicketModel.create({
          organizationId,
          branchId: branch._id,
          ticketNumber,
          trackingToken: publicToken(24),
          customerId: customer._id,
          deviceId: device._id,
          status: finalStatus,
          priority,
          source: pick(['walk_in', 'walk_in', 'walk_in', 'whatsapp', 'phone', 'reseller'] as const),
          assignedTechnicianId: Math.random() > 0.08 ? pick(technicians)._id : null,
          assignedAt: createdAt,
          assignedBy: receptionist._id,
          intake: {
            receivedAt: createdAt,
            receivedBy: receptionist._id,
            complaint: complaint.text,
            complaintCategory: complaint.category,
            visualCondition: {
              screenCracked: complaint.category === 'display',
              backGlassBroken: complaint.category === 'back_glass',
              frameDented: Math.random() > 0.7,
              waterDamageSigns: complaint.category === 'water_damage',
              buttonsWorking: complaint.category !== 'hardware',
              chargingPortCondition: complaint.category === 'charging' ? 'damaged' : 'good',
              cameraCondition: complaint.category === 'camera' ? 'damaged' : 'good',
            },
            accessories: Math.random() > 0.5 ? ['sim_tray'] : [],
            customerAcknowledged: true,
            acknowledgedAt: createdAt,
            dataLossDisclaimerAccepted: true,
            devicePasswordProvided: Math.random() > 0.4,
            initialTests: DEFAULT_QC_ITEMS.slice(0, 8).map((item) => ({
              key: item.key,
              label: item.key,
              labelAr: item.labelAr,
              status: 'pending' as const,
              notes: '',
            })),
            estimatedDeliveryAt: dueAt,
            internalNotes: '',
          },
          diagnosis: reachedDiagnosis
            ? {
                summary: diag.summary,
                faultCategory: complaint.category,
                faultSeverity: diag.severity as 'minor' | 'moderate' | 'major' | 'critical',
                rootCause: diag.cause,
                requiredActions: ['فحص دقيق', 'استبدال الجزء التالف', 'اختبار بعد الإصلاح'],
                needsParts: partsQuoted > 0,
                isBoardLevel: diag.boardLevel,
                diagnosisNotes: 'تم الفحص بمعدات الورشة',
                diagnosedBy: pick(technicians)._id,
                diagnosedAt: addHours(createdAt, randInt(2, 20)),
                confidence: pick(['low', 'medium', 'high'] as const),
              }
            : {},
          sla: {
            dueAt,
            breached:
              !isActive &&
              createdAt.getTime() + slaHours[priority] * 3_600_000 <
                (isDelivered ? addHours(createdAt, randInt(30, 300)).getTime() : Date.now()),
            breachedAt: null,
            pausedAt: null,
            pausedMinutes: 0,
          },
          cost: {
            laborQuotedEgp: reachedEstimate ? labor : 0,
            laborActualEgp: isDelivered ? labor : reachedEstimate ? labor : 0,
            partsQuotedEgp: reachedEstimate ? partsQuoted : 0,
            partsActualEgp: isDelivered ? partsQuoted : ['repairing', 'testing_qc', 'ready', 'paid'].includes(finalStatus) ? partsQuoted : 0,
            discountEgp: discount,
            taxEgp: 0,
            totalQuotedEgp: reachedEstimate ? totalQuoted : 0,
            totalFinalEgp: isDelivered || finalStatus === 'paid' ? approvedTotal : reachedEstimate ? approvedTotal : 0,
            paidEgp: isPaid ? approvedTotal : 0,
            dueEgp: isPaid ? 0 : approvedTotal,
          },
          warranty: {
            policyDays: warrantyDays,
            partsDays: 90,
            laborDays: 14,
            startsAt: isDelivered ? addHours(createdAt, randInt(50, 300)) : null,
            expiresAt: isDelivered ? addDays(createdAt, randInt(50, 300) / 24 + warrantyDays) : null,
            terms: 'الضمان لا يشمل الكسر أو السوائل أو التدخل الخارجي',
            isVoid: false,
          },
          outcome: isDelivered ? pick(['repaired', 'repaired', 'repaired', 'partially_repaired'] as const) : 'pending',
          evidence: {
            // مركز يطبّق سياسة التوثيق: معظم الأجهزة لها صور استلام وإقرار
            intakePhotoCount: Math.random() > 0.08 ? randInt(1, 4) : 0,
            repairPhotoCount: reachedEstimate && Math.random() > 0.4 ? randInt(1, 3) : 0,
            hasSignature: Math.random() > 0.1,
            hasQcEvidence: ['testing_qc', 'ready', 'customer_notified', 'paid', 'delivered', 'warranty'].includes(finalStatus),
          },
          followUp: {
            lastNotifiedAt: Math.random() > 0.3 ? daysAgo(randInt(0, 10)) : null,
            notificationCount: randInt(0, 6),
            reviewRequestedAt: isDelivered && Math.random() > 0.6 ? daysAgo(randInt(1, 20)) : null,
            reviewScore: isDelivered && Math.random() > 0.6 ? randInt(3, 5) : null,
          },
          repairingStartedAt: ['repairing', 'testing_qc', 'ready', 'customer_notified', 'paid', 'delivered', 'warranty'].includes(finalStatus)
            ? addHours(createdAt, randInt(4, 30))
            : null,
          qcStartedAt: ['testing_qc', 'ready', 'customer_notified', 'paid', 'delivered', 'warranty'].includes(finalStatus)
            ? addHours(createdAt, randInt(20, 60))
            : null,
          readyAt: ['ready', 'customer_notified', 'paid', 'delivered', 'warranty'].includes(finalStatus)
            ? addHours(createdAt, randInt(30, 80))
            : null,
          deliveredAt: isDelivered ? addHours(createdAt, randInt(40, 200)) : null,
          promisedAt: dueAt,
          tags: [],
          internalNotes: '',
          customerVisibleNotes: '',
          createdBy: receptionist._id,
          createdAt,
          updatedAt: isDelivered ? addHours(createdAt, randInt(40, 200)) : new Date(),
        });
        tickets.push({ ticket, createdAt, finalStatus, device, customer, branch, diag, reachedDiagnosis, reachedEstimate, isDelivered, isPaid, labor, partsQuoted, approvedTotal, complaint, catalog });
      }
      counts.tickets = tickets.length;

      /* --------- Timeline كامل لكل تذكرة حتى حالتها النهائية --------- */
      for (const entry of tickets) {
        const { ticket, createdAt, finalStatus, reachedDiagnosis, reachedEstimate, isDelivered } = entry;

        // المسار المنطقي للحالة النهائية
        const path: RepairStatus[] = ['received'];
        if (finalStatus === 'cancelled') {
          path.push('inspection', 'cancelled');
        } else {
          path.push('intake', 'inspection');
          if (reachedDiagnosis) path.push('diagnosis');
          if (reachedEstimate) path.push('estimate', 'waiting_approval', 'approved');
          if (['waiting_part', 'repairing', 'testing_qc', 'ready', 'customer_notified', 'paid', 'delivered', 'warranty'].includes(finalStatus) && !path.includes('repairing') && path.includes('approved')) {
            if (finalStatus === 'waiting_part') path.push('waiting_part');
            else path.push('repairing');
          }
          if (['testing_qc'].includes(finalStatus)) path.push('testing_qc');
          if (['ready', 'customer_notified', 'paid', 'delivered', 'warranty'].includes(finalStatus)) path.push('testing_qc', 'ready');
          if (['customer_notified', 'paid', 'delivered', 'warranty'].includes(finalStatus)) path.push('customer_notified');
          if (['paid', 'delivered', 'warranty'].includes(finalStatus)) path.push('paid');
          if (isDelivered) path.push('delivered');
          if (finalStatus === 'warranty') path.push('warranty');
        }

        // إزالة التكرار مع الحفاظ على الترتيب
        const uniquePath = path.filter((s, idx) => path.indexOf(s) === idx);
        if (uniquePath[uniquePath.length - 1] !== finalStatus && !uniquePath.includes(finalStatus)) {
          uniquePath.push(finalStatus);
        }

        let cursor = createdAt;
        let previous: RepairStatus | null = null;

        for (let step = 0; step < uniquePath.length; step += 1) {
          const status = uniquePath[step]!;
          const isLast = step === uniquePath.length - 1;
          const durationMinutes = step === 0 ? 15 : randInt(20, 1_800);
          const at = new Date(cursor.getTime());
          cursor = addHours(cursor, durationMinutes / 60);

          const tech = pick(technicians);
          await RepairStatusHistoryModel.create({
            organizationId,
            branchId: entry.branch._id,
            ticketId: ticket._id,
            deviceId: entry.device._id,
            fromStatus: previous,
            toStatus: status,
            eventType: 'status_changed',
            note: '',
            actorId: step === 0 ? receptionist._id : pick(technicians)._id,
            actorName: step === 0 ? receptionist.fullName : `${pick(FIRST_NAMES)} (فني)`,
            actorRole: step === 0 ? 'receptionist' : 'technician',
            technicianId: step > 1 ? tech._id : null,
            durationMinutes,
            station: status === 'repairing' ? (tech.technicianProfile?.workbench ?? '') : '',
            metadata: {},
            createdAt: at,
          });
          previous = status;
          if (isLast) break;
        }
      }
      counts.timelineEvents = await RepairStatusHistoryModel.countDocuments();

      /* ---------------------- العروض والموافقات ---------------------- */
      for (const entry of tickets) {
        if (!entry.reachedEstimate || entry.finalStatus === 'cancelled') continue;
        const { ticket, labor, partsQuoted, approvedTotal } = entry;

        estimateSeq += 1;
        const estimate = await EstimateModel.create({
          organizationId,
          branchId: entry.branch._id,
          estimateNumber: formatSequenceNumber('EST', estimateSeq),
          ticketId: ticket._id,
          customerId: ticket.customerId,
          deviceId: ticket.deviceId,
          version: 1,
          status: entry.finalStatus === 'waiting_approval' ? 'sent' : 'approved',
          lines: [
            {
              kind: 'part',
              partId: pick(parts)._id,
              description: `قطعة غيار لإصلاح ${entry.diag.summary.slice(0, 60)}`,
              quantity: 1,
              unitPriceEgp: partsQuoted,
              totalEgp: partsQuoted,
              approved: true,
              warrantyDays: 90,
            },
            {
              kind: 'labor',
              description: `مصنعية: ${entry.complaint.category}`,
              quantity: 1,
              unitPriceEgp: labor,
              totalEgp: labor,
              approved: true,
              warrantyDays: 14,
            },
          ],
          totals: {
            partsEgp: partsQuoted,
            laborEgp: labor,
            subtotalEgp: money(labor + partsQuoted),
            discountEgp: ticket.cost.discountEgp ?? 0,
            discountPct: 0,
            taxRatePct: 14,
            taxEgp: 0,
            totalEgp: money(labor + partsQuoted),
            approvedTotalEgp: approvedTotal,
          },
          estimatedDurationHours: randInt(4, 72),
          warrantyOfferedDays: ticket.warranty.policyDays,
          terms: 'الضمان لا يشمل الكسر أو السوائل',
          customerNotes: 'الأسعار شاملة الضريبة',
          internalNotes: '',
          validUntil: addDays(ticket.createdAt as unknown as Date, 7),
          sentAt: addHours(ticket.createdAt as unknown as Date, 10),
          sentVia: pick(['whatsapp', 'print', 'in_person', 'portal'] as const),
          decidedAt: entry.finalStatus === 'waiting_approval' ? null : addHours(ticket.createdAt as unknown as Date, 14),
          createdBy: pick(technicians)._id,
          approvedBy: entry.finalStatus === 'waiting_approval' ? null : owner._id,
        });

        if (entry.finalStatus !== 'waiting_approval') {
          await ApprovalModel.create({
            organizationId,
            branchId: entry.branch._id,
            ticketId: ticket._id,
            estimateId: estimate._id,
            customerId: ticket.customerId,
            decision: pick(['approved', 'approved', 'approved', 'approved', 'partially_approved'] as const),
            channel: pick(['in_person', 'phone', 'whatsapp', 'portal'] as const),
            approvedLineIds: estimate.lines.map((l) => String(l._id)),
            approvedAmountEgp: approvedTotal,
            customerComment: '',
            customerPhone: entry.customer.phone,
            otpVerified: Math.random() > 0.7,
            ipAddress: '197.45.x.x',
            recordedBy: receptionist._id,
            decidedAt: addHours(ticket.createdAt as unknown as Date, 14),
          });
        }
      }
      counts.estimates = await EstimateModel.countDocuments();
      counts.approvals = await ApprovalModel.countDocuments();

      /* ---------------------- القطع والمصنعية المستخدمة ---------------------- */
      for (const entry of tickets) {
        const usedStatuses: RepairStatus[] = ['repairing', 'testing_qc', 'ready', 'customer_notified', 'paid', 'delivered', 'warranty'];
        if (!usedStatuses.includes(entry.finalStatus)) continue;

        const part = pick(parts);
        const unitCost = part.pricing?.costEgp ?? 0;
        const unitPrice = part.pricing?.sellingPriceEgp ?? 0;
        const isDefective = Math.random() > 0.94;

        await RepairPartModel.create({
          organizationId,
          branchId: entry.branch._id,
          ticketId: entry.ticket._id,
          deviceId: entry.device._id,
          partId: part._id,
          supplierId: part.defaultSupplierId,
          quantity: 1,
          status: isDefective ? 'defective' : 'installed',
          unitCostEgp: unitCost,
          unitPriceEgp: unitPrice,
          totalCostEgp: unitCost,
          totalPriceEgp: unitPrice,
          grade: part.grade,
          warrantyDays: part.warranty?.days ?? 30,
          warrantyExpiresAt: addDays(new Date(), part.warranty?.days ?? 30),
          installedBy: entry.ticket.assignedTechnicianId ?? pick(technicians)._id,
          installedAt: addHours(entry.ticket.createdAt as unknown as Date, randInt(20, 50)),
          failedAt: isDefective ? daysAgo(randInt(1, 25)) : null,
          failureReason: isDefective ? pick(['توقف عن العمل بعد أيام', 'عيب صناعة', 'لم يستجب بعد التركيب']) : '',
          notes: '',
          addedBy: pick(technicians)._id,
        });

        await RepairLaborModel.create({
          organizationId,
          branchId: entry.branch._id,
          ticketId: entry.ticket._id,
          description: `مصنعية ${entry.complaint.category}`,
          category: entry.diag.boardLevel ? 'board_level' : 'repair',
          hours: randInt(1, 5),
          ratePerHourEgp: 80,
          amountEgp: entry.labor,
          technicianId: entry.ticket.assignedTechnicianId ?? pick(technicians)._id,
          isWarrantyWork: false,
          addedBy: pick(technicians)._id,
        });
      }
      counts.repairParts = await RepairPartModel.countDocuments();
      counts.repairLabor = await RepairLaborModel.countDocuments();

      /* ---------------------- فحص الجودة ---------------------- */
      const qcStatuses: RepairStatus[] = ['testing_qc', 'ready', 'customer_notified', 'paid', 'delivered', 'warranty'];
      for (const entry of tickets) {
        if (!qcStatuses.includes(entry.finalStatus)) continue;

        // 8% من الحالات تحتاج محاولة ثانية (مؤشر واقعي للجودة)
        const needsSecond = Math.random() > 0.92;
        const attempts = needsSecond ? 2 : 1;

        for (let attempt = 1; attempt <= attempts; attempt += 1) {
          const isLastAttempt = attempt === attempts;
          const failed = needsSecond && attempt === 1;

          const items = DEFAULT_QC_ITEMS.map((item) => ({
            key: item.key,
            labelAr: item.labelAr,
            required: item.required,
            result: failed && item.required && Math.random() > 0.6 ? ('fail' as const) : ('pass' as const),
            notes: '',
            checkedBy: pick(technicians)._id,
            checkedAt: addHours(entry.ticket.createdAt as unknown as Date, randInt(30, 70)),
          }));

          const hasFail = items.some((i) => i.result === 'fail');

          await QualityCheckModel.create({
            organizationId,
            branchId: entry.branch._id,
            ticketId: entry.ticket._id,
            deviceId: entry.device._id,
            technicianId: entry.ticket.assignedTechnicianId,
            inspectorId: pick(technicians)._id,
            attempt,
            result: hasFail ? 'failed' : Math.random() > 0.85 ? 'passed_with_notes' : 'passed',
            items,
            measurements: {
              batteryHealthPct: randInt(78, 100),
              chargingCurrentA: Number((0.8 + Math.random() * 1.6).toFixed(2)),
              bootTimeSeconds: randInt(12, 45),
              screenTestResult: 'اجتاز اختبار الألوان واللمس',
              networkSignalDbm: -randInt(60, 95),
            },
            functionalTests: ['مكالمة تجريبية', 'اختبار واي فاي', 'اختبار بلوتوث', 'اختبار GPS'],
            failureReasons: hasFail ? ['لم يجتز اختبار السماعة'] : [],
            notes: hasFail ? 'تمت إعادة الجهاز للفني لاستبدال السماعة' : '',
            startedAt: addHours(entry.ticket.createdAt as unknown as Date, randInt(30, 65)),
            completedAt: addHours(entry.ticket.createdAt as unknown as Date, randInt(66, 80)),
            durationMinutes: randInt(8, 40),
            requiresReRepair: Boolean(hasFail),
            reRepairReason: hasFail ? 'لم يجتز فحص السماعة' : '',
          });
        }
      }
      counts.qualityChecks = await QualityCheckModel.countDocuments();

      /* ---------------------- الفواتير والمدفوعات ---------------------- */
      for (const entry of tickets) {
        if (!entry.isDelivered && entry.finalStatus !== 'paid') continue;
        if (entry.approvedTotal <= 0) continue;

        invoiceSeq += 1;
        const issuedAt = addHours(entry.ticket.createdAt as unknown as Date, randInt(60, 120));

        const invoice = await InvoiceModel.create({
          organizationId,
          branchId: entry.branch._id,
          invoiceNumber: formatSequenceNumber('INV', invoiceSeq, issuedAt),
          type: 'repair',
          status: 'paid',
          customerId: entry.customer._id,
          deviceId: entry.device._id,
          ticketId: entry.ticket._id,
          lines: [
            { kind: 'part', description: 'قطع غيار مستخدمة في الإصلاح', quantity: 1, unitPriceEgp: entry.partsQuoted, totalEgp: entry.partsQuoted, warrantyDays: 90 },
            { kind: 'labor', description: 'مصنعية الإصلاح', quantity: 1, unitPriceEgp: entry.labor, totalEgp: entry.labor, warrantyDays: 14 },
          ],
          totals: {
            subtotalEgp: money(entry.labor + entry.partsQuoted),
            discountEgp: entry.ticket.cost.discountEgp ?? 0,
            taxRatePct: 14,
            taxEgp: 0,
            totalEgp: entry.approvedTotal,
            paidEgp: entry.approvedTotal,
            dueEgp: 0,
            changeEgp: 0,
          },
          issuedAt,
          dueAt: issuedAt,
          paidAt: addHours(issuedAt, randInt(1, 6)),
          notes: '',
          customerNotes: 'شكرًا لتعاملكم معنا',
          createdBy: receptionist._id,
          cashierId: users.find((u) => u.role === 'accountant')!._id,
        });

        receiptSeq += 1;
        const method = pick(['cash', 'cash', 'cash', 'card', 'wallet', 'instapay'] as const);
        await PaymentModel.create({
          organizationId,
          branchId: entry.branch._id,
          receiptNumber: formatSequenceNumber('RCP', receiptSeq, issuedAt),
          direction: 'in',
          method,
          amountEgp: entry.approvedTotal,
          invoiceId: invoice._id,
          ticketId: entry.ticket._id,
          customerId: entry.customer._id,
          reference: method === 'instapay' ? `IPN${randInt(100000, 999999)}` : '',
          walletNumber: method === 'wallet' ? randomEgyptPhone() : '',
          cardLast4: method === 'card' ? String(randInt(1000, 9999)) : '',
          tenderedEgp: method === 'cash' ? entry.approvedTotal + pick([0, 10, 50]) : entry.approvedTotal,
          changeEgp: method === 'cash' ? pick([0, 10, 50]) : 0,
          recordedBy: users.find((u) => u.role === 'accountant')!._id,
          paidAt: addHours(issuedAt, randInt(1, 6)),
        });
      }

      // فواتير آجلة غير مسددة (مستحقات)
      for (const entry of tickets.slice(0, 5)) {
        if (entry.isDelivered) continue;
        invoiceSeq += 1;
        const issuedAt = daysAgo(randInt(1, 25));
        await InvoiceModel.create({
          organizationId,
          branchId: entry.branch._id,
          invoiceNumber: formatSequenceNumber('INV', invoiceSeq, issuedAt),
          type: 'repair',
          status: 'issued',
          customerId: entry.customer._id,
          deviceId: entry.device._id,
          ticketId: entry.ticket._id,
          lines: [{ kind: 'service', description: 'خدمة صيانة آجلة', quantity: 1, unitPriceEgp: 850, totalEgp: 850, warrantyDays: 0 }],
          totals: { subtotalEgp: 850, discountEgp: 0, taxRatePct: 14, taxEgp: 0, totalEgp: 850, paidEgp: 0, dueEgp: 850, changeEgp: 0 },
          issuedAt,
          dueAt: addDays(issuedAt, 7),
          createdBy: receptionist._id,
        });
      }
      counts.invoices = await InvoiceModel.countDocuments();
      counts.payments = await PaymentModel.countDocuments();

      /* ---------------------- المصروفات ---------------------- */
      for (let month = 0; month < 4; month += 1) {
        for (const e of EXPENSE_TITLES) {
          if (e.category === 'misc' && month > 0) continue;
          await ExpenseModel.create({
            organizationId,
            branchId: pick(branches)._id,
            title: e.title,
            category: e.category,
            amountEgp: randInt(e.min, e.max),
            method: pick(['cash', 'bank_transfer', 'instapay'] as const),
            incurredAt: daysAgo(month * 30 + randInt(1, 28)),
            supplierId: e.category === 'parts_purchase' ? pick(suppliers)._id : null,
            notes: '',
            isRecurring: ['rent', 'salaries', 'utilities', 'internet_phone'].includes(e.category),
            recurrence: ['rent', 'salaries', 'utilities', 'internet_phone'].includes(e.category) ? 'monthly' : 'none',
            createdBy: users.find((u) => u.role === 'accountant')!._id,
          });
        }
      }
      counts.expenses = await ExpenseModel.countDocuments();

      /* ---------------------- عوائد الضمان ---------------------- */
      const deliveredEntries = tickets.filter((t) => t.isDelivered && t.finalStatus === 'delivered');
      for (const entry of deliveredEntries.slice(0, 9)) {
        claimSeq += 1;
        const reportedAt = daysAgo(randInt(1, 40));
        const daysSinceDelivery = randInt(2, 30);
        const sameFault = Math.random() > 0.4;
        const misuse = Math.random() > 0.75;

        /**
         * تذكرة العودة: نحاكي ما يحدث فعليًا — معظم عوائد الضمان تُغلق بسرعة،
         * وعدد صغير فقط يبقى قيد العمل. لو تركتها مفتوحة بتاريخ قديم ستُفسد مؤشر
         * «متوسط عمر التذاكر المفتوحة». لذلك الفتح يكون بتواريخ حديثة فقط.
         */
        const claimResolved = misuse || Math.random() > 0.45;
        const returnStatus: RepairStatus = claimResolved
          ? 'delivered'
          : pick(['diagnosis', 'repairing'] as RepairStatus[]);
        const returnOpenedAt = claimResolved ? reportedAt : daysAgo(randInt(1, 5), randInt(0, 18));

        // تذكرة عودة
        ticketSeq += 1;
        const newTicket = await RepairTicketModel.create({
          organizationId,
          branchId: entry.branch._id,
          ticketNumber: formatSequenceNumber('REP', ticketSeq, returnOpenedAt),
          trackingToken: publicToken(24),
          customerId: entry.customer._id,
          deviceId: entry.device._id,
          status: returnStatus,
          priority: 'high',
          source: 'return_warranty',
          intake: {
            receivedAt: returnOpenedAt,
            receivedBy: receptionist._id,
            complaint: `عودة ضمان: ${entry.complaint.text}`,
            complaintCategory: entry.complaint.category,
            customerAcknowledged: true,
            acknowledgedAt: returnOpenedAt,
          },
          warranty: { policyDays: 0 },
          tags: ['warranty_return'],
          deliveredAt: returnStatus === 'delivered' ? addHours(returnOpenedAt, randInt(24, 96)) : null,
          outcome: returnStatus === 'delivered' ? 'repaired' : 'pending',
          createdBy: receptionist._id,
          createdAt: returnOpenedAt,
        });

        const claim = await WarrantyClaimModel.create({
          organizationId,
          branchId: entry.branch._id,
          claimNumber: formatSequenceNumber('WCL', claimSeq, reportedAt),
          customerId: entry.customer._id,
          deviceId: entry.device._id,
          originalTicketId: entry.ticket._id,
          originalRepairPartIds: [],
          originalTechnicianId: entry.ticket.assignedTechnicianId,
          newTicketId: newTicket._id,
          status: claimResolved
            ? pick(['resolved', 'resolved', 'resolved', 'rejected'] as const)
            : pick(['in_repair', 'approved'] as const),
          coverage: pick(['part', 'both', 'both', 'labor'] as const),
          reportedAt,
          daysSinceDelivery,
          symptom: sameFault ? `نفس العطل رجع: ${entry.complaint.text}` : 'عطل مختلف عن الإصلاح السابق',
          isSameFault: sameFault,
          faultCategory: entry.complaint.category,
          misuseSuspected: misuse,
          physicalDamageFound: misuse && Math.random() > 0.5,
          liquidDamageFound: misuse && Math.random() > 0.7,
          thirdPartyIntervention: misuse && Math.random() > 0.8,
          decisionNotes: misuse ? 'تحمّل العميل جزءًا من التكلفة بسبب سوء استخدام' : 'مغطى بالضمان',
          rejectedReason: misuse ? 'وجود آثار سوائل وكسر خارجي' : '',
          approvedBy: owner._id,
          decidedAt: addHours(reportedAt, randInt(2, 24)),
          repairCostEgp: randInt(150, 2400),
          chargedToCustomerEgp: misuse ? randInt(100, 900) : 0,
          chargedToSupplierEgp: !misuse ? randInt(0, 700) : 0,
          supplierId: !misuse ? pick(suppliers)._id : null,
          supplierClaimStatus: !misuse ? pick(['requested', 'accepted', 'rejected'] as const) : 'not_applicable',
          resolutionNotes: 'تم استبدال القطعة وإعادة الاختبار',
          resolvedAt: addDays(reportedAt, 3),
          createdBy: receptionist._id,
        });

        await DeviceModel.updateOne({ _id: entry.device._id }, { $inc: { 'passport.warrantyClaims': 1 } });
        void claim;
      }
      counts.warrantyClaims = await WarrantyClaimModel.countDocuments();

      /* ---------------------- تحديث جواز الجهاز والعملاء ---------------------- */
      for (const device of devices) {
        const deviceTickets = tickets.filter((t) => String(t.device._id) === String(device._id));
        const deliveredTickets = deviceTickets.filter((t) => t.isDelivered);
        const openTickets = deviceTickets.filter((t) => !t.isDelivered && t.finalStatus !== 'cancelled');

        if (!deviceTickets.length) continue;

        await DeviceModel.updateOne(
          { _id: device._id },
          {
            $set: {
              'passport.totalRepairs': deliveredTickets.length,
              'passport.totalSpentEgp': money(deliveredTickets.reduce((a, t) => a + t.approvedTotal, 0)),
              'passport.openTickets': openTickets.length,
              'passport.warrantyClaims': await WarrantyClaimModel.countDocuments({ deviceId: device._id }),
              'passport.lastServiceAt': deviceTickets[deviceTickets.length - 1]!.createdAt,
              'passport.lastTechnicianId': deviceTickets[deviceTickets.length - 1]!.ticket.assignedTechnicianId,
              'passport.riskFlags': [
                ...(deviceTickets.some((t) => t.complaint.category === 'water_damage') ? ['liquid_damage'] : []),
                ...(deviceTickets.some((t) => t.diag.boardLevel) ? ['board_level'] : []),
                ...(deliveredTickets.length > 1 ? ['previous_repair'] : []),
              ],
              'passport.replacedParts': [...new Set(deviceTickets.map((t) => t.complaint.category))],
            },
          },
        );
      }

      for (const customer of customers) {
        const customerTickets = tickets.filter((t) => String(t.customer._id) === String(customer._id));
        await CustomerModel.updateOne(
          { _id: customer._id },
          {
            $set: {
              'stats.totalTickets': customerTickets.length,
              'stats.openTickets': customerTickets.filter((t) => !t.isDelivered && t.finalStatus !== 'cancelled').length,
              'stats.totalSpentEgp': money(customerTickets.filter((t) => t.isDelivered).reduce((a, t) => a + t.approvedTotal, 0)),
              'stats.lastVisitAt': customerTickets.length ? customerTickets[customerTickets.length - 1]!.createdAt : null,
              'stats.warrantyClaims': await WarrantyClaimModel.countDocuments({ customerId: customer._id }),
            },
          },
        );
      }

      /* ---------------------- الإشعارات ---------------------- */
      for (const entry of tickets.slice(0, 40)) {
        const count = randInt(1, 4);
        for (let n = 0; n < count; n += 1) {
          const type = pick([
            'device_received',
            'diagnosis_completed',
            'estimate_ready',
            'repair_started',
            'ready_for_pickup',
            'delivered',
          ] as const);
          // ممنوع تواريخ مستقبلية: نثبّت القيمة عند «الآن − دقيقة» كحد أقصى
          const at = new Date(Math.min(addHours(entry.createdAt, randInt(1, 100)).getTime(), Date.now() - 60_000));
          await NotificationModel.create({
            organizationId,
            branchId: entry.branch._id,
            type,
            channel: pick(['whatsapp', 'whatsapp', 'sms', 'in_app'] as const),
            status: pick(['sent', 'sent', 'delivered', 'read', 'failed'] as const),
            customerId: entry.customer._id,
            ticketId: entry.ticket._id,
            deviceId: entry.device._id,
            toPhone: entry.customer.phone,
            subject: '',
            body: `تحديث على تذكرة ${entry.ticket.ticketNumber}`,
            templateKey: type,
            variables: { ticketNumber: entry.ticket.ticketNumber },
            provider: 'log',
            attempts: 1,
            trackingUrl: `/track/${entry.ticket.trackingToken}`,
            sentAt: at,
            createdAt: at,
          });
        }
      }
      counts.notifications = await NotificationModel.countDocuments();

      /* ---------------------- سجل التدقيق ---------------------- */
      const auditSamples = [
        { action: 'login' as const, resource: 'User', summary: 'تسجيل دخول' },
        { action: 'create' as const, resource: 'RepairTicket', summary: 'إنشاء تذكرة صيانة' },
        { action: 'status_transition' as const, resource: 'RepairTicket', summary: 'تغيير حالة تذكرة' },
        { action: 'stock_adjust' as const, resource: 'StockMovement', summary: 'حركة مخزون' },
        { action: 'payment' as const, resource: 'Payment', summary: 'تحصيل مبلغ' },
        { action: 'update' as const, resource: 'Customer', summary: 'تحديث بيانات عميل' },
        { action: 'file_upload' as const, resource: 'RepairTicket', summary: 'رفع صور استلام' },
      ];
      for (let i = 0; i < 120; i += 1) {
        const sample = pick(auditSamples);
        const user = pick(users);
        const at = daysAgo(randInt(0, 90), randInt(0, 23));
        await AuditLogModel.create({
          organizationId,
          branchId: pick(branches)._id,
          action: sample.action,
          resource: sample.resource,
          resourceId: pick(tickets).ticket._id,
          summary: sample.summary,
          actorId: user._id,
          actorName: user.fullName,
          actorRole: user.role,
          ip: `197.${randInt(1, 250)}.${randInt(1, 250)}.${randInt(1, 250)}`,
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          requestId: publicToken(8),
          method: sample.action === 'create' ? 'POST' : 'PATCH',
          path: `/api/v1/${sample.resource.toLowerCase()}`,
          statusCode: 200,
          severity: sample.action === 'stock_adjust' ? 'warning' : 'info',
          occurredAt: at,
          createdAt: at,
        });
      }
      counts.auditLogs = await AuditLogModel.countDocuments();

      /* ---------------------- قاعدة المعرفة ---------------------- */
      const articles = [
        {
          title: 'الجهاز لا يشحن - خطوات التشخيص الكاملة',
          brand: 'Generic',
          models: ['Galaxy A15', 'Redmi Note 13', 'A78'],
          category: 'charging' as const,
          symptom: 'الجهاز لا يشحن أو يشحن بشكل متقطع',
          diagnosticSteps: [
            { step: 1, instruction: 'جرّب شاحن وكابل مختلفين للتأكد من العطل', expectedResult: 'إذا شحن فالعطل في الملحقات', toolRequired: 'شاحن أصلي' },
            { step: 2, instruction: 'افحص منفذ الشحن بصريًا بحثًا عن تأكسد أو أعواد دخيلة', expectedResult: 'منفذ نظيف بلا تأكسد', toolRequired: 'عدسة مكبرة' },
            { step: 3, instruction: 'قياس جهد الشحن على أطراف المنفذ', expectedResult: '5 فولت تقريبًا', toolRequired: 'أفوميتر' },
            { step: 4, instruction: 'فحص مسار الشحن على البوردة واختبار IC الشحن', expectedResult: 'لا يوجد قطع في المسار', toolRequired: 'ميكروسكوب + أفوميتر' },
          ],
          knownCauses: [
            { cause: 'تلف منفذ الشحن', likelihood: 'high' as const, verifyBy: 'فحص بصري وقياس الجهد' },
            { cause: 'عطل في IC الشحن', likelihood: 'medium' as const, verifyBy: 'قياس الجهود على أطراف IC' },
            { cause: 'بطارية تالفة', likelihood: 'medium' as const, verifyBy: 'اختبار البطارية بمقياس سعة' },
            { cause: 'كابل أو شاحن غير أصلي', likelihood: 'high' as const, verifyBy: 'تجربة شاحن أصلي' },
          ],
          repairNotes: 'استبدال منفذ الشحن يتطلب حرارة 380-400 درجة وسلك لحام رقيق. يجب اختبار الشحن قبل تركيب الظهر.',
          requiredTools: ['هوت إير', 'أفوميتر', 'مكواة لحام', 'فلكس'],
          difficulty: 'medium' as const,
          estimatedMinutes: 45,
          riskWarnings: ['الحرارة الزائدة قد تتلف البلاستيك المحيط بالمنفذ'],
          tags: ['charging', 'android', 'common'],
          status: 'published' as const,
          outcomes: { timesApplied: 148, timesSuccessful: 138, successRatePct: 93.24, avgMinutes: 42 },
        },
        {
          title: 'أثار سوائل: بروتوكول التنظيف والفحص',
          brand: 'Generic',
          models: [],
          category: 'water_damage' as const,
          symptom: 'الجهاز تعرض للماء ولا يعمل أو يعمل بشكل متقطع',
          diagnosticSteps: [
            { step: 1, instruction: 'افصل البطارية فورًا ولا تحاول التشغيل', expectedResult: 'الجهاز مفصول تمامًا', toolRequired: 'أدوات فك' },
            { step: 2, instruction: 'فك البوردة بالكامل وافحص آثار التأكسد تحت الميكروسكوب', expectedResult: 'تحديد مناطق التأكسد بدقة', toolRequired: 'ميكروسكوب' },
            { step: 3, instruction: 'تنظيف بالموجات فوق الصوتية مع سائل تنظيف مخصص', expectedResult: 'إزالة الأملاح والتأكسد', toolRequired: 'جهاز موجات فوق صوتية' },
            { step: 4, instruction: 'تجفيف كامل ثم فحص المسارات التالفة وإصلاحها', expectedResult: 'استمرارية المسارات سليمة', toolRequired: 'أفوميتر + سلك تعويض' },
            { step: 5, instruction: 'توصيل البوردة بمصدر طاقة محدود التيار وقياس الاستهلاك', expectedResult: 'استهلاك طبيعي بدون قفزة', toolRequired: 'DC Power Supply' },
          ],
          knownCauses: [
            { cause: 'تأكسد مسارات الباور', likelihood: 'high' as const, verifyBy: 'فحص بصري بميكروسكوب' },
            { cause: 'تلف IC الباور', likelihood: 'medium' as const, verifyBy: 'قياس الجهود' },
            { cause: 'تلف كونيكتور الشاشة', likelihood: 'medium' as const, verifyBy: 'فحص الكونيكتور' },
          ],
          repairNotes: 'لا تتفاوض على السعر قبل التنظيف والفحص. يجب إبلاغ العميل أن الجهاز قد لا يقبل الإصلاح ويجب أخذ موافقة على المخاطرة.',
          requiredTools: ['موجات فوق صوتية', 'ميكروسكوب', 'DC Power Supply', 'هوت إير'],
          difficulty: 'expert' as const,
          estimatedMinutes: 150,
          riskWarnings: ['قد يتلف المعالج أثناء التنظيف', 'احتمال عدم نجاح الإصلاح وارد ويجب إبلاغ العميل'],
          tags: ['water', 'board-level', 'critical'],
          status: 'published' as const,
          outcomes: { timesApplied: 63, timesSuccessful: 41, successRatePct: 65.08, avgMinutes: 168 },
        },
        {
          title: 'الشاشة تعمل لكن اللمس لا يستجيب',
          brand: 'Samsung',
          models: ['Galaxy A15', 'Galaxy A55', 'Galaxy S23'],
          category: 'display' as const,
          symptom: 'الصورة ظاهرة لكن اللمس لا يعمل كليًا أو جزئيًا',
          diagnosticSteps: [
            { step: 1, instruction: 'اختبار اللمس في كل مناطق الشاشة بخاصية اللمس في قائمة الاختبار', expectedResult: 'تحديد المنطقة الميتة بدقة', toolRequired: 'تطبيق اختبار لمس' },
            { step: 2, instruction: 'إعادة توصيل كونيكتور الشاشة والتحقق من الأطراف', expectedResult: 'لمس يعمل بعد إعادة التوصيل', toolRequired: 'أدوات فك' },
            { step: 3, instruction: 'اختبار IC اللمس واستمرارية المسارات', expectedResult: 'لا يوجد انقطاع', toolRequired: 'أفوميتر' },
            { step: 4, instruction: 'تجربة شاشة سليمة للتأكد من البوردة', expectedResult: 'اللمس يعمل = العطل في الشاشة', toolRequired: 'شاشة اختبار' },
          ],
          knownCauses: [
            { cause: 'تلف طبقة اللمس في الشاشة', likelihood: 'high' as const, verifyBy: 'تجربة شاشة سليمة' },
            { cause: 'كونيكتور غير مثبت جيدًا', likelihood: 'medium' as const, verifyBy: 'إعادة توصيل' },
            { cause: 'عطل في IC اللمس على البوردة', likelihood: 'low' as const, verifyBy: 'قياس الإشارات' },
          ],
          repairNotes: 'إذا كانت الصورة سليمة واللمس لا يعمل فغالبًا العطل في طبقة اللمس الملتصقة، وأحيانًا يكون من كونيكتور فضفاض.',
          requiredTools: ['مفكات دقيقة', 'شاشة اختبار', 'أفوميتر'],
          difficulty: 'easy' as const,
          estimatedMinutes: 30,
          riskWarnings: ['فصل الشاشة بعنف يكسر الفلات'],
          tags: ['display', 'touch'],
          status: 'published' as const,
          outcomes: { timesApplied: 92, timesSuccessful: 88, successRatePct: 95.65, avgMinutes: 31 },
        },
        {
          title: 'البطارية تفرغ بسرعة - تقييم صحة البطارية',
          brand: 'Generic',
          models: [],
          category: 'power' as const,
          symptom: 'البطارية لا تكمل اليوم أو تنطفئ فجأة',
          diagnosticSteps: [
            { step: 1, instruction: 'قراءة صحة البطارية من إعدادات النظام أو بأداة تشخيص', expectedResult: 'تحديد نسبة الصحة', toolRequired: 'أداة تشخيص' },
            { step: 2, instruction: 'قياس استهلاك الجهاز في وضع السكون', expectedResult: 'استهلاك منخفض بدون تطبيقات خلفية', toolRequired: 'مقياس استهلاك' },
            { step: 3, instruction: 'فحص التطبيقات المستهلكة للطاقة', expectedResult: 'تحديد تطبيق شاذ', toolRequired: '—' },
            { step: 4, instruction: 'فحص انتفاخ البطارية وأطرافها', expectedResult: 'بطارية سليمة بلا انتفاخ', toolRequired: 'فحص بصري' },
          ],
          knownCauses: [
            { cause: 'استهلاك دورات شحن مرتفع', likelihood: 'high' as const, verifyBy: 'قراءة صحة البطارية' },
            { cause: 'تطبيق خلفي يستهلك الطاقة', likelihood: 'medium' as const, verifyBy: 'إحصاءات البطارية' },
            { cause: 'عطل في IC الباور', likelihood: 'low' as const, verifyBy: 'قياس استهلاك السكون' },
          ],
          repairNotes: 'لا تستبدل البطارية قبل التأكد من عدم وجود استهلاك شاذ برمجيًا.',
          requiredTools: ['أداة تشخيص', 'مقياس استهلاك'],
          difficulty: 'easy' as const,
          estimatedMinutes: 25,
          riskWarnings: ['البطاريات المنتفخة خطر حريق - تعامل بحذر'],
          tags: ['battery', 'power'],
          status: 'published' as const,
          outcomes: { timesApplied: 176, timesSuccessful: 171, successRatePct: 97.16, avgMinutes: 24 },
        },
      ];

      for (const article of articles) {
        await KnowledgeArticleModel.create({
          organizationId,
          branchId: branchNasr._id,
          ...article,
          slug: `${article.title.replace(/\s+/g, '-').slice(0, 40)}-${randInt(1000, 9999)}`,
          scope: 'organization',
          repairNotes: article.repairNotes,
          requiredParts: [],
          attachments: [],
          reviewedBy: owner._id,
          reviewedAt: daysAgo(randInt(10, 100)),
          version: 1,
          authorId: owner._id,
        });
      }
      counts.knowledgeArticles = await KnowledgeArticleModel.countDocuments();
    },
  );

  logger.info({ counts }, 'تم إنشاء البيانات التجريبية بنجاح');

  /**
   * إعادة عدّادات الترقيم المشتركة إلى قيمتها الصحيحة.
   *
   * السكربت يولّد أرقام المستندات بنفسه عبر `formatSequenceNumber` دون المرور
   * بخدمة الترقيم، فيبقى عدّاد `counterSeq` فارغًا. لو تُرك هكذا، أول مستند حقيقي
   * بعد الزرع يبدأ من 1 ويصطدم برقم موجود ⇒ E11000 ⇒ 409 على أول عملية إنشاء.
   *
   * المنطق في `syncNumberCounters` (مشترك مع سكربت fix-counters للقواعد القائمة):
   * يحلّل الأرقام الفعلية (KIND-YYMM-NNNNNN) ويضع لكل (نوع، شهر) أكبر تسلسل
   * استُخدم، على فروع المؤسسة نفسها لأن الترقيم الحي يتولّد من عدّاد الفرع الأقدم.
   */
  const counterSeq = await syncNumberCounters();
  logger.info({ counterSeq }, 'عدّادات الترقيم بعد المزامنة (لكل مؤسسة)');

  // نُعيد أيضًا العدّادات القديمة (معلومات تشغيلية معروضة فقط، لا تُستخدم في الترقيم)
  await runAsSystem(async () => {
    for (const branch of branches) {
      const ticketCount = await RepairTicketModel.countDocuments({ branchId: branch._id });
      const invoiceCount = await InvoiceModel.countDocuments({ branchId: branch._id });
      await BranchModel.updateOne(
        { _id: branch._id },
        { $set: { ticketCounter: ticketCount, invoiceCounter: invoiceCount } },
      );
    }
  });

  logger.info(
    {
      organization: organization.name,
      slug: organization.slug,
      login: {
        owner: 'owner / Owner@1234',
        manager: 'manager / Manager@1234',
        receptionist: 'reception / Reception@1234',
        accountant: 'accountant / Account@1234',
        technician: 'tech.ahmed / Tech@1234',
      },
    },
    'بيانات الدخول التجريبية',
  );

  await disconnectDatabase();
  process.exit(0);
}

seed().catch(async (err) => {
  logger.error({ err }, 'فشل إنشاء البيانات التجريبية');
  await disconnectDatabase().catch(() => void 0);
  process.exit(1);
});
