import mongoose from 'mongoose';

const campaignRecipientSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    campaignId: { type: String, required: true, index: true },
    shopId: { type: String, required: true, index: true },
    customerId: { type: String, required: true },
    phone: { type: String, required: true },
    customerName: { type: String, default: '' },
    status: { 
      type: String, 
      enum: ['PENDING', 'QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED', 'CANCELLED', 'MANUAL_SENT', 'OPENED'], 
      default: 'PENDING' 
    },
    sendingMethod: {
      type: String,
      enum: ['OFFICIAL_API', 'MANUAL_WHATSAPP'],
      default: 'OFFICIAL_API'
    },
    templateName: { type: String, default: '' },
    renderedMessage: { type: String, default: '' },
    providerMessageId: { type: String, default: '' },
    attempts: { type: Number, default: 0 },
    lastAttemptAt: { type: Date },
    errorCode: { type: String, default: '' },
    errorMessage: { type: String, default: '' },
    sentAt: { type: Date },
    deliveredAt: { type: Date },
    readAt: { type: Date }
  },
  { timestamps: true }
);

campaignRecipientSchema.index({ campaignId: 1, shopId: 1, customerId: 1 });
campaignRecipientSchema.index({ providerMessageId: 1 });
campaignRecipientSchema.index({ campaignId: 1, status: 1 });

export const CampaignRecipient = mongoose.model('CampaignRecipient', campaignRecipientSchema);
