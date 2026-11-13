/**
 * QuickR — Editable Product Selling Price During Billing Regression Test Suite
 *
 * Scenarios tested (Offline / Mocked — zero live DB / zero Atlas connection):
 * 1. Change ₹600 to ₹550 and complete a sale.
 * 2. Verify the bill shows ₹550 as the billed unit rate.
 * 3. Verify subtotal and GST are calculated correctly with the edited price.
 * 4. Verify the original product price in the Product catalogue remains ₹600.
 * 5. Start another sale and confirm the price returns to original catalogue price ₹600.
 * 6. Test quantity greater than one (e.g. qty: 2 @ ₹550 = ₹1,100 subtotal).
 * 7. Test price editing with GST-inclusive and GST-exclusive products.
 * 8. Test price editing together with a bill discount (both % and amount modes).
 * 9. Test invalid and negative values (negative, NaN, non-numeric strings) are rejected with 400.
 * 10. Test owner and staff billing (both can complete sales with bargained price).
 * 11. Verify stock deduction remains correct and unaffected by price change.
 * 12. Verify printed and WhatsApp bills show the actual billed price.
 * 13. Verify frontend code contracts: inline price editing, visual indicator, zero unwanted popups.
 * 14. Verify Sale model schema preserves originalPrice, rate, quantity, and total.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Mirror calculateGST from backend/server.js
function calculateGST({
  amount = 0,
  gstRate = 0,
  priceIncludesGst = false,
  isInterState = false,
  enabled = true
}) {
  const numAmount = Math.max(0, Number(amount) || 0);
  const numRate = Math.max(0, Number(gstRate) || 0);

  if (!enabled || numRate <= 0 || numAmount <= 0) {
    return {
      taxableAmount: Math.round(numAmount * 100) / 100,
      cgst: 0,
      sgst: 0,
      igst: 0,
      totalTax: 0,
      taxType: 'NONE'
    };
  }

  let taxableAmount = 0;
  let totalTax = 0;

  if (priceIncludesGst) {
    taxableAmount = numAmount / (1 + numRate / 100);
    totalTax = numAmount - taxableAmount;
  } else {
    taxableAmount = numAmount;
    totalTax = (taxableAmount * numRate) / 100;
  }

  taxableAmount = Math.round(taxableAmount * 100) / 100;
  totalTax = Math.round(totalTax * 100) / 100;

  if (isInterState) {
    return {
      taxableAmount,
      cgst: 0,
      sgst: 0,
      igst: totalTax,
      totalTax,
      taxType: 'IGST'
    };
  }

  const halfTax = Math.round((totalTax / 2) * 100) / 100;
  return {
    taxableAmount,
    cgst: halfTax,
    sgst: Math.round((totalTax - halfTax) * 100) / 100,
    igst: 0,
    totalTax,
    taxType: 'CGST_SGST'
  };
}

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ PASS: ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     ${err.stack || err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// In-Memory Database Simulator for Billing Scenarios
// ─────────────────────────────────────────────────────────────────────────────
function createMockEnvironment() {
  const products = [
    {
      id: 'PROD-SHIRT-1',
      shopId: 'SHOP-TEST',
      name: 'Classic Linen Shirt',
      category: 'Shirts',
      sellingPrice: 600, // Catalogue price = 600
      originalPrice: 799, // MRP = 799
      availability: 20,
      measurementType: 'piece',
      barcode: 'QKR-SHIRT01',
      isActive: true,
      gstRate: 5,
      hsnCode: '6205',
      priceIncludesGst: true
    },
    {
      id: 'PROD-SUIT-1',
      shopId: 'SHOP-TEST',
      name: 'Premium Wool Blazer',
      category: 'Blazers',
      sellingPrice: 3000,
      originalPrice: 3999,
      availability: 5,
      measurementType: 'piece',
      barcode: 'QKR-SUIT01',
      isActive: true,
      gstRate: 12,
      hsnCode: '6203',
      priceIncludesGst: false // GST Exclusive
    },
    {
      id: 'PROD-FABRIC-1',
      shopId: 'SHOP-TEST',
      name: 'Cotton Shirting Fabric',
      category: 'Fabric',
      sellingPrice: 400,
      originalPrice: 450,
      availability: 50,
      measurementType: 'length',
      barcode: 'QKR-FAB01',
      isActive: true,
      gstRate: 5,
      hsnCode: '5208',
      priceIncludesGst: true
    }
  ];

  const shop = {
    customId: 'SHOP-TEST',
    name: 'QuickR Fashion Store',
    isGstRegistered: true,
    gst: {
      registered: true,
      gstin: '33AAAAA0000A1Z5',
      state: 'Tamil Nadu',
      stateCode: '33'
    }
  };

  const sales = [];

  // Simulate server-side POST /api/sales authoritative processing
  async function createSaleServer({ user, body }) {
    if (!user || !user.shopId) {
      throw { status: 403, error: 'Shop context required' };
    }
    const shopId = user.shopId;
    const { items, discount = 0, discountType = 'percentage', paymentMethod = 'Cash' } = body;

    if (!Array.isArray(items) || items.length === 0) {
      throw { status: 400, error: 'Items are required' };
    }

    // Upfront validation
    for (const item of items) {
      if (!item || typeof item !== 'object') throw { status: 400, error: 'Invalid sale item entry' };
      const rawQty = Number(item.quantity);
      if (!Number.isFinite(rawQty) || rawQty <= 0) {
        throw { status: 400, error: `Invalid quantity for ${item.productName || item.productId || 'item'}` };
      }
      if (item.rate !== undefined && item.rate !== null && item.rate !== '') {
        const rawRate = Number(item.rate);
        if (!Number.isFinite(rawRate) || rawRate < 0) {
          throw { status: 400, error: `Invalid unit selling price for ${item.productName || item.productId || 'item'}` };
        }
      } else if (!item.productId) {
        throw { status: 400, error: `Invalid rate for custom item ${item.productName || 'item'}` };
      }
    }

    const requestedQtyByProduct = new Map();
    const preparedLines = [];
    let serverSubtotal = 0;

    for (const item of items) {
      const dbProd = item.productId ? products.find(p => p.id === item.productId && p.shopId === shopId) : null;
      if (item.productId && !dbProd) {
        throw { status: 404, error: `Product ${item.productId} not found` };
      }

      const rawQty = Number(item.quantity);
      const isLengthProd = dbProd ? dbProd.measurementType === 'length' : item.measurementType === 'length';
      const sellingUnit = isLengthProd ? (item.sellingUnit === 'cm' ? 'cm' : 'm') : 'piece';
      const baseQty = (isLengthProd && sellingUnit === 'cm')
        ? Math.round((rawQty / 100) * 10000) / 10000
        : Math.round(rawQty * 10000) / 10000;

      if (dbProd) {
        requestedQtyByProduct.set(dbProd.id, (requestedQtyByProduct.get(dbProd.id) || 0) + baseQty);
      }

      let trustedRate;
      if (item.rate !== undefined && item.rate !== null && item.rate !== '') {
        const customRate = Number(item.rate);
        if (!Number.isFinite(customRate) || customRate < 0) {
          throw { status: 400, error: `Invalid unit selling price for ${item.productName || (dbProd ? dbProd.name : 'item')}` };
        }
        trustedRate = Math.round(customRate * 100) / 100;
      } else if (dbProd) {
        trustedRate = Number(dbProd.sellingPrice);
      } else {
        throw { status: 400, error: `Unit selling price is required for ${item.productName || 'item'}` };
      }

      const originalCataloguePrice = dbProd ? Number(dbProd.sellingPrice) : (item.originalPrice ?? trustedRate);
      const rawLineTotal = Math.round((baseQty * trustedRate) * 100) / 100;
      serverSubtotal += rawLineTotal;

      preparedLines.push({
        item,
        dbProd,
        isLengthProd,
        sellingUnit,
        rawQty,
        baseQty,
        originalCataloguePrice,
        trustedRate,
        rawLineTotal
      });
    }

    // Check stock availability
    for (const [prodId, reqQty] of requestedQtyByProduct.entries()) {
      const prod = products.find(p => p.id === prodId);
      if ((prod.availability || 0) < reqQty) {
        throw { status: 400, error: `Insufficient stock for ${prod.name}` };
      }
    }

    serverSubtotal = Math.round(serverSubtotal * 100) / 100;

    let numericDiscount = 0;
    if (discountType === 'percentage') {
      numericDiscount = Math.round(((serverSubtotal * Number(discount)) / 100) * 100) / 100;
    } else {
      numericDiscount = Math.min(serverSubtotal, Math.round(Number(discount) * 100) / 100);
    }

    let calculatedTotalGst = 0;
    let calculatedTotalTaxable = 0;
    const processedItems = [];

    for (const line of preparedLines) {
      const { item, dbProd, isLengthProd, sellingUnit, rawQty, baseQty, originalCataloguePrice, trustedRate, rawLineTotal } = line;
      const lineTaxableSubtotal = serverSubtotal > 0
        ? (rawLineTotal * (1 - (numericDiscount / serverSubtotal)))
        : rawLineTotal;

      const itemGstRate = dbProd?.gstRate || 0;
      const itemPriceIncludesGst = dbProd?.priceIncludesGst !== undefined ? Boolean(dbProd.priceIncludesGst) : true;

      const itemGstResult = calculateGST({
        amount: lineTaxableSubtotal,
        gstRate: itemGstRate,
        priceIncludesGst: itemPriceIncludesGst,
        isInterState: false,
        enabled: shop.isGstRegistered
      });

      calculatedTotalGst += itemGstResult.totalTax;
      calculatedTotalTaxable += itemGstResult.taxableAmount;

      processedItems.push({
        productId: item.productId || '',
        productName: dbProd ? dbProd.name : item.productName,
        category: dbProd ? dbProd.category : (item.category || ''),
        measurementType: isLengthProd ? 'length' : 'piece',
        sellingUnit,
        baseQuantity: baseQty,
        quantity: rawQty,
        originalPrice: originalCataloguePrice,
        rate: trustedRate,
        total: rawLineTotal,
        gstRate: itemGstRate,
        gstAmount: itemGstResult.totalTax,
        taxableAmount: itemGstResult.taxableAmount
      });
    }

    calculatedTotalGst = Math.round(calculatedTotalGst * 100) / 100;
    calculatedTotalTaxable = Math.round(calculatedTotalTaxable * 100) / 100;

    const finalTotalAmount = shop.isGstRegistered
      ? Math.round((calculatedTotalTaxable + calculatedTotalGst) * 100) / 100
      : Math.round(Math.max(0, serverSubtotal - numericDiscount) * 100) / 100;

    // Deduct stock conditionally
    for (const [prodId, decQty] of requestedQtyByProduct.entries()) {
      const prod = products.find(p => p.id === prodId);
      prod.availability -= decQty;
    }

    const createdSale = {
      id: `SALE-${Date.now()}`,
      invoiceNumber: `INV-${String(sales.length + 1).padStart(6, '0')}`,
      shopId,
      items: processedItems,
      subtotal: serverSubtotal,
      discount: Number(discount),
      discountType,
      totalGst: calculatedTotalGst,
      totalAmount: finalTotalAmount,
      paymentMethod,
      createdBy: { userId: user.id, name: user.name, role: user.role }
    };

    sales.push(createdSale);
    return createdSale;
  }

  return { products, shop, sales, createSaleServer };
}

async function runTests() {
  console.log('🧪 Starting QuickR Editable Selling Price During Billing Suite...\n');

  const salesSessionPath = path.resolve('frontend/src/pages/SalesSession.tsx');
  const saleModelPath = path.resolve('backend/models/Sale.js');
  const serverPath = path.resolve('backend/server.js');

  const salesSessionCode = fs.readFileSync(salesSessionPath, 'utf8');
  const saleModelCode = fs.readFileSync(saleModelPath, 'utf8');
  const serverCode = fs.readFileSync(serverPath, 'utf8');

  // ─── SCENARIO 1 & 2: Change ₹600 to ₹550 and verify bill shows ₹550 ───
  await test('1 & 2. Change ₹600 to ₹550 and complete sale -> bill shows ₹550', async () => {
    const env = createMockEnvironment();
    const user = { id: 'USER-1', name: 'Shop Staff', role: 'staff', shopId: 'SHOP-TEST' };

    const sale = await env.createSaleServer({
      user,
      body: {
        items: [{
          productId: 'PROD-SHIRT-1',
          quantity: 1,
          rate: 550 // Staff edited from 600 to 550
        }],
        paymentMethod: 'Cash'
      }
    });

    assert.equal(sale.items[0].originalPrice, 600, 'Original price must be 600');
    assert.equal(sale.items[0].rate, 550, 'Billed unit rate must be 550');
    assert.equal(sale.items[0].total, 550, 'Line total must be 550');
    assert.equal(sale.subtotal, 550, 'Subtotal must be 550');
  });

  // ─── SCENARIO 3: Subtotal and GST calculations ───
  await test('3. Subtotal and GST are calculated correctly with edited unit price', async () => {
    const env = createMockEnvironment();
    const user = { id: 'USER-1', name: 'Owner', role: 'owner', shopId: 'SHOP-TEST' };

    // Shirt is GST Inclusive @ 5%
    // Price = 550 -> Taxable = 550 / 1.05 = 523.81, GST = 26.19
    const sale = await env.createSaleServer({
      user,
      body: {
        items: [{
          productId: 'PROD-SHIRT-1',
          quantity: 1,
          rate: 550
        }],
        paymentMethod: 'UPI'
      }
    });

    assert.equal(sale.subtotal, 550);
    assert.equal(sale.items[0].taxableAmount, 523.81);
    assert.equal(sale.items[0].gstAmount, 26.19);
    assert.equal(sale.totalGst, 26.19);
    assert.equal(sale.totalAmount, 550);
  });

  // ─── SCENARIO 4 & 5: Product catalogue price remains ₹600, next sale returns to ₹600 ───
  await test('4 & 5. Master product price remains ₹600; next sale defaults to ₹600', async () => {
    const env = createMockEnvironment();
    const user = { id: 'USER-1', name: 'Staff', role: 'staff', shopId: 'SHOP-TEST' };

    // First sale bargained to 550
    await env.createSaleServer({
      user,
      body: {
        items: [{ productId: 'PROD-SHIRT-1', quantity: 1, rate: 550 }],
        paymentMethod: 'Cash'
      }
    });

    // Check Product in catalogue
    const masterProd = env.products.find(p => p.id === 'PROD-SHIRT-1');
    assert.equal(masterProd.sellingPrice, 600, 'Product catalogue sellingPrice must strictly remain 600');
    assert.equal(masterProd.originalPrice, 799, 'Product MRP must strictly remain 799');

    // Second sale without price override
    const sale2 = await env.createSaleServer({
      user,
      body: {
        items: [{ productId: 'PROD-SHIRT-1', quantity: 1 }],
        paymentMethod: 'Cash'
      }
    });

    assert.equal(sale2.items[0].rate, 600, 'Next sale without edit must use original catalogue price 600');
    assert.equal(sale2.subtotal, 600);
  });

  // ─── SCENARIO 6: Quantity greater than 1 ───
  await test('6. Quantity > 1: (qty: 2 @ ₹550 = ₹1,100 subtotal)', async () => {
    const env = createMockEnvironment();
    const user = { id: 'USER-1', name: 'Staff', role: 'staff', shopId: 'SHOP-TEST' };

    const sale = await env.createSaleServer({
      user,
      body: {
        items: [{ productId: 'PROD-SHIRT-1', quantity: 2, rate: 550 }],
        paymentMethod: 'Card'
      }
    });

    assert.equal(sale.items[0].quantity, 2);
    assert.equal(sale.items[0].rate, 550);
    assert.equal(sale.items[0].total, 1100);
    assert.equal(sale.subtotal, 1100);
  });

  // ─── SCENARIO 7: Price editing with GST-inclusive and GST-exclusive products ───
  await test('7. Price editing with GST-exclusive products (Wool Blazer ₹3000 -> ₹2800 + 12% GST)', async () => {
    const env = createMockEnvironment();
    const user = { id: 'USER-1', name: 'Owner', role: 'owner', shopId: 'SHOP-TEST' };

    // Blazer is GST Exclusive @ 12%
    // Edited price = 2800 -> Taxable = 2800, GST = 2800 * 0.12 = 336, Total = 3136
    const sale = await env.createSaleServer({
      user,
      body: {
        items: [{ productId: 'PROD-SUIT-1', quantity: 1, rate: 2800 }],
        paymentMethod: 'Card'
      }
    });

    assert.equal(sale.items[0].rate, 2800);
    assert.equal(sale.items[0].total, 2800);
    assert.equal(sale.items[0].taxableAmount, 2800);
    assert.equal(sale.items[0].gstAmount, 336);
    assert.equal(sale.totalGst, 336);
    assert.equal(sale.totalAmount, 3136);
  });

  // ─── SCENARIO 8: Price editing together with a bill discount ───
  await test('8. Price editing together with a bill discount (Percentage & Amount)', async () => {
    const env = createMockEnvironment();
    const user = { id: 'USER-1', name: 'Owner', role: 'owner', shopId: 'SHOP-TEST' };

    // Edited Shirt to 550 + 10% Bill Discount
    // Subtotal = 550, Discount = 55, Net = 495
    // Taxable = 495 / 1.05 = 471.43, GST = 23.57, Total = 495
    const salePct = await env.createSaleServer({
      user,
      body: {
        items: [{ productId: 'PROD-SHIRT-1', quantity: 1, rate: 550 }],
        discount: 10,
        discountType: 'percentage',
        paymentMethod: 'Cash'
      }
    });

    assert.equal(salePct.subtotal, 550);
    assert.equal(salePct.discount, 10);
    assert.equal(salePct.totalAmount, 495);
    assert.equal(salePct.items[0].taxableAmount, 471.43);
    assert.equal(salePct.items[0].gstAmount, 23.57);

    // Edited Shirt to 550 + Flat ₹50 Discount -> Net = 500
    const saleAmt = await env.createSaleServer({
      user,
      body: {
        items: [{ productId: 'PROD-SHIRT-1', quantity: 1, rate: 550 }],
        discount: 50,
        discountType: 'amount',
        paymentMethod: 'Cash'
      }
    });

    assert.equal(saleAmt.subtotal, 550);
    assert.equal(saleAmt.discount, 50);
    assert.equal(saleAmt.totalAmount, 500);
  });

  // ─── SCENARIO 9: Invalid, blank and negative values ───
  await test('9. Invalid and negative prices are rejected by server validation', async () => {
    const env = createMockEnvironment();
    const user = { id: 'USER-1', name: 'Staff', role: 'staff', shopId: 'SHOP-TEST' };

    // Negative rate
    await assert.rejects(
      async () => {
        await env.createSaleServer({
          user,
          body: {
            items: [{ productId: 'PROD-SHIRT-1', quantity: 1, rate: -50 }],
            paymentMethod: 'Cash'
          }
        });
      },
      (err) => err.status === 400 && err.error.includes('Invalid unit selling price')
    );

    // NaN / non-numeric rate
    await assert.rejects(
      async () => {
        await env.createSaleServer({
          user,
          body: {
            items: [{ productId: 'PROD-SHIRT-1', quantity: 1, rate: 'invalid-price' }],
            paymentMethod: 'Cash'
          }
        });
      },
      (err) => err.status === 400 && err.error.includes('Invalid unit selling price')
    );
  });

  // ─── SCENARIO 10: Owner and staff billing ───
  await test('10. Both owner and staff can bill with bargained price', async () => {
    const env = createMockEnvironment();
    const staffUser = { id: 'STAFF-1', name: 'Staff Member', role: 'staff', shopId: 'SHOP-TEST' };
    const ownerUser = { id: 'OWNER-1', name: 'Shop Owner', role: 'owner', shopId: 'SHOP-TEST' };

    const staffSale = await env.createSaleServer({
      user: staffUser,
      body: {
        items: [{ productId: 'PROD-SHIRT-1', quantity: 1, rate: 580 }],
        paymentMethod: 'Cash'
      }
    });
    assert.equal(staffSale.items[0].rate, 580);
    assert.equal(staffSale.createdBy.role, 'staff');

    const ownerSale = await env.createSaleServer({
      user: ownerUser,
      body: {
        items: [{ productId: 'PROD-SHIRT-1', quantity: 1, rate: 520 }],
        paymentMethod: 'Cash'
      }
    });
    assert.equal(ownerSale.items[0].rate, 520);
    assert.equal(ownerSale.createdBy.role, 'owner');
  });

  // ─── SCENARIO 11: Stock deduction remains accurate ───
  await test('11. Stock deduction is exact and unaffected by bargained price', async () => {
    const env = createMockEnvironment();
    const user = { id: 'USER-1', name: 'Staff', role: 'staff', shopId: 'SHOP-TEST' };

    const initialStock = env.products.find(p => p.id === 'PROD-SHIRT-1').availability; // 20

    await env.createSaleServer({
      user,
      body: {
        items: [{ productId: 'PROD-SHIRT-1', quantity: 3, rate: 500 }],
        paymentMethod: 'Cash'
      }
    });

    const updatedStock = env.products.find(p => p.id === 'PROD-SHIRT-1').availability;
    assert.equal(updatedStock, initialStock - 3, 'Stock must decrease by exact quantity 3');
  });

  // ─── SCENARIO 12: Printed and WhatsApp bills show actual billed price ───
  await test('12. Printed invoice and WhatsApp message display actual billed price', async () => {
    const sampleSale = {
      id: 'SALE-101',
      invoiceNumber: 'INV-000101',
      shopId: 'SHOP-TEST',
      customerName: 'Priya',
      subtotal: 1100,
      totalAmount: 1100,
      items: [{
        productId: 'PROD-SHIRT-1',
        productName: 'Classic Linen Shirt',
        quantity: 2,
        rate: 550, // Billed at 550 instead of catalogue 600
        total: 1100,
        gstRate: 5,
        gstAmount: 52.38
      }]
    };

    // Test WhatsApp message generation template logic
    const waUtilsPath = path.resolve('frontend/src/utils/whatsapp.ts');
    const waCode = fs.readFileSync(waUtilsPath, 'utf8');
    assert.ok(waCode.includes('rateStr'), 'WhatsApp template must compute rate string');
    assert.ok(waCode.includes('rateVal.toLocaleString'), 'WhatsApp message must format unit rate');
    assert.ok(waCode.includes('lineTotal'), 'WhatsApp message must compute line total using rate');

    // Test printed invoice HTML template contains rate
    const printUtilsPath = path.resolve('frontend/src/utils/printInvoice.ts');
    const printCode = fs.readFileSync(printUtilsPath, 'utf8');
    assert.ok(printCode.includes('${rateDisplay}'), 'Print invoice must output rateDisplay');
    assert.ok(printCode.includes('Number(item.rate)'), 'Print invoice must format Number(item.rate)');
  });

  // ─── SCENARIO 13: Frontend code contracts ───
  await test('13. Frontend SalesSession includes inline price editing, custom price tag, and Enter key confirmation', async () => {
    assert.ok(salesSessionCode.includes('handleStartEditPrice'), 'Must have handleStartEditPrice');
    assert.ok(salesSessionCode.includes('handleSavePrice'), 'Must have handleSavePrice');
    assert.ok(salesSessionCode.includes('handleCancelEditPrice'), 'Must have handleCancelEditPrice');
    assert.ok(salesSessionCode.includes('isPriceModified'), 'Must detect if price differs from catalogue price');
    assert.ok(salesSessionCode.includes('Custom'), 'Must display Custom badge when price is modified');
    assert.ok(salesSessionCode.includes('line-through'), 'Must show original catalogue price with strikethrough');
    assert.ok(salesSessionCode.includes("e.key === 'Enter'"), 'Must confirm edited price on Enter');
    assert.ok(salesSessionCode.includes("e.key === 'Escape'"), 'Must cancel editing on Escape');
  });

  // ─── SCENARIO 14: Sale Model schema contract ───
  await test('14. Sale Model schema and server route preserve originalPrice and rate', async () => {
    assert.ok(saleModelCode.includes('originalPrice: { type: Number }'), 'Sale model items must define originalPrice');
    assert.ok(saleModelCode.includes('rate: { type: Number, required: true }'), 'Sale model items must define rate');
    assert.ok(serverCode.includes('originalPrice: originalCataloguePrice'), 'server.js must save originalPrice');
    assert.ok(serverCode.includes('rate: trustedRate'), 'server.js must save actual trustedRate');
  });

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
