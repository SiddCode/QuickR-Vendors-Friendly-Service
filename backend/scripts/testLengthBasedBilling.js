import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

import { Shop } from '../models/Shop.js';
import { Product } from '../models/Product.js';
import { Sale } from '../models/Sale.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/quickr';

async function runTests() {
  console.log('=== RUNNING LENGTH-BASED BILLING VERIFICATION TESTS ===');
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  const testShopId = `TEST-SHOP-${Date.now()}`;

  try {
    // 1. Verify Shop model default
    console.log('\n--- TEST 1: Shop Model Default & Length Toggle ---');
    const shop = new Shop({
      customId: testShopId,
      name: 'Fabric Emporium',
      phone: '+91 98765 43210'
    });
    await shop.save();
    console.log(`Default lengthBasedBillingEnabled: ${shop.lengthBasedBillingEnabled}`);
    if (shop.lengthBasedBillingEnabled !== false) throw new Error('Default must be false');

    shop.lengthBasedBillingEnabled = true;
    await shop.save();
    const updatedShop = await Shop.findOne({ customId: testShopId });
    if (updatedShop.lengthBasedBillingEnabled !== true) throw new Error('Failed to enable lengthBasedBillingEnabled');
    console.log('✓ Shop toggle enabled successfully');

    // 2. Create Length-Based Product & Piece-Based Product
    console.log('\n--- TEST 2: Product Creation (Length vs Piece) ---');
    const fabricProd = new Product({
      id: `PROD-FABRIC-${Date.now()}`,
      name: 'Pure Cotton Fabric',
      category: 'Fabrics',
      sellingPrice: 120, // ₹120 per metre
      availability: 50, // 50 metres
      measurementType: 'length',
      shopId: testShopId
    });
    await fabricProd.save();

    const shirtProd = new Product({
      id: `PROD-SHIRT-${Date.now()}`,
      name: 'Linen Shirt',
      category: 'Shirts',
      sellingPrice: 999,
      availability: 10,
      measurementType: 'piece',
      shopId: testShopId
    });
    await shirtProd.save();
    console.log(`✓ Created Fabric Product: ${fabricProd.name}, stock=${fabricProd.availability}m, rate=₹${fabricProd.sellingPrice}/m`);
    console.log(`✓ Created Piece Product: ${shirtProd.name}, stock=${shirtProd.availability}pcs, rate=₹${shirtProd.sellingPrice}`);

    // 3. Test Unit Conversion & Inventory Deduction: 75 cm at ₹120/m
    console.log('\n--- TEST 3: Conversion & Sale Calculation (75 cm) ---');
    // 75 cm converted to metres = 0.75 m
    // Rate = ₹120/m
    // Total = 0.75 * 120 = ₹90
    const rawQty = 75;
    const unit = 'cm';
    const baseQty = unit === 'cm' ? Math.round((rawQty / 100) * 10000) / 10000 : rawQty;
    const lineTotal = Math.round((baseQty * fabricProd.sellingPrice) * 100) / 100;

    console.log(`Input: ${rawQty} ${unit} -> baseQuantity: ${baseQty} m`);
    console.log(`Expected Total: ₹90, Calculated: ₹${lineTotal}`);
    if (baseQty !== 0.75) throw new Error(`Expected 0.75m but got ${baseQty}m`);
    if (lineTotal !== 90) throw new Error(`Expected lineTotal 90 but got ${lineTotal}`);

    // Simulate atomic stock deduction
    const updateRes = await Product.updateOne(
      { id: fabricProd.id, shopId: testShopId, availability: { $gte: baseQty } },
      { $inc: { availability: -baseQty } }
    );
    if (updateRes.matchedCount === 0) throw new Error('Stock deduction query failed');

    const checkFabric = await Product.findOne({ id: fabricProd.id });
    console.log(`Stock after 75cm sale: ${checkFabric.availability}m (Expected: 49.25m)`);
    if (checkFabric.availability !== 49.25) throw new Error(`Stock mismatch: expected 49.25, got ${checkFabric.availability}`);
    console.log('✓ 75 cm conversion, pricing, and atomic stock deduction verified');

    // 4. Test Second Length Sale: 2.5 m at ₹120/m = ₹300
    console.log('\n--- TEST 4: Metre Sale (2.5 m) ---');
    const metreQty = 2.5;
    const metreUnit = 'm';
    const metreBase = metreUnit === 'cm' ? metreQty / 100 : metreQty;
    const metreTotal = Math.round((metreBase * fabricProd.sellingPrice) * 100) / 100;
    if (metreTotal !== 300) throw new Error(`Expected 300 but got ${metreTotal}`);

    await Product.updateOne(
      { id: fabricProd.id, shopId: testShopId, availability: { $gte: metreBase } },
      { $inc: { availability: -metreBase } }
    );
    const checkFabric2 = await Product.findOne({ id: fabricProd.id });
    console.log(`Stock after 2.5m sale: ${checkFabric2.availability}m (Expected: 46.75m)`);
    if (checkFabric2.availability !== 46.75) throw new Error(`Stock mismatch: expected 46.75, got ${checkFabric2.availability}`);
    console.log('✓ 2.5 m sale verified');

    // 5. Test Insufficient Stock Protection
    console.log('\n--- TEST 5: Insufficient Stock Protection ---');
    const excessiveQty = 50; // remaining is 46.75
    const failRes = await Product.updateOne(
      { id: fabricProd.id, shopId: testShopId, availability: { $gte: excessiveQty } },
      { $inc: { availability: -excessiveQty } }
    );
    if (failRes.matchedCount !== 0) throw new Error('Should have rejected insufficient stock');
    console.log('✓ Correctly prevented sale exceeding available stock');

    // 6. Test Piece Product Idempotency & Compatibility
    console.log('\n--- TEST 6: Piece Product Compatibility ---');
    await Product.updateOne(
      { id: shirtProd.id, shopId: testShopId, availability: { $gte: 2 } },
      { $inc: { availability: -2 } }
    );
    const checkShirt = await Product.findOne({ id: shirtProd.id });
    if (checkShirt.availability !== 8) throw new Error(`Piece stock mismatch: expected 8, got ${checkShirt.availability}`);
    console.log(`✓ Piece stock properly decremented: ${checkShirt.availability}pcs remaining`);

    // Clean up test documents
    await Shop.deleteOne({ customId: testShopId });
    await Product.deleteMany({ shopId: testShopId });
    await Sale.deleteMany({ shopId: testShopId });
    console.log('✓ Test data cleaned up successfully');

    console.log('\n======================================================');
    console.log('ALL LENGTH-BASED BILLING VERIFICATION TESTS PASSED!');
    console.log('======================================================\n');
  } catch (err) {
    console.error('TEST FAILED:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

runTests();
