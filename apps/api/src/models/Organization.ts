import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const SUBSCRIPTION_PLANS = ['free', 'starter', 'pro', 'business', 'enterprise'] as const;
export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

const settingsSchema = new Schema(
  {
    currency: { type: String, default: 'EGP' },
    timezone: { type: String, default: 'Africa/Cairo' },
    locale: { type: String, default: 'ar-EG' },
    taxRate: { type: Number, default: 14, min: 0, max: 100 },
    taxInclusive: { type: Boolean, default: true },
    defaultWarrantyDays: { type: Number, default: 30, min: 0 },
    partsWarrantyDays: { type: Number, default: 90, min: 0 },
    laborWarrantyDays: { type: Number, default: 14, min: 0 },
    requireApprovalBeforeRepair: { type: Boolean, default: true },
    requireIntakePhotos: { type: Boolean, default: true },
    requireQcBeforeReady: { type: Boolean, default: true },
    defaultSlaHours: { type: Number, default: 72, min: 1 },
    ticketPrefix: { type: String, default: 'REP' },
    invoicePrefix: { type: String, default: 'INV' },
    whatsappEnabled: { type: Boolean, default: false },
    notifyOnStatusChange: { type: Boolean, default: true },
  },
  { _id: false },
);

const subscriptionSchema = new Schema(
  {
    plan: { type: String, enum: SUBSCRIPTION_PLANS, default: 'free' },
    status: { type: String, enum: ['trialing', 'active', 'past_due', 'cancelled'], default: 'trialing' },
    startedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: null },
    maxUsers: { type: Number, default: 2 },
    maxBranches: { type: Number, default: 1 },
    monthlyTicketLimit: { type: Number, default: 50 },
    priceEgp: { type: Number, default: 0 },
  },
  { _id: false },
);

const organizationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    nameEn: { type: String, trim: true, default: '' },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    legalName: { type: String, trim: true, default: '' },
    taxId: { type: String, trim: true, default: '' },
    commercialRegister: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },
    website: { type: String, trim: true, default: '' },
    address: {
      governorate: { type: String, trim: true, default: '' },
      city: { type: String, trim: true, default: '' },
      area: { type: String, trim: true, default: '' },
      street: { type: String, trim: true, default: '' },
      building: { type: String, trim: true, default: '' },
      notes: { type: String, trim: true, default: '' },
    },
    branding: {
      logoFileId: { type: Schema.Types.ObjectId, ref: 'StoredFile', default: null },
      primaryColor: { type: String, default: '#0f766e' },
      receiptFooterText: { type: String, default: '' },
    },
    settings: { type: settingsSchema, default: () => ({}) },
    subscription: { type: subscriptionSchema, default: () => ({}) },
    isActive: { type: Boolean, default: true, index: true },
    onboardedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

organizationSchema.index({ name: 'text', nameEn: 'text' });

export type Organization = InferSchemaType<typeof organizationSchema>;
export type OrganizationDoc = HydratedDocument<Organization>;

export const OrganizationModel = model('Organization', organizationSchema);
export default OrganizationModel;
