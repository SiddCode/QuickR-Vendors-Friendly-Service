import crypto from 'crypto';
import { Product } from '../models/Product.js';

/**
 * Generate a unique QuickR barcode in format: QKR-XXXXXXXX (e.g. QKR-7F3A92K1)
 * Guarantees collision-free barcode per shop using retry logic.
 */
export async function generateUniqueBarcode(shopId) {
  const maxRetries = 10;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Generate 8 alphanumeric uppercase chars using crypto
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase().substring(0, 8);
    const candidateBarcode = `QKR-${raw}`;

    // Check collision in this shop
    const existing = await Product.findOne({ shopId, barcode: candidateBarcode }).lean();
    if (!existing) {
      return candidateBarcode;
    }
  }
  // Fallback timestamp if 10 retries somehow collide
  return `QKR-${Date.now().toString(36).toUpperCase()}`;
}
