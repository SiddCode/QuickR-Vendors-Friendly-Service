import mongoose from 'mongoose';

const productSchema = new mongoose.Schema(
  {
    id: { type: String, required: true }, // e.g. PROD-1
    name: { type: String, required: true },
    category: { type: String, required: true },
    subcategory: { type: String, default: '' },
    sellingPrice: { type: Number, required: true, min: 0 },
    originalPrice: { type: Number, min: 0 },
    sizes: [{ type: String }],
    colors: [{ type: String }],
    availability: { type: Number, default: 10 },
    description: { type: String, default: '' },
    image: { type: String, default: '' },
    gstRate: { type: Number, default: 0, min: 0 },
    hsnCode: { type: String, trim: true, default: '' },
    priceIncludesGst: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
    barcode: { type: String, trim: true, default: null, index: true },
    shopId: { type: String, required: true, default: 'demo-shop', index: true }
  },
  { timestamps: true }
);

productSchema.index({ shopId: 1, createdAt: -1, isActive: 1 });
productSchema.index({ shopId: 1, id: 1 });
productSchema.index({ shopId: 1, barcode: 1 }, { unique: true, partialFilterExpression: { barcode: { $type: 'string' } } });

export const Product = mongoose.model('Product', productSchema);


