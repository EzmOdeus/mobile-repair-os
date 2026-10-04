import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { tenantPlugin } from './plugins/tenantPlugin.js';

export const SUPPLIER_TYPES = ['local_wholesale', 'importer', 'online', 'authorized_distributor', 'other'] as const;

const supplierSchema = new Schema(
  {
    // --- عزل المستأجر (tenant isolation) - تُفرض في tenantPlugin ---
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true, immutable: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, trim: true, uppercase: true, default: '' },
    type: { type: String, enum: SUPPLIER_TYPES, default: 'local_wholesale' },
    contactPerson: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    phoneAlt: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },
    address: {
      governorate: { type: String, trim: true, default: '' },
      city: { type: String, trim: true, default: '' },
      area: { type: String, trim: true, default: '' },
      street: { type: String, trim: true, default: '' },
    },
    taxId: { type: String, trim: true, default: '' },
    paymentTerms: { type: String, trim: true, default: '' },
    /** تقييم الجودة التراكمي - أساس Parts Intelligence */
    performance: {
      avgLeadTimeDays: { type: Number, default: 0, min: 0 },
      /** نسبة القطع التي رجعت معيبة من إجمالي ما وُرِّد */
      defectRatePct: { type: Number, default: 0, min: 0, max: 100 },
      totalSupplied: { type: Number, default: 0, min: 0 },
      totalDefective: { type: Number, default: 0, min: 0 },
      totalPurchasedEgp: { type: Number, default: 0, min: 0 },
      rating: { type: Number, default: 0, min: 0, max: 5 },
      lastOrderAt: { type: Date, default: null },
    },
    notes: { type: String, default: '' },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

supplierSchema.plugin(tenantPlugin);
supplierSchema.index({ organizationId: 1, name: 1 });
supplierSchema.index({ organizationId: 1, isActive: 1 });

export type Supplier = InferSchemaType<typeof supplierSchema>;
export type SupplierDoc = HydratedDocument<Supplier>;

export const SupplierModel = model('Supplier', supplierSchema);
export default SupplierModel;
