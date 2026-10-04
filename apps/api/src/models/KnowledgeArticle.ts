import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { tenantPlugin } from './plugins/tenantPlugin.js';

const outcomesSchema = new Schema(
  {
    timesApplied: { type: Number, default: 0, min: 0 },
    timesSuccessful: { type: Number, default: 0, min: 0 },
    successRatePct: { type: Number, default: 0, min: 0, max: 100 },
    avgMinutes: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

/**
 * KnowledgeArticle: قاعدة المعرفة الفنية.
 * التنظيم: Brand → Model → Category → Symptom → Diagnostic Steps → Known Causes → Repair Notes → Outcome
 * الأساس الذي يُبنى عليه لاحقًا AI Repair Assistant بمصادر موثقة.
 */
const knowledgeArticleSchema = new Schema(
  {
    // --- عزل المستأجر (tenant isolation) - تُفرض في tenantPlugin ---
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true, immutable: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true },
    scope: { type: String, enum: ['organization', 'global'], default: 'organization', index: true },
    brand: { type: String, trim: true, default: '', index: true },
    models: { type: [String], default: [], index: true },
    category: {
      type: String,
      enum: [
        'display',
        'power',
        'charging',
        'audio',
        'camera',
        'network',
        'software',
        'board_level',
        'water_damage',
        'biometrics',
        'other',
      ],
      default: 'other',
      index: true,
    },
    symptom: { type: String, required: true },
    /** خطوات التشخيص بالترتيب */
    diagnosticSteps: {
      type: [
        new Schema(
          {
            step: { type: Number, required: true },
            instruction: { type: String, required: true },
            expectedResult: { type: String, default: '' },
            toolRequired: { type: String, default: '' },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    knownCauses: {
      type: [
        new Schema(
          {
            cause: { type: String, required: true },
            likelihood: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
            verifyBy: { type: String, default: '' },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    repairNotes: { type: String, default: '' },
    requiredParts: { type: [{ type: Schema.Types.ObjectId, ref: 'Part' }], default: [] },
    requiredTools: { type: [String], default: [] },
    difficulty: { type: String, enum: ['easy', 'medium', 'hard', 'expert'], default: 'medium' },
    estimatedMinutes: { type: Number, default: 0, min: 0 },
    riskWarnings: { type: [String], default: [] },
    /** النتائج التاريخية المتراكمة من التذاكر الفعلية */
    outcomes: { type: outcomesSchema, default: () => ({}) },
    attachments: { type: [{ type: Schema.Types.ObjectId, ref: 'StoredFile' }], default: [] },
    tags: { type: [String], default: [] },
    status: { type: String, enum: ['draft', 'review', 'published', 'archived'], default: 'draft', index: true },
    /** للحالات العامة: تُراجَع من فريق المنصة قبل النشر */
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    version: { type: Number, default: 1, min: 1 },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

knowledgeArticleSchema.plugin(tenantPlugin);

knowledgeArticleSchema.index({ organizationId: 1, slug: 1 }, { unique: true });
knowledgeArticleSchema.index({ organizationId: 1, brand: 1, category: 1, status: 1 });
knowledgeArticleSchema.index({ title: 'text', symptom: 'text', repairNotes: 'text', tags: 'text' });

export type KnowledgeArticle = InferSchemaType<typeof knowledgeArticleSchema>;
export type KnowledgeArticleDoc = HydratedDocument<KnowledgeArticle>;

export const KnowledgeArticleModel = model('KnowledgeArticle', knowledgeArticleSchema);
export default KnowledgeArticleModel;
