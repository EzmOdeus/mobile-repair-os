import { Schema, model, type InferSchemaType, type HydratedDocument, type Model } from 'mongoose';
import bcrypt from 'bcryptjs';
import { ROLES } from '../constants/roles.js';
import { tenantPlugin } from './plugins/tenantPlugin.js';

const BCRYPT_ROUNDS = 12;

/** دوال المستند (methods) - تُعلن في النوع حتى تتوفر في نتائج الاستعلامات */
export interface UserMethods {
  setPassword(plain: string): Promise<void>;
  verifyPassword(plain: string): Promise<boolean>;
  readonly isLocked: boolean;
}

type UserModelType = Model<User, unknown, UserMethods>;

const technicianProfileSchema = new Schema(
  {
    isTechnician: { type: Boolean, default: false },
    /** software, hardware, board-level, iphone, android */
    specialities: { type: [String], default: [] },
    skillLevel: { type: String, enum: ['junior', 'mid', 'senior', 'lead'], default: 'mid' },
    maxActiveJobs: { type: Number, default: 5, min: 1 },
    hourlyCostEgp: { type: Number, default: 0, min: 0 },
    workbench: { type: String, trim: true, default: '' },
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    // --- عزل المستأجر (tenant isolation) - تُفرض في tenantPlugin ---
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true, immutable: true },
    branchIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Branch' }], default: [] },
    fullName: { type: String, required: true, trim: true },
    username: { type: String, required: true, lowercase: true, trim: true },
    /**
     * مهم جدًا: بلا `default: ''`، ومع setter يحوّل الفراغ إلى `undefined`.
     *
     * الفهرس {organizationId, email} فريد وsparse. `sparse` في MongoDB يستثني
     * المستندات التي **لا تحتوي الحقل** فقط — أما `null` أو `''` فيُفهرس ويُحسب تكرارًا.
     *
     * وفخ إضافي: خيار `trim: true` في Mongoose يحوّل `undefined` إلى `null` عند الحفظ،
     * فحتى بدون `default` كان الحقل يُخزَّن `null` ويصطدم بالفهرس. لذلك نحوّل الفراغ
     * إلى `undefined` في الـsetter ليُحذف الحقل من المستند نهائيًا.
     */
    email: {
      type: String,
      lowercase: true,
      trim: true,
      set: (value: unknown) => {
        if (value === null || value === undefined) return undefined;
        const text = String(value).trim();
        return text === '' ? undefined : text;
      },
    },
    phone: { type: String, trim: true, default: '' },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true, default: 'technician' },
    extraPermissions: { type: [String], default: [] },
    deniedPermissions: { type: [String], default: [] },
    /** بيانات الفني */
    technicianProfile: { type: technicianProfileSchema, default: () => ({}) },
    avatarFileId: { type: Schema.Types.ObjectId, ref: 'StoredFile', default: null },
    locale: { type: String, default: 'ar-EG' },
    isActive: { type: Boolean, default: true, index: true },
    lastLoginAt: { type: Date, default: null },
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
    mustChangePassword: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

userSchema.plugin(tenantPlugin);

// فريد داخل المؤسسة فقط (multi-tenant)
userSchema.index({ organizationId: 1, username: 1 }, { unique: true });
/**
 * فهرس جزئي (partial) لا sparse.
 *
 * `sparse` يستثني المستندات التي لا تحتوي الحقل فقط — أما `null` و`''` فيُفهرسان
 * ويُحسبان تكرارًا، فيمنعان وجود أكثر من مستخدم بلا بريد في نفس المركز.
 * الشرط `email: { $type: 'string' }` يقيّد التفرد على المستندات التي لها بريد فعلي.
 */
userSchema.index(
  { organizationId: 1, email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } },
);
userSchema.index({ organizationId: 1, isActive: 1, role: 1 });
userSchema.index({ fullName: 'text', username: 'text' });

userSchema.methods.setPassword = async function setPassword(plain: string): Promise<void> {
  this.passwordHash = await bcrypt.hash(plain, BCRYPT_ROUNDS);
  this.passwordChangedAt = new Date();
};

userSchema.methods.verifyPassword = function verifyPassword(plain: string): Promise<boolean> {
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.virtual('isLocked').get(function isLocked(this: User): boolean {
  return Boolean(this.lockedUntil && this.lockedUntil.getTime() > Date.now());
});

export type User = InferSchemaType<typeof userSchema>;

export type UserDoc = HydratedDocument<User, UserMethods>;

export const UserModel = model<User, UserModelType>('User', userSchema);
export default UserModel;
