import mongoose from 'mongoose';

const shopSchema = new mongoose.Schema(
  {
    customId: { type: String, default: 'SHOP-1' },
    name: { type: String, required: true, default: 'Shop Name' },
    phone: { type: String, default: '+91 98765 43210' },
    address: { type: String, default: 'Chennai, Tamil Nadu' },
    status: { type: String, enum: ['active', 'disabled'], default: 'active' },
    subscriptionStatus: { type: String, enum: ['pending', 'active', 'suspended', 'expired'], default: 'active' },
    isGstRegistered: { type: Boolean, default: false },
    gstin: { type: String, default: '' },
    gst: {
      registered: { type: Boolean, default: false },
      gstin: { type: String, trim: true, uppercase: true, default: '' },
      legalName: { type: String, trim: true, default: '' },
      address: { type: String, trim: true, default: '' },
      state: { type: String, trim: true, default: '' },
      stateCode: { type: String, trim: true, default: '' },
      defaultRate: { type: Number, enum: [0, 5, 12, 18, 28], default: 0 }
    }
  },
  { timestamps: true }
);

export const Shop = mongoose.model('Shop', shopSchema);
