import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Product } from '../models/Product.js';
import { Shop } from '../models/Shop.js';

dotenv.config();

async function runGstRegressionTests() {
  console.log('=== QUICKR GST PRICING REGRESSION SUITE ===');

  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/quickr';
  await mongoose.connect(uri);

  const testShopId = `TEST-SHOP-GST-${Date.now()}`;

  try {
    // 1. Create Test Shop with GST Enabled
    const shop = new Shop({
      customId: testShopId,
      name: 'GST Test Retail Shop',
      isGstRegistered: true,
      gstin: '33AAAAA0000A1Z5',
      gst: {
        registered: true,
        gstin: '33AAAAA0000A1Z5',
        legalName: 'GST Test Retail Shop',
        state: 'Tamil Nadu',
        stateCode: '33',
        defaultRate: 5
      }
    });
    await shop.save();

    // 2. Create GST-Inclusive Product (e.g. lygra shirt / retail apparel style)
    const incProd = new Product({
      id: `PROD-INC-${Date.now()}`,
      name: 'GST Inclusive Shirt',
      category: 'Shirts',
      sellingPrice: 500,
      gstRate: 5,
      priceIncludesGst: true,
      shopId: testShopId
    });
    await incProd.save();

    // 3. Create GST-Exclusive Product (e.g. wholesale / raw fabric style)
    const excProd = new Product({
      id: `PROD-EXC-${Date.now()}`,
      name: 'GST Exclusive Fabric',
      category: 'Fabric',
      sellingPrice: 500,
      gstRate: 5,
      priceIncludesGst: false,
      shopId: testShopId
    });
    await excProd.save();

    // 4. Create New Product Without Specifying priceIncludesGst (Schema Default Verification)
    const defProd = new Product({
      id: `PROD-DEF-${Date.now()}`,
      name: 'Default New Apparel Item',
      category: 'Apparel',
      sellingPrice: 500,
      gstRate: 5,
      shopId: testShopId
    });
    await defProd.save();

    // Test Assertions
    console.log('\n--- VERIFYING MONGO DB DEFAULTS ---');
    console.log(`Default Product priceIncludesGst: ${defProd.priceIncludesGst} (Expected: true)`);
    if (defProd.priceIncludesGst !== true) {
      throw new Error('Default Product priceIncludesGst failed: expected true, got ' + defProd.priceIncludesGst);
    }

    // Billing Calculation Verification
    function calcBill(prod, isGstRegistered) {
      const lineTotal = prod.sellingPrice * 1;
      const itemGstRate = isGstRegistered ? prod.gstRate : 0;
      const priceIncludesGst = prod.priceIncludesGst !== undefined ? prod.priceIncludesGst : true;

      let itemGstAmount = 0;
      let itemTaxableAmount = lineTotal;

      if (isGstRegistered && itemGstRate > 0) {
        if (priceIncludesGst) {
          itemTaxableAmount = Math.round((lineTotal / (1 + itemGstRate / 100)) * 100) / 100;
          itemGstAmount = Math.round((lineTotal - itemTaxableAmount) * 100) / 100;
        } else {
          itemTaxableAmount = Math.round(lineTotal * 100) / 100;
          itemGstAmount = Math.round((itemTaxableAmount * (itemGstRate / 100)) * 100) / 100;
        }
      }

      const grandTotal = priceIncludesGst || !isGstRegistered || itemGstRate === 0 
        ? lineTotal 
        : itemTaxableAmount + itemGstAmount;

      return { lineTotal, itemTaxableAmount, itemGstAmount, grandTotal };
    }

    console.log('\n--- TEST CASE 1: GST-Inclusive Product (₹500 @ 5% GST) ---');
    const res1 = calcBill(incProd, true);
    console.log(res1);
    // Subtotal: ₹500, Taxable: 476.19, GST: 23.81, Grand Total: 500
    if (res1.grandTotal !== 500 || res1.itemTaxableAmount !== 476.19 || res1.itemGstAmount !== 23.81) {
      throw new Error('Case 1 failed: ' + JSON.stringify(res1));
    }
    console.log('PASS: GST-Inclusive Grand Total remains ₹500.00');

    console.log('\n--- TEST CASE 2: GST-Exclusive Product (₹500 @ 5% GST) ---');
    const res2 = calcBill(excProd, true);
    console.log(res2);
    // Subtotal: ₹500, Taxable: 500, GST: 25, Grand Total: 525
    if (res2.grandTotal !== 525 || res2.itemTaxableAmount !== 500 || res2.itemGstAmount !== 25) {
      throw new Error('Case 2 failed: ' + JSON.stringify(res2));
    }
    console.log('PASS: GST-Exclusive Grand Total becomes ₹525.00');

    console.log('\n--- TEST CASE 3: Newly Created Product (Default Behavior) ---');
    const res3 = calcBill(defProd, true);
    console.log(res3);
    if (res3.grandTotal !== 500) {
      throw new Error('Case 3 failed: expected ₹500 grand total for default new product, got ' + res3.grandTotal);
    }
    console.log('PASS: Newly Created Product defaults to GST-Inclusive (Grand Total ₹500.00)');

    console.log('\n--- TEST CASE 4: Unregistered Shop (GST Disabled) ---');
    const res4 = calcBill(incProd, false);
    console.log(res4);
    if (res4.grandTotal !== 500 || res4.itemGstAmount !== 0) {
      throw new Error('Case 4 failed: expected ₹500 grand total with 0 GST for unregistered shop, got ' + res4.grandTotal);
    }
    console.log('PASS: Unregistered shop calculates 0 GST and ₹500.00 total');

    // Clean up test documents
    await Product.deleteMany({ shopId: testShopId });
    await Shop.deleteOne({ customId: testShopId });

    console.log('\n=========================================');
    console.log('ALL GST PRICING REGRESSION TESTS PASSED!');
    console.log('=========================================');

  } catch (err) {
    console.error('GST REGRESSION TEST FAILED:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

runGstRegressionTests();
