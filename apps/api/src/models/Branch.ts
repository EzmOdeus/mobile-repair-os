import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { tenantPlugin } from './plugins/tenantPlugin.js';

const branchSchema = new Schema(
  {
    // --- عزل المستأجر: الفرع نفسه لا يحمل branchId ---
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true, immutable: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, uppercase: true, trim: true },
    phone: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },
    address: {
      governorate: { type: String, trim: true, default: '' },
      city: { type: String, trim: true, default: '' },
      area: { type: String, trim: true, default: '' },
      street: { type: String, trim: true, default: '' },
      building: { type: String, trim: true, default: '' },
      notes: { type: String, trim: true, default: '' },
    },
    geo: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },
    managerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    workingHours: {
      opensAt: { type: String, default: '10:00' },
      closesAt: { type: String, default: '22:00' },
      weeklyOff: { type: [String], default: ['friday'] },
    },
    /**
     * عدّادات الترقيم على مستوى **المؤسسة** لا الفرع.
     *
     * السبب (خطأ حقيقي كان موجودًا): أرقام التذاكر والفواتير فريدة على مستوى
     * المؤسسة (`{organizationId, ticketNumber}` unique)، لكن العدّاد كان لكل فرع
     * على حدة والرقم لا يحمل رمز الفرع. فأول تذكرة في كل فرع كانت تُنتج نفس الرقم
     * `REP-YYMM-000001` ⇒ E11000 ⇒ أي مركز بفرعين يفشل إصداره الثاني كليًا.
     *
     * الحل: العدّاد يُحفظ على مستند **فرع واحد ثابت** (الأقدم نشاطًا — وهو الفرع
     * الرئيسي عادة) ويُختار حتميًا في `numberingService`. `$inc` على حقل داخل
     * مستند واحد ذرّي في MongoDB، فهذا يعطي تسلسلًا فريدًا على مستوى المؤسسة مع
     * الحفاظ على الأداء (تحديث واحد بلا معاملة).
     * المفتاح يشمل الفاصل الزمني (YYMM) حتى يبدأ الترقيم من جديد كل شهر بأمان.
     */
    counterSeq: {
      type: Schema.Types.Mixed,
      default: () => ({}),
    },
    /** عدّادات قديمة لكل فرع — تُعرض كمعلومة تشغيلية فقط، ولا تُستخدم في الترقيم */
    ticketCounter: { type: Number, default: 0 },
    invoiceCounter: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true, index: true },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true },
);

branchSchema.plugin(tenantPlugin);

branchSchema.index({ organizationId: 1, code: 1 }, { unique: true });
branchSchema.index({ organizationId: 1, isActive: 1 });

export type Branch = InferSchemaType<typeof branchSchema>;
export type BranchDoc = HydratedDocument<Branch>;

export const BranchModel = model('Branch', branchSchema);
export default BranchModel;
