import mongoose from 'mongoose';

const whatsappConnectionSchema = new mongoose.Schema(
  {
    shopId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    connected: {
      type: Boolean,
      default: false
    },
    connectionStatus: {
      type: String,
      enum: ['NOT_CONNECTED', 'CONNECTING', 'CONNECTED', 'FAILED', 'DISCONNECTED'],
      default: 'NOT_CONNECTED'
    },
    businessId: {
      type: String,
      default: ''
    },
    businessAccountId: {
      type: String,
      default: ''
    },
    phoneNumberId: {
      type: String,
      default: ''
    },
    displayPhoneNumber: {
      type: String,
      default: ''
    },
    businessName: {
      type: String,
      default: ''
    },
    // Encrypted access token container (IV + AuthTag + encrypted payload)
    encryptedAccessToken: {
      type: String,
      default: ''
    },
    tokenIV: {
      type: String,
      default: ''
    },
    tokenAuthTag: {
      type: String,
      default: ''
    },
    tokenExpiresAt: {
      type: Date,
      default: null
    },
    connectedAt: {
      type: Date,
      default: null
    },
    lastVerifiedAt: {
      type: Date,
      default: null
    },
    lastError: {
      type: String,
      default: ''
    }
  },
  { timestamps: true }
);

export const WhatsAppConnection = mongoose.model('WhatsAppConnection', whatsappConnectionSchema);
