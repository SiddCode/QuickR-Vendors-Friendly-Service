import mongoose from 'mongoose';
import { Product } from '../models/Product.js';
import { generateUniqueBarcode } from '../utils/barcode.js';

async function testBarcodeSystem() {
  const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/quickr';
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('Connected!');

  const shopIdA = 'TEST-SHOP-A-' + Date.now();
  const shopIdB = 'TEST-SHOP-B-' + Date.now();

  try {
    await Product.syncIndexes();
    // 1. Create product in Shop A with auto-generated barcode
    const barcodeA = await generateUniqueBarcode(shopIdA);
    console.log('Generated barcode for Shop A:', barcodeA);
    const prodA = await Product.create({
      id: 'PROD-A-' + Date.now(),
      shopId: shopIdA,
      name: 'LYGRA Shirt',
      category: 'Shirts',
      sellingPrice: 899,
      availability: 10,
      barcode: barcodeA
    });
    console.log('Created Prod A:', prodA.id, 'Barcode:', prodA.barcode);

    // 2. Verification: Multi-shop sparse unique isolation check
    // Create product in Shop B with the SAME barcode (allowed across shops)
    const prodB = await Product.create({
      id: 'PROD-B-' + Date.now(),
      shopId: shopIdB,
      name: 'LYGRA Pants',
      category: 'Pants',
      sellingPrice: 1299,
      availability: 5,
      barcode: barcodeA
    });
    console.log('Created Prod B in Shop B with same barcode:', prodB.id, 'Barcode:', prodB.barcode);

    // 3. Duplicate barcode inside Shop A must fail (shop-isolated unique constraint)
    try {
      await Product.create({
        id: 'PROD-DUP-' + Date.now(),
        shopId: shopIdA,
        name: 'Duplicate Shirt',
        category: 'Shirts',
        sellingPrice: 999,
        availability: 2,
        barcode: barcodeA
      });
      console.error('ERROR: Duplicate barcode in same shop was incorrectly allowed!');
    } catch (dupErr) {
      console.log('SUCCESS: Duplicate barcode in same shop correctly rejected with error:', dupErr.message);
    }

    // 4. Products with null barcode must not conflict
    const nullProd1 = await Product.create({
      id: 'PROD-NULL-1-' + Date.now(),
      shopId: shopIdA,
      name: 'No Barcode Prod 1',
      category: 'Shirts',
      sellingPrice: 500,
      availability: 20,
      barcode: null
    });
    const nullProd2 = await Product.create({
      id: 'PROD-NULL-2-' + Date.now(),
      shopId: shopIdA,
      name: 'No Barcode Prod 2',
      category: 'Shirts',
      sellingPrice: 600,
      availability: 15,
      barcode: null
    });
    console.log('SUCCESS: Products with null barcodes created without index conflict:', nullProd1.id, nullProd2.id);

    // Clean up test data
    await Product.deleteMany({ shopId: { $in: [shopIdA, shopIdB] } });
    console.log('Cleaned up test products.');
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected.');
  }
}

testBarcodeSystem().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
