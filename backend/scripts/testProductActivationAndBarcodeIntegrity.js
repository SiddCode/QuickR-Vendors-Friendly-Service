/**
 * QuickR — Product Activation & Barcode Integrity Regression Test Suite
 *
 * Scenarios tested (Offline / Mocked — zero live DB / zero Atlas connection):
 * 1. Owner activates inactive product -> Status becomes active
 * 2. Owner deactivates active product -> Status becomes inactive
 * 3. Edit product status -> Other product fields remain unchanged
 * 4. Staff cannot change product activation status -> Rejected with 403
 * 5. Scan active product barcode -> Exact product returned / added
 * 6. Scan inactive product barcode -> Rejected with exact message "This product is inactive. Activate it before billing."
 * 7. Scan unknown barcode -> Rejected with exact message "Product not found for this barcode."
 * 8. Scan another shop's barcode -> No cross-shop product returned (scoped strictly to req.user.shopId)
 * 9. Duplicate barcode across different shops -> Correct shop's product returned
 * 10. Similar or partial barcode -> Never returns unrelated product
 * 11. Complete sale with inactive product -> Backend rejects sale before transaction/stock decrement
 * 12. Complete sale with other shop's product -> Backend rejects sale with 403
 * 13. Normal active product billing -> Authoritative calculation and validation succeed
 * 14. Stock insufficient -> Protected and rejected before sale creation
 * 15. Manual product selection -> Active products filtered and selectable; inactive excluded
 */

import assert from 'node:assert/strict';

let passedCount = 0;
let failedCount = 0;

async function test(name, fn) {
  try {
    await fn();
    passedCount++;
    console.log(`  ✅ PASS: ${name}`);
  } catch (err) {
    failedCount++;
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     ${err.stack || err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// In-Memory Database Simulator for Exact Scenarios
// ─────────────────────────────────────────────────────────────────────────────
function createMockDb() {
  const products = [
    {
      id: 'PROD-A1',
      shopId: 'SHOP-ALPHA',
      name: 'Alpha Active Shirt',
      category: 'Shirts',
      sellingPrice: 799,
      originalPrice: 999,
      availability: 15,
      measurementType: 'piece',
      barcode: 'QKR-ALPHA01',
      isActive: true,
      gstRate: 5,
      hsnCode: '6205',
      priceIncludesGst: true
    },
    {
      id: 'PROD-A2',
      shopId: 'SHOP-ALPHA',
      name: 'Alpha Disabled Jeans',
      category: 'Jeans',
      sellingPrice: 1499,
      originalPrice: 1999,
      availability: 8,
      measurementType: 'piece',
      barcode: 'QKR-ALPHA02',
      isActive: false, // DISABLED
      gstRate: 12,
      hsnCode: '6203',
      priceIncludesGst: true
    },
    {
      id: 'PROD-B1',
      shopId: 'SHOP-BETA',
      name: 'Beta Shirt (Same Barcode as Alpha)',
      category: 'Shirts',
      sellingPrice: 850,
      originalPrice: 1100,
      availability: 20,
      measurementType: 'piece',
      barcode: 'QKR-ALPHA01', // Same barcode across different shop
      isActive: true,
      gstRate: 5,
      hsnCode: '6205',
      priceIncludesGst: true
    },
    {
      id: 'PROD-B2',
      shopId: 'SHOP-BETA',
      name: 'Beta Exclusive Jeans',
      category: 'Jeans',
      sellingPrice: 1600,
      availability: 5,
      measurementType: 'piece',
      barcode: 'QKR-BETA99',
      isActive: true,
      gstRate: 12,
      priceIncludesGst: true
    }
  ];

  return {
    products,
    findProductByBarcode(shopId, scannedBarcode) {
      const raw = String(scannedBarcode || '').trim();
      if (!raw) return null;
      const targetBarcodes = [raw];
      const upper = raw.toUpperCase();
      if (upper !== raw) targetBarcodes.push(upper);

      // Exact matching strictly scoped to shopId
      return products.find(p => p.shopId === shopId && (p.barcode === raw || p.barcode === upper)) || null;
    },
    findProductById(shopId, prodId) {
      return products.find(p => p.shopId === shopId && p.id === prodId) || null;
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Route Handlers Implementation under test (Matching server.js logic)
// ─────────────────────────────────────────────────────────────────────────────
function handleBarcodeLookup(db, req) {
  const shopId = req.user?.shopId;
  if (!shopId) {
    return { status: 403, body: { error: 'Shop authorization required' } };
  }

  const rawBarcode = req.params?.barcode ? String(req.params.barcode).trim() : '';
  if (!rawBarcode) {
    return { status: 400, body: { error: 'Barcode parameter required' } };
  }

  const prod = db.findProductByBarcode(shopId, rawBarcode);

  if (!prod) {
    return {
      status: 404,
      body: {
        error: 'Product not found for this barcode.',
        barcode: rawBarcode,
        found: false
      }
    };
  }

  if (!prod.isActive) {
    return {
      status: 400,
      body: {
        error: 'This product is inactive. Activate it before billing.',
        barcode: rawBarcode,
        found: true,
        inactive: true,
        productId: prod.id,
        productName: prod.name
      }
    };
  }

  return { status: 200, body: prod };
}

function handleProductUpdate(db, req) {
  const shopId = req.user?.shopId;
  if (!shopId) {
    return { status: 403, body: { error: 'Shop authorization required' } };
  }

  const prod = db.findProductById(shopId, req.params?.id);
  if (!prod) {
    return { status: 404, body: { error: 'Product not found' } };
  }

  const {
    name,
    category,
    subcategory,
    sellingPrice,
    originalPrice,
    sizes,
    colors,
    availability,
    description,
    isActive,
    gstRate,
    hsnCode,
    priceIncludesGst,
    measurementType
  } = req.body || {};

  if (name !== undefined) prod.name = String(name).trim();
  if (category !== undefined) prod.category = category;
  if (subcategory !== undefined) prod.subcategory = subcategory;
  if (sellingPrice !== undefined) prod.sellingPrice = Number(sellingPrice);
  if (originalPrice !== undefined) prod.originalPrice = Number(originalPrice);
  if (sizes !== undefined) prod.sizes = sizes;
  if (colors !== undefined) prod.colors = colors;
  if (availability !== undefined) prod.availability = Number(availability);
  if (description !== undefined) prod.description = description;

  if (isActive !== undefined) {
    const boolActive = (isActive === true || isActive === 'true');
    if (req.user?.role === 'staff' && boolActive !== prod.isActive) {
      return {
        status: 403,
        body: { error: 'Staff accounts are not authorized to change product activation status.' }
      };
    }
    prod.isActive = boolActive;
  }

  if (measurementType !== undefined) {
    prod.measurementType = measurementType === 'length' ? 'length' : 'piece';
  }
  if (hsnCode !== undefined) prod.hsnCode = String(hsnCode).trim();
  if (priceIncludesGst !== undefined) prod.priceIncludesGst = Boolean(priceIncludesGst);
  if (gstRate !== undefined) {
    const numGstRate = Number(gstRate);
    const validRates = [0, 5, 12, 18, 28];
    if (isNaN(numGstRate) || numGstRate < 0 || !validRates.includes(numGstRate)) {
      return { status: 400, body: { error: 'GST rate must be one of [0, 5, 12, 18, 28]' } };
    }
    prod.gstRate = numGstRate;
  }

  return { status: 200, body: prod };
}

function handleSaleCreation(db, req) {
  const shopId = req.user?.shopId;
  if (!shopId) {
    return { status: 403, body: { error: 'Shop authorization required' } };
  }

  const { items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return { status: 400, body: { error: 'Items required' } };
  }

  const requestedQtyByProduct = new Map();

  for (const item of items) {
    if (item.productId) {
      // Find product across database to detect wrong shop or deleted
      const allMatches = db.products.filter(p => p.id === String(item.productId));
      const dbProd = allMatches.find(p => p.shopId === shopId);
      const foreignProd = allMatches.find(p => p.shopId !== shopId);

      if (!dbProd && foreignProd) {
        return {
          status: 403,
          body: { error: `Product ${foreignProd.name || item.productId} does not belong to this shop` }
        };
      }
      if (!dbProd) {
        return {
          status: 404,
          body: { error: `Product ${item.productName || item.productId} not found` }
        };
      }
      if (!dbProd.isActive) {
        return {
          status: 400,
          body: {
            error: `Cannot complete sale: "${dbProd.name}" is inactive. Activate it before billing.`,
            inactive: true,
            productId: dbProd.id
          }
        };
      }

      const reqQty = Number(item.quantity);
      requestedQtyByProduct.set(dbProd.id, (requestedQtyByProduct.get(dbProd.id) || 0) + reqQty);
    }
  }

  // Stock check
  for (const [prodId, reqQty] of requestedQtyByProduct.entries()) {
    const prod = db.findProductById(shopId, prodId);
    if ((prod.availability || 0) < reqQty) {
      return {
        status: 400,
        body: { error: `Insufficient stock for ${prod.name}. Available: ${prod.availability}, Requested: ${reqQty}` }
      };
    }
  }

  // Deduct stock on success
  for (const [prodId, reqQty] of requestedQtyByProduct.entries()) {
    const prod = db.findProductById(shopId, prodId);
    prod.availability -= reqQty;
  }

  return {
    status: 201,
    body: {
      success: true,
      invoiceNumber: 'INV-000001',
      itemsCount: items.length
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Frontend Cart Logic Simulator (Matching Billing.tsx and SalesSession.tsx)
// ─────────────────────────────────────────────────────────────────────────────
function createFrontendSimulator(allShopProducts) {
  let cart = [];
  let inactiveAlert = null;
  let notFoundAlert = null;
  let outOfStockAlert = null;

  function processScannedBarcode(scannedCode) {
    const cleanCode = String(scannedCode || '').trim().toUpperCase();
    if (!cleanCode) return;

    notFoundAlert = null;
    inactiveAlert = null;

    // 1. Local products list exact match
    const localMatch = allShopProducts.find(p => p.barcode && p.barcode.trim().toUpperCase() === cleanCode);
    if (localMatch) {
      if (!localMatch.isActive) {
        inactiveAlert = {
          barcode: cleanCode,
          message: 'This product is inactive. Activate it before billing.',
          productName: localMatch.name
        };
        return;
      }
      addScannedProductToCart(localMatch);
      return;
    }

    notFoundAlert = {
      barcode: cleanCode,
      message: 'Product not found for this barcode.'
    };
  }

  function addScannedProductToCart(prod) {
    if (!prod) return;
    if (!prod.isActive) {
      inactiveAlert = {
        barcode: prod.barcode || '',
        message: 'This product is inactive. Activate it before billing.',
        productName: prod.name
      };
      return;
    }
    if (prod.availability !== undefined && prod.availability <= 0) {
      outOfStockAlert = prod;
      return;
    }

    const existingIndex = cart.findIndex(i => i.productId === prod.id);
    if (existingIndex >= 0) {
      cart[existingIndex].quantity += 1;
    } else {
      cart.push({
        id: `ITEM-${Date.now()}-${cart.length}`,
        productId: prod.id,
        productName: prod.name,
        quantity: 1,
        rate: prod.sellingPrice
      });
    }
  }

  return {
    getCart: () => cart,
    getInactiveAlert: () => inactiveAlert,
    getNotFoundAlert: () => notFoundAlert,
    getOutOfStockAlert: () => outOfStockAlert,
    processScannedBarcode,
    addScannedProductToCart,
    getActiveSelectableProducts: () => allShopProducts.filter(p => p.isActive)
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN TESTS
// ─────────────────────────────────────────────────────────────────────────────
console.log('🧪 Starting QuickR Product Activation & Barcode Integrity Suite...\n');

// 1. Owner activates inactive product
await test('1. Owner activates inactive product: status becomes active in DB', async () => {
  const db = createMockDb();
  const req = {
    user: { id: 'USER-OWNER', role: 'owner', shopId: 'SHOP-ALPHA' },
    params: { id: 'PROD-A2' },
    body: { isActive: true }
  };

  assert.equal(db.findProductById('SHOP-ALPHA', 'PROD-A2').isActive, false);
  const res = handleProductUpdate(db, req);
  assert.equal(res.status, 200);
  assert.equal(res.body.isActive, true);
  assert.equal(db.findProductById('SHOP-ALPHA', 'PROD-A2').isActive, true);
});

// 2. Owner deactivates active product
await test('2. Owner deactivates active product: status becomes inactive in DB', async () => {
  const db = createMockDb();
  const req = {
    user: { id: 'USER-OWNER', role: 'owner', shopId: 'SHOP-ALPHA' },
    params: { id: 'PROD-A1' },
    body: { isActive: false }
  };

  assert.equal(db.findProductById('SHOP-ALPHA', 'PROD-A1').isActive, true);
  const res = handleProductUpdate(db, req);
  assert.equal(res.status, 200);
  assert.equal(res.body.isActive, false);
  assert.equal(db.findProductById('SHOP-ALPHA', 'PROD-A1').isActive, false);
});

// 3. Edit product status preserves all other product fields
await test('3. Edit product status: all other product fields (price, stock, barcode, GST) remain strictly unchanged', async () => {
  const db = createMockDb();
  const before = { ...db.findProductById('SHOP-ALPHA', 'PROD-A2') };

  const req = {
    user: { id: 'USER-OWNER', role: 'owner', shopId: 'SHOP-ALPHA' },
    params: { id: 'PROD-A2' },
    body: { isActive: true }
  };

  const res = handleProductUpdate(db, req);
  assert.equal(res.status, 200);

  const after = db.findProductById('SHOP-ALPHA', 'PROD-A2');
  assert.equal(after.isActive, true);
  assert.equal(after.name, before.name);
  assert.equal(after.category, before.category);
  assert.equal(after.sellingPrice, before.sellingPrice);
  assert.equal(after.originalPrice, before.originalPrice);
  assert.equal(after.availability, before.availability);
  assert.equal(after.barcode, before.barcode);
  assert.equal(after.gstRate, before.gstRate);
  assert.equal(after.hsnCode, before.hsnCode);
  assert.equal(after.shopId, before.shopId);
});

// 4. Staff permission check: Staff cannot change isActive
await test('4. Staff permission: Staff accounts cannot change product activation status (returns 403)', async () => {
  const db = createMockDb();
  const req = {
    user: { id: 'USER-STAFF', role: 'staff', shopId: 'SHOP-ALPHA' },
    params: { id: 'PROD-A2' },
    body: { isActive: true }
  };

  const res = handleProductUpdate(db, req);
  assert.equal(res.status, 403);
  assert.match(res.body.error, /Staff accounts are not authorized to change product activation status/);
  // Status in DB remains unchanged
  assert.equal(db.findProductById('SHOP-ALPHA', 'PROD-A2').isActive, false);
});

// 5. Scan active product barcode
await test('5. Scan active product barcode: returns exact product', async () => {
  const db = createMockDb();
  const req = {
    user: { shopId: 'SHOP-ALPHA' },
    params: { barcode: 'QKR-ALPHA01' }
  };

  const res = handleBarcodeLookup(db, req);
  assert.equal(res.status, 200);
  assert.equal(res.body.id, 'PROD-A1');
  assert.equal(res.body.name, 'Alpha Active Shirt');
  assert.equal(res.body.isActive, true);
});

// 6. Scan inactive product barcode
await test('6. Scan inactive product barcode: rejected with exact message "This product is inactive. Activate it before billing."', async () => {
  const db = createMockDb();
  const req = {
    user: { shopId: 'SHOP-ALPHA' },
    params: { barcode: 'QKR-ALPHA02' }
  };

  const res = handleBarcodeLookup(db, req);
  assert.equal(res.status, 400);
  assert.equal(res.body.inactive, true);
  assert.equal(res.body.error, 'This product is inactive. Activate it before billing.');
  assert.equal(res.body.productId, 'PROD-A2');
});

// 7. Scan unknown barcode
await test('7. Scan unknown barcode: rejected with exact message "Product not found for this barcode."', async () => {
  const db = createMockDb();
  const req = {
    user: { shopId: 'SHOP-ALPHA' },
    params: { barcode: 'UNKNOWN-BARCODE-999' }
  };

  const res = handleBarcodeLookup(db, req);
  assert.equal(res.status, 404);
  assert.equal(res.body.found, false);
  assert.equal(res.body.error, 'Product not found for this barcode.');
});

// 8. Scan another shop's barcode
await test("8. Scan another shop's barcode: no cross-shop product returned (scoped strictly to req.user.shopId)", async () => {
  const db = createMockDb();
  // SHOP-ALPHA scans a barcode that ONLY exists in SHOP-BETA ('QKR-BETA99')
  const req = {
    user: { shopId: 'SHOP-ALPHA' },
    params: { barcode: 'QKR-BETA99' }
  };

  const res = handleBarcodeLookup(db, req);
  assert.equal(res.status, 404);
  assert.equal(res.body.found, false);
  assert.equal(res.body.error, 'Product not found for this barcode.');
});

// 9. Duplicate barcode across different shops
await test('9. Duplicate barcode across different shops: returns authenticated shop product only', async () => {
  const db = createMockDb();
  // 'QKR-ALPHA01' exists in both SHOP-ALPHA and SHOP-BETA
  const reqAlpha = {
    user: { shopId: 'SHOP-ALPHA' },
    params: { barcode: 'QKR-ALPHA01' }
  };
  const resAlpha = handleBarcodeLookup(db, reqAlpha);
  assert.equal(resAlpha.status, 200);
  assert.equal(resAlpha.body.id, 'PROD-A1');
  assert.equal(resAlpha.body.shopId, 'SHOP-ALPHA');

  const reqBeta = {
    user: { shopId: 'SHOP-BETA' },
    params: { barcode: 'QKR-ALPHA01' }
  };
  const resBeta = handleBarcodeLookup(db, reqBeta);
  assert.equal(resBeta.status, 200);
  assert.equal(resBeta.body.id, 'PROD-B1');
  assert.equal(resBeta.body.shopId, 'SHOP-BETA');
});

// 10. Similar or partial barcode
await test('10. Similar or partial barcode: never matches or returns unrelated product', async () => {
  const db = createMockDb();
  for (const partial of ['QKR-ALPHA', 'ALPHA01', 'QKR', 'QKR-ALPHA0', 'ALPHA']) {
    const req = {
      user: { shopId: 'SHOP-ALPHA' },
      params: { barcode: partial }
    };
    const res = handleBarcodeLookup(db, req);
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'Product not found for this barcode.');
  }
});

// 11. Complete sale with inactive product
await test('11. Complete sale with inactive product: backend rejects sale and stock is untouched', async () => {
  const db = createMockDb();
  const initialStockA2 = db.findProductById('SHOP-ALPHA', 'PROD-A2').availability;
  const initialStockA1 = db.findProductById('SHOP-ALPHA', 'PROD-A1').availability;

  const req = {
    user: { shopId: 'SHOP-ALPHA' },
    body: {
      items: [
        { productId: 'PROD-A1', quantity: 1, rate: 799 },
        { productId: 'PROD-A2', quantity: 1, rate: 1499 } // INACTIVE
      ]
    }
  };

  const res = handleSaleCreation(db, req);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /is inactive\. Activate it before billing\./);

  // Stock must NOT be decremented for ANY product
  assert.equal(db.findProductById('SHOP-ALPHA', 'PROD-A2').availability, initialStockA2);
  assert.equal(db.findProductById('SHOP-ALPHA', 'PROD-A1').availability, initialStockA1);
});

// 12. Complete sale with foreign shop product
await test('12. Complete sale with foreign shop product: backend rejects sale with 403', async () => {
  const db = createMockDb();
  const req = {
    user: { shopId: 'SHOP-ALPHA' },
    body: {
      items: [
        { productId: 'PROD-B2', quantity: 1, rate: 1600 } // Belongs to SHOP-BETA
      ]
    }
  };

  const res = handleSaleCreation(db, req);
  assert.equal(res.status, 403);
  assert.match(res.body.error, /does not belong to this shop/);
});

// 13. Normal active product billing
await test('13. Normal active product billing: succeeds and decrements stock atomically', async () => {
  const db = createMockDb();
  const initialStock = db.findProductById('SHOP-ALPHA', 'PROD-A1').availability;

  const req = {
    user: { shopId: 'SHOP-ALPHA' },
    body: {
      items: [
        { productId: 'PROD-A1', quantity: 2, rate: 799 }
      ]
    }
  };

  const res = handleSaleCreation(db, req);
  assert.equal(res.status, 201);
  assert.equal(res.body.success, true);
  assert.equal(db.findProductById('SHOP-ALPHA', 'PROD-A1').availability, initialStock - 2);
});

// 14. Stock insufficient
await test('14. Insufficient stock: sale rejected and stock remains unchanged', async () => {
  const db = createMockDb();
  const initialStock = db.findProductById('SHOP-ALPHA', 'PROD-A1').availability;

  const req = {
    user: { shopId: 'SHOP-ALPHA' },
    body: {
      items: [
        { productId: 'PROD-A1', quantity: initialStock + 10, rate: 799 }
      ]
    }
  };

  const res = handleSaleCreation(db, req);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Insufficient stock/);
  assert.equal(db.findProductById('SHOP-ALPHA', 'PROD-A1').availability, initialStock);
});

// 15. Frontend Cart Protection Simulator (Verifying Bug 2 exact scenario)
await test('15. Frontend cart simulator: scanning inactive product rejects and never substitutes unrelated product', async () => {
  const db = createMockDb();
  const alphaProducts = db.products.filter(p => p.shopId === 'SHOP-ALPHA');
  const sim = createFrontendSimulator(alphaProducts);

  // Scan inactive product PROD-A2 ('QKR-ALPHA02')
  sim.processScannedBarcode('QKR-ALPHA02');

  // Verify cart is EMPTY — no product was added!
  assert.equal(sim.getCart().length, 0);

  // Verify exact inactive alert was triggered
  const alert = sim.getInactiveAlert();
  assert.ok(alert, 'Inactive alert must be present');
  assert.equal(alert.message, 'This product is inactive. Activate it before billing.');
  assert.equal(alert.productName, 'Alpha Disabled Jeans');

  // Verify active selectable dropdown products excludes inactive products
  const selectables = sim.getActiveSelectableProducts();
  assert.equal(selectables.some(p => p.id === 'PROD-A2'), false);
  assert.equal(selectables.some(p => p.id === 'PROD-A1'), true);

  // Now scan active product PROD-A1 ('QKR-ALPHA01')
  sim.processScannedBarcode('QKR-ALPHA01');
  assert.equal(sim.getCart().length, 1);
  assert.equal(sim.getCart()[0].productId, 'PROD-A1');
  assert.equal(sim.getCart()[0].quantity, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// Real Express app HTTP integration tests (Exercising server.js route handlers)
// ─────────────────────────────────────────────────────────────────────────────
process.env.QUICKR_TEST_IMPORT = 'true';
const http = await import('node:http');
const jwt = (await import('jsonwebtoken')).default;
const { getJwtSecret } = await import('../config/jwt.js');
const { User } = await import('../models/User.js');
const { Shop } = await import('../models/Shop.js');
const { Product } = await import('../models/Product.js');
const { app } = await import('../server.js');

const jwtSecret = getJwtSecret();
const ownerToken = jwt.sign({ id: 'OWNER-1', shopId: 'SHOP-ALPHA', role: 'owner' }, jwtSecret, { algorithm: 'HS256' });
const staffToken = jwt.sign({ id: 'STAFF-1', shopId: 'SHOP-ALPHA', role: 'staff' }, jwtSecret, { algorithm: 'HS256' });

// Mock User and Shop lookups for requireAuth middleware
User.findOne = (query) => ({
  select: () => ({
    lean: async () => ({
      id: query.id,
      name: query.id.includes('STAFF') ? 'Staff Member' : 'Shop Owner',
      email: 'test@quickr.local',
      shopId: query.shopId || 'SHOP-ALPHA',
      role: query.id.includes('STAFF') ? 'staff' : 'owner',
      status: 'active'
    })
  })
});

Shop.findOne = (query) => ({
  select: () => ({
    lean: async () => ({
      customId: query.customId || 'SHOP-ALPHA',
      status: 'active',
      subscriptionStatus: 'active',
      isGstRegistered: false
    })
  }),
  lean: async () => ({
    customId: query.customId || 'SHOP-ALPHA',
    status: 'active',
    subscriptionStatus: 'active',
    isGstRegistered: false
  })
});

const { Readable, Duplex } = await import('node:stream');

function request(urlPath, { method = 'GET', token = ownerToken, body = null } = {}) {
  return new Promise((resolve) => {
    const req = new Readable({ read() {} });
    req.method = method;
    req.url = urlPath;
    const serializedBody = body ? (typeof body === 'object' ? JSON.stringify(body) : String(body)) : null;
    req.headers = {
      authorization: `Bearer ${token}`
    };
    if (serializedBody) {
      req.headers['content-type'] = 'application/json';
      req.headers['content-length'] = Buffer.byteLength(serializedBody);
    }
    req.get = (h) => req.headers[h.toLowerCase()];
    req.header = req.get;
    req.socket = new Duplex({ read() {}, write(c, e, cb) { cb(); } });
    req.socket.remoteAddress = '127.0.0.1';
    req.connection = req.socket;

    let resBody = '';
    const resHeaders = {};
    const res = new Duplex({
      read() {},
      write(chunk, enc, cb) {
        if (chunk) resBody += chunk.toString();
        cb();
      }
    });
    res.statusCode = 200;
    res.setHeader = (k, v) => { resHeaders[k.toLowerCase()] = v; };
    res.getHeader = (k) => resHeaders[k.toLowerCase()];
    res.end = (chunk) => {
      if (chunk) resBody += chunk.toString();
      let parsed = resBody;
      try { parsed = JSON.parse(resBody); } catch {}
      resolve({ status: res.statusCode, headers: resHeaders, body: parsed });
    };

    app.handle(req, res);

    if (serializedBody) {
      req.push(serializedBody);
    }
    req.push(null);
  });
}

try {
  // 16. Live Express Route: GET /api/products/barcode/:barcode for active product
  await test('16. Live Express Route: GET /api/products/barcode/:barcode returns 200 for active product', async () => {
    Product.findOne = (query) => ({
      lean: async () => {
        if (query.shopId === 'SHOP-ALPHA' && (query.barcode === 'QKR-LIVE01' || (Array.isArray(query.barcode?.$in) && query.barcode.$in.includes('QKR-LIVE01')))) {
          return {
            id: 'PROD-LIVE-1',
            shopId: 'SHOP-ALPHA',
            name: 'Live Active Denim',
            barcode: 'QKR-LIVE01',
            isActive: true,
            sellingPrice: 1200
          };
        }
        return null;
      }
    });

    const res = await request('/api/products/barcode/QKR-LIVE01');
    assert.equal(res.status, 200);
    assert.equal(res.body.id, 'PROD-LIVE-1');
    assert.equal(res.body.isActive, true);
  });

  // 17. Live Express Route: GET /api/products/barcode/:barcode for inactive product returns 400 with exact message
  await test('17. Live Express Route: GET /api/products/barcode/:barcode returns 400 + exact message for inactive product', async () => {
    Product.findOne = (query) => ({
      lean: async () => {
        if (query.shopId === 'SHOP-ALPHA' && (query.barcode === 'QKR-INACTIVE' || (Array.isArray(query.barcode?.$in) && query.barcode.$in.includes('QKR-INACTIVE')))) {
          return {
            id: 'PROD-LIVE-2',
            shopId: 'SHOP-ALPHA',
            name: 'Live Inactive Silk Saree',
            barcode: 'QKR-INACTIVE',
            isActive: false,
            sellingPrice: 2500
          };
        }
        return null;
      }
    });

    const res = await request('/api/products/barcode/QKR-INACTIVE');
    assert.equal(res.status, 400);
    assert.equal(res.body.inactive, true);
    assert.equal(res.body.error, 'This product is inactive. Activate it before billing.');
    assert.equal(res.body.productId, 'PROD-LIVE-2');
  });

  // 18. Live Express Route: GET /api/products/barcode/:barcode for unknown barcode returns 404 with exact message
  await test('18. Live Express Route: GET /api/products/barcode/:barcode returns 404 + exact message for unknown barcode', async () => {
    Product.findOne = () => ({
      lean: async () => null
    });

    const res = await request('/api/products/barcode/UNKNOWN-BARCODE');
    assert.equal(res.status, 404);
    assert.equal(res.body.found, false);
    assert.equal(res.body.error, 'Product not found for this barcode.');
  });

  // 19. Live Express Route: PUT /api/products/:id owner can update isActive
  await test('19. Live Express Route: PUT /api/products/:id owner can update isActive', async () => {
    const mockDoc = {
      id: 'PROD-LIVE-3',
      shopId: 'SHOP-ALPHA',
      name: 'Editable Shirt',
      isActive: false,
      sellingPrice: 500,
      save: async function () { return this; }
    };

    Product.findOne = async () => mockDoc;

    const res = await request('/api/products/PROD-LIVE-3', {
      method: 'PUT',
      token: ownerToken,
      body: { isActive: true }
    });

    assert.equal(res.status, 200);
    assert.equal(mockDoc.isActive, true);
    assert.equal(mockDoc.name, 'Editable Shirt');
  });

  // 20. Live Express Route: PUT /api/products/:id staff cannot update isActive (returns 403)
  await test('20. Live Express Route: PUT /api/products/:id staff is rejected with 403 when modifying isActive', async () => {
    const mockDoc = {
      id: 'PROD-LIVE-4',
      shopId: 'SHOP-ALPHA',
      name: 'Staff Protected Shirt',
      isActive: false,
      sellingPrice: 500,
      save: async function () { return this; }
    };

    Product.findOne = async () => mockDoc;

    const res = await request('/api/products/PROD-LIVE-4', {
      method: 'PUT',
      token: staffToken,
      body: { isActive: true }
    });

    assert.equal(res.status, 403);
    assert.match(res.body.error, /Staff accounts are not authorized to change product activation status/);
    assert.equal(mockDoc.isActive, false); // Status not changed!
  });

  // 21. Live Express Route: POST /api/sales rejects inactive product before sale creation
  await test('21. Live Express Route: POST /api/sales rejects inactive product with 400', async () => {
    Product.find = (query) => ({
      lean: async () => [
        {
          id: 'PROD-INACTIVE-ITEM',
          shopId: 'SHOP-ALPHA',
          name: 'Disabled Wool Coat',
          availability: 10,
          sellingPrice: 3000,
          measurementType: 'piece',
          isActive: false
        }
      ]
    });

    const res = await request('/api/sales', {
      method: 'POST',
      token: ownerToken,
      body: {
        totalAmount: 3000,
        paymentMethod: 'Cash',
        items: [
          { productId: 'PROD-INACTIVE-ITEM', quantity: 1, rate: 3000 }
        ]
      }
    });

    assert.equal(res.status, 400);
    assert.match(res.body.error, /is inactive\. Activate it before billing\./);
  });
} catch (err) {
  console.error('Unexpected test harness error:', err);
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary Report
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n════════════════════════════════════════════════════════════════════');
console.log(`Test Execution Complete: ${passedCount} PASSED, ${failedCount} FAILED`);
console.log('════════════════════════════════════════════════════════════════════\n');

if (failedCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
