import mongoose from 'mongoose';

const invoiceCounterSchema = new mongoose.Schema(
  {
    shopId: { type: String, required: true, unique: true },
    seq: { type: Number, required: true, default: 0, min: 0 }
  },
  { timestamps: true }
);

export const InvoiceCounter = mongoose.model('InvoiceCounter', invoiceCounterSchema);
