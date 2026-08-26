import mongoose from 'mongoose';

const otpVerificationSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    phone: { type: String, required: true, index: true },
    otpHash: { type: String, required: true },
    purpose: { type: String, enum: ['shop_creation', 'password_reset'], default: 'shop_creation' },
    verified: { type: Boolean, default: false },
    attempts: { type: Number, default: 0 },
    lastRequestedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, index: { expires: 0 } }
  },
  { timestamps: true }
);

otpVerificationSchema.index({ phone: 1, purpose: 1 });

export const OtpVerification = mongoose.model('OtpVerification', otpVerificationSchema);
