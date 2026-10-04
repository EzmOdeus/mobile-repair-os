import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { tenantPlugin } from './plugins/tenantPlugin.js';

const customerSchema = new Schema(
  {
    // --- عزل المستأجر (tenant isolation) - تُفرض في tenantPlugin ---
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true, immutable: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    code: { type: String, trim: true, default: '' },
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    phoneAlt: { type: String, trim: true, default: '' },
    email: { type: String, lowercase: true, trim: true, default: '' },
    whatsapp: { type: String, trim: true, default: '' },
    type: { type: String, enum: ['individual', 'company', 'reseller'], default: 'individual', index: true },
    companyName: { type: String, trim: true, default: '' },
    taxId: { type: String, trim: true, default: '' },
    address: {
      governorate: { type: String, trim: true, default: '' },
      city: { type: String, trim: true, default: '' },
      area: { type: String, trim: true, default: '' },
      street: { type: String, trim: true, default: '' },
      notes: { type: String, trim: true, default: '' },
    },
    tags: { type: [String], default: [] },
    notes: { type: String, default: '' },
    /** ملخص حسابي محسوب */
    stats: {
      totalTickets: { type: Number, default: 0 },
      openTickets: { type: Number, default: 0 },
      totalSpentEgp: { type: Number, default: 0 },
      lastVisitAt: { type: Date, default: null },
      warrantyClaims: { type: Number, default: 0 },
    },
    consent: {
      marketingOptIn: { type: Boolean, default: true },
      dataProcessingAcceptedAt: { type: Date, default: null },
    },
    isBlacklisted: { type: Boolean, default: false },
    blacklistReason: { type: String, default: '' },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

customerSchema.plugin(tenantPlugin);

customerSchema.index({ organizationId: 1, phone: 1 });
customerSchema.index({ organizationId: 1, createdAt: -1 });
customerSchema.index({ fullName: 'text', phone: 'text', companyName: 'text', code: 'text' });

customerSchema.virtual('displayName').get(function displayName(this: { companyName?: string; fullName: string }) {
  return this.companyName || this.fullName;
});

export type Customer = InferSchemaType<typeof customerSchema>;
export type CustomerDoc = HydratedDocument<Customer>;

export const CustomerModel = model('Customer', customerSchema);
export default CustomerModel;
