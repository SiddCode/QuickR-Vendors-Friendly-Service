import mongoose from 'mongoose';

const campaignSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true }, // e.g. CMP-1724001122
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    discountType: { 
      type: String, 
      enum: ['Percentage', 'Fixed Amount'], 
      required: true 
    },
    discountValue: { type: Number, required: true, min: 0.01 },
    productIds: [{ type: String }],
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    mediaType: { 
      type: String, 
      enum: ['image', 'video', 'none'], 
      default: 'none' 
    },
    temporaryMediaReference: { type: String, default: '' },
    mediaOriginalName: { type: String, default: '' },
    mediaMimeType: { type: String, default: '' },
    selectedCustomerIds: [{ type: String }],
    targetAudienceType: { 
      type: String, 
      enum: ['all_eligible', 'product_buyers', 'enquiry_customers', 'followup_customers', 'custom_selected'], 
      default: 'all_eligible' 
    },
    eligibleCustomerCount: { type: Number, default: 0 },
    status: { 
      type: String, 
      enum: ['DRAFT', 'READY', 'SCHEDULED', 'SENDING', 'COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'CANCELLED'], 
      default: 'DRAFT' 
    },
    campaignType: {
      type: String,
      enum: ['discount_offer', 'new_arrival', 'clearance', 'festive_deal', 'general_announcement'],
      default: 'discount_offer'
    },
    templateName: { type: String, default: 'quickr_offer_campaign' },
    templateLanguage: { type: String, default: 'en' },
    templateVariables: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({})
    },
    scheduledAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    // Cached delivery metrics for real-time dashboard aggregation
    totalRecipients: { type: Number, default: 0 },
    eligibleRecipients: { type: Number, default: 0 },
    sentCount: { type: Number, default: 0 },
    deliveredCount: { type: Number, default: 0 },
    readCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    skippedCount: { type: Number, default: 0 },
    queuedCount: { type: Number, default: 0 },
    cancelledCount: { type: Number, default: 0 },
    createdBy: { type: String, required: true },
    campaignCost: { type: Number, default: 0, min: 0 },
    shopId: { type: String, required: true, index: true },
    // Distributed MongoDB-backed worker locking
    workerLockId: { type: String, default: null },
    workerLockedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

campaignSchema.index({ shopId: 1, createdAt: -1 });

export const Campaign = mongoose.model('Campaign', campaignSchema);
