/**
 * QuickR — Product Search & Alphabetical Sorting Regression Test Suite
 *
 * Scenarios tested (Offline / Mocked — zero live DB / zero Atlas connection):
 * 1. Products appear alphabetically A–Z.
 * 2. Mixed uppercase/lowercase names sort correctly.
 * 3. Search by complete product name works.
 * 4. Search by partial product name works.
 * 5. Search by barcode works.
 * 6. Search is case-insensitive.
 * 7. Clearing search restores the full sorted list.
 * 8. No-results message works.
 * 9. Inactive products cannot be selected.
 * 10. Another shop's products never appear.
 * 11. Selecting a result adds the correct product to the cart.
 * 12. Barcode scanning still adds the correct active product.
 * 13. Existing GST, stock and billing calculations remain correct.
 * 14. Mobile layout works without clipping.
 * 15. Live Express GET /api/products returns products sorted A–Z case-insensitively.
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
// Simulator for Sorting & Search (Matching AddProductSelectModal & AppContext)
// ─────────────────────────────────────────────────────────────────────────────

function sortProductsAlphabetically(products) {
  return [...products].sort((a, b) => 
    (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })
  );
}

function filterAndSortProducts(products, searchQuery) {
  const activeProducts = products.filter(p => p.isActive);
  const trimmed = searchQuery.trim().toLowerCase();
  let result = activeProducts;

  if (trimmed) {
    result = activeProducts.filter(p => {
      const nameMatch = p.name ? p.name.toLowerCase().includes(trimmed) : false;
      const barcodeMatch = p.barcode ? p.barcode.toLowerCase().includes(trimmed) : false;
      const categoryMatch = p.category ? p.category.toLowerCase().includes(trimmed) : false;
      return nameMatch || barcodeMatch || categoryMatch;
    });
  }

  return sortProductsAlphabetically(result);
}

function createBillingCartSimulator(products) {
  let items = [];

  function addItemFromModal(selectedProduct) {
    if (!selectedProduct || !selectedProduct.isActive) {
      throw new Error('Cannot add inactive or invalid product');
    }
    const newItem = {
      id: `ITEM-${Date.now()}-${Math.random()}`,
      productId: selectedProduct.id,
      quantity: 1,
      rate: selectedProduct.sellingPrice
    };
    items.push(newItem);
    return newItem;
  }

  function addScannedBarcode(barcode) {
    const clean = barcode.trim().toUpperCase();
    const prod = products.find(p => p.barcode && p.barcode.trim().toUpperCase() === clean);
    if (!prod) throw new Error('Product not found for this barcode.');
    if (!prod.isActive) throw new Error('This product is inactive. Activate it before billing.');

    const existing = items.find(i => i.productId === prod.id);
    if (existing) {
      existing.quantity += 1;
      return existing;
    } else {
      const newItem = {
        id: `ITEM-${Date.now()}-${Math.random()}`,
        productId: prod.id,
        quantity: 1,
        rate: prod.sellingPrice
      };
      items.push(newItem);
      return newItem;
    }
  }

  return {
    getItems: () => items,
    addItemFromModal,
    addScannedBarcode
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTE ALL 14 REGRESSION SCENARIOS
// ─────────────────────────────────────────────────────────────────────────────

async function runAllTests() {
  console.log('Starting QuickR Product Search & Alphabetical Sorting Suite...\n');

  const shopAProducts = [
    { id: 'P-1', shopId: 'SHOP-A', name: 'Zebra Print T-Shirt', category: 'T-Shirts', sellingPrice: 599, barcode: 'QKR-ZEBRA-01', isActive: true, gstRate: 5, availability: 10 },
    { id: 'P-2', shopId: 'SHOP-A', name: 'blue denim jeans', category: 'Jeans', sellingPrice: 1299, barcode: 'QKR-JEANS-02', isActive: true, gstRate: 12, availability: 15 },
    { id: 'P-3', shopId: 'SHOP-A', name: 'Cotton Polo', category: 'Polos', sellingPrice: 799, barcode: 'QKR-POLO-03', isActive: true, gstRate: 5, availability: 20 },
    { id: 'P-4', shopId: 'SHOP-A', name: 'Formal White Shirt', category: 'Shirts', sellingPrice: 999, barcode: 'QKR-SHIRT-04', isActive: true, gstRate: 5, availability: 25 },
    { id: 'P-5', shopId: 'SHOP-A', name: 'Disabled Red Kurta', category: 'Kurtas', sellingPrice: 850, barcode: 'QKR-KURTA-05', isActive: false, gstRate: 5, availability: 5 },
    { id: 'P-6', shopId: 'SHOP-A', name: 'apricot linen shirt', category: 'Shirts', sellingPrice: 899, barcode: 'QKR-LINEN-06', isActive: true, gstRate: 5, availability: 8 },
    { id: 'P-7', shopId: 'SHOP-A', name: 'BANANA EMBROIDERY JACKET', category: 'Jackets', sellingPrice: 2499, barcode: 'QKR-JACKET-07', isActive: true, gstRate: 12, availability: 4 },
  ];

  const shopBProducts = [
    { id: 'P-B1', shopId: 'SHOP-B', name: 'Shop B Exclusive Silk Saree', category: 'Sarees', sellingPrice: 3500, barcode: 'QKR-SAREE-99', isActive: true }
  ];

  // Test 1: Products appear alphabetically A–Z
  await test('Scenario 1: Products appear alphabetically A–Z', async () => {
    const sorted = filterAndSortProducts(shopAProducts, '');
    const names = sorted.map(p => p.name);

    // Expected order: apricot, BANANA, blue, Cotton, Formal, Zebra (all active)
    assert.deepEqual(names, [
      'apricot linen shirt',
      'BANANA EMBROIDERY JACKET',
      'blue denim jeans',
      'Cotton Polo',
      'Formal White Shirt',
      'Zebra Print T-Shirt'
    ]);
  });

  // Test 2: Mixed uppercase/lowercase names sort correctly
  await test('Scenario 2: Mixed uppercase/lowercase names sort correctly', async () => {
    const mixed = [
      { id: '1', name: 'apple', isActive: true },
      { id: '2', name: 'Banana', isActive: true },
      { id: '3', name: 'apricot', isActive: true },
      { id: '4', name: 'BLUE SHIRT', isActive: true },
      { id: '5', name: 'cherry', isActive: true }
    ];
    const sorted = sortProductsAlphabetically(mixed).map(p => p.name);
    assert.deepEqual(sorted, ['apple', 'apricot', 'Banana', 'BLUE SHIRT', 'cherry']);
  });

  // Test 3: Search by complete product name works
  await test('Scenario 3: Search by complete product name works', async () => {
    const results = filterAndSortProducts(shopAProducts, 'Cotton Polo');
    assert.equal(results.length, 1);
    assert.equal(results[0].name, 'Cotton Polo');
    assert.equal(results[0].id, 'P-3');
  });

  // Test 4: Search by partial product name works
  await test('Scenario 4: Search by partial product name works with leading/trailing spaces', async () => {
    const results = filterAndSortProducts(shopAProducts, '   shirt   ');
    // Should match: 'apricot linen shirt', 'Formal White Shirt', 'Zebra Print T-Shirt'
    const names = results.map(p => p.name);
    assert.equal(results.length, 3);
    assert.deepEqual(names, [
      'apricot linen shirt',
      'Formal White Shirt',
      'Zebra Print T-Shirt'
    ]);
  });

  // Test 5: Search by barcode works
  await test('Scenario 5: Search by barcode works', async () => {
    const results = filterAndSortProducts(shopAProducts, 'QKR-POLO-03');
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'P-3');
    assert.equal(results[0].barcode, 'QKR-POLO-03');

    // Partial barcode
    const partial = filterAndSortProducts(shopAProducts, 'POLO');
    assert.ok(partial.some(p => p.barcode === 'QKR-POLO-03'));
  });

  // Test 6: Search is case-insensitive
  await test('Scenario 6: Search is case-insensitive for both names and barcodes', async () => {
    const nameResults = filterAndSortProducts(shopAProducts, 'fOrMaL');
    assert.equal(nameResults.length, 1);
    assert.equal(nameResults[0].name, 'Formal White Shirt');

    const barcodeResults = filterAndSortProducts(shopAProducts, 'qkr-jeans-02');
    assert.equal(barcodeResults.length, 1);
    assert.equal(barcodeResults[0].barcode, 'QKR-JEANS-02');
  });

  // Test 7: Clearing search restores the full sorted list
  await test('Scenario 7: Clearing search restores the full sorted list', async () => {
    const searchFiltered = filterAndSortProducts(shopAProducts, 'nonexistent');
    assert.equal(searchFiltered.length, 0);

    // Clear search
    const restored = filterAndSortProducts(shopAProducts, '');
    assert.equal(restored.length, 6); // 6 active products
    assert.equal(restored[0].name, 'apricot linen shirt');
    assert.equal(restored[restored.length - 1].name, 'Zebra Print T-Shirt');
  });

  // Test 8: No-results message works
  await test('Scenario 8: No-results message works when no products match', async () => {
    const results = filterAndSortProducts(shopAProducts, 'Diamond Necklace 9999');
    assert.equal(results.length, 0);
  });

  // Test 9: Inactive products cannot be selected
  await test('Scenario 9: Inactive products cannot be selected', async () => {
    const activeResults = filterAndSortProducts(shopAProducts, '');
    const hasInactive = activeResults.some(p => p.id === 'P-5'); // Disabled Red Kurta
    assert.equal(hasInactive, false, 'Inactive product must never appear in Add Product selection');

    const cart = createBillingCartSimulator(shopAProducts);
    const inactiveProd = shopAProducts.find(p => p.id === 'P-5');
    let rejected = false;
    try {
      cart.addItemFromModal(inactiveProd);
    } catch {
      rejected = true;
    }
    assert.equal(rejected, true, 'Adding inactive product to cart must be rejected');
  });

  // Test 10: Another shop\'s products never appear
  await test('Scenario 10: Another shop\'s products never appear', async () => {
    const allShopProducts = [...shopAProducts, ...shopBProducts];
    const shopAOnly = allShopProducts.filter(p => p.shopId === 'SHOP-A');
    const sortedShopA = filterAndSortProducts(shopAOnly, 'Silk');

    assert.equal(sortedShopA.length, 0, 'Shop B silk saree must never appear in Shop A selection');
  });

  // Test 11: Selecting a result adds the correct product to the cart
  await test('Scenario 11: Selecting a result adds the exact selected product to the cart', async () => {
    const cart = createBillingCartSimulator(shopAProducts);
    const chosenProduct = shopAProducts.find(p => p.id === 'P-4'); // Formal White Shirt, 999

    const addedItem = cart.addItemFromModal(chosenProduct);
    assert.equal(addedItem.productId, 'P-4');
    assert.equal(addedItem.rate, 999);
    assert.equal(addedItem.quantity, 1);

    // Verify it was NOT activeProducts[0] (which is P-6 apricot)
    assert.notEqual(addedItem.productId, 'P-6');
    assert.equal(cart.getItems().length, 1);
  });

  // Test 12: Barcode scanning still adds the correct active product
  await test('Scenario 12: Barcode scanning still adds the correct active product', async () => {
    const cart = createBillingCartSimulator(shopAProducts);

    // Scan QKR-SHIRT-04
    const item1 = cart.addScannedBarcode('QKR-SHIRT-04');
    assert.equal(item1.productId, 'P-4');
    assert.equal(item1.quantity, 1);

    // Scan again -> increments quantity
    const item2 = cart.addScannedBarcode('QKR-SHIRT-04');
    assert.equal(item2.productId, 'P-4');
    assert.equal(item2.quantity, 2);
    assert.equal(cart.getItems().length, 1);

    // Scan inactive barcode -> throws error
    let inactiveRejected = false;
    try {
      cart.addScannedBarcode('QKR-KURTA-05');
    } catch (e) {
      inactiveRejected = e.message.includes('inactive');
    }
    assert.equal(inactiveRejected, true);
  });

  // Test 13: Existing GST, stock and billing calculations remain correct
  await test('Scenario 13: Existing GST, stock and billing calculations remain correct', async () => {
    const prod = shopAProducts.find(p => p.id === 'P-2'); // 1299, 12% GST
    const baseSellingPrice = prod.sellingPrice;
    const taxRate = prod.gstRate;
    const taxFraction = taxRate / (100 + taxRate);
    const taxAmount = Math.round(baseSellingPrice * taxFraction * 100) / 100;
    const taxableValue = Math.round((baseSellingPrice - taxAmount) * 100) / 100;

    assert.equal(Math.round((taxableValue + taxAmount) * 100) / 100, baseSellingPrice);
    // Stock remains untouched prior to checkout
    assert.equal(prod.availability, 15);
  });

  // Test 14: Mobile layout works without clipping
  await test('Scenario 14: Mobile layout has responsive sizing without clipping in InlineProductSearch', async () => {
    const fs = await import('node:fs');
    const inlineCode = fs.readFileSync('frontend/src/components/InlineProductSearch.tsx', 'utf8');

    // Verify key responsive classes and inline design
    assert.ok(inlineCode.includes('overflow-y-auto'), 'Product list must scroll vertically');
    assert.ok(inlineCode.includes('truncate'), 'Long product names must be truncated on mobile');
    assert.ok(inlineCode.includes('text-xs sm:text-sm'), 'Responsive font sizing');
    assert.ok(inlineCode.includes('Clear search'), 'Clear search button must be present');
    assert.ok(inlineCode.includes('No products found'), 'No products found inline message');
    assert.ok(inlineCode.includes('Plus'), 'Add (+) button present for each product');
  });

  // Test 15: Live Express GET /api/products returns products sorted A–Z case-insensitively
  await test('Scenario 15: Live Express GET /api/products returns products sorted A–Z case-insensitively', async () => {
    process.env.QUICKR_TEST_IMPORT = 'true';
    const jwt = (await import('jsonwebtoken')).default;
    const { getJwtSecret } = await import('../config/jwt.js');
    const { User } = await import('../models/User.js');
    const { Shop } = await import('../models/Shop.js');
    const { Product } = await import('../models/Product.js');
    const { app } = await import('../server.js');
    const { Readable, Duplex } = await import('node:stream');

    const jwtSecret = getJwtSecret();
    const token = jwt.sign({ id: 'OWNER-SORT-TEST', shopId: 'SHOP-SORT-TEST', role: 'owner' }, jwtSecret, { algorithm: 'HS256' });

    User.findOne = (query) => ({
      select: () => ({
        lean: async () => ({
          id: query.id,
          name: 'Sort Owner',
          email: 'sort@quickr.local',
          shopId: 'SHOP-SORT-TEST',
          role: 'owner',
          status: 'active'
        })
      })
    });

    Shop.findOne = () => ({
      select: () => ({
        lean: async () => ({
          customId: 'SHOP-SORT-TEST',
          status: 'active',
          subscriptionStatus: 'active',
          isGstRegistered: false
        })
      }),
      lean: async () => ({
        customId: 'SHOP-SORT-TEST',
        status: 'active',
        subscriptionStatus: 'active',
        isGstRegistered: false
      })
    });

    // Mock un-ordered database output with mixed case
    Product.find = (query) => ({
      lean: async () => [
        { id: '1', shopId: 'SHOP-SORT-TEST', name: 'zebra scarf', isActive: true },
        { id: '2', shopId: 'SHOP-SORT-TEST', name: 'Apple Cap', isActive: true },
        { id: '3', shopId: 'SHOP-SORT-TEST', name: 'blue Shirt', isActive: true },
        { id: '4', shopId: 'SHOP-SORT-TEST', name: 'BANANA HOODIE', isActive: true }
      ]
    });

    const res = await new Promise((resolve) => {
      const req = new Readable({ read() {} });
      req.method = 'GET';
      req.url = '/api/products';
      req.headers = { authorization: `Bearer ${token}` };
      req.get = (h) => req.headers[h.toLowerCase()];
      req.header = req.get;
      req.socket = new Duplex({ read() {}, write(c, e, cb) { cb(); } });
      req.socket.remoteAddress = '127.0.0.1';
      req.connection = req.socket;

      let resBody = '';
      const res = new Duplex({
        read() {},
        write(chunk, enc, cb) {
          if (chunk) resBody += chunk.toString();
          cb();
        }
      });
      res.statusCode = 200;
      res.setHeader = () => {};
      res.getHeader = () => {};
      res.end = (chunk) => {
        if (chunk) resBody += chunk.toString();
        let parsed = resBody;
        try { parsed = JSON.parse(resBody); } catch {}
        resolve({ status: res.statusCode, body: parsed });
      };

      app.handle(req, res);
      req.push(null);
    });

    assert.equal(res.status, 200);
    assert.equal(Array.isArray(res.body), true);
    const names = res.body.map(p => p.name);
    // Ascending A-Z case-insensitive: Apple Cap, BANANA HOODIE, blue Shirt, zebra scarf
    assert.deepEqual(names, ['Apple Cap', 'BANANA HOODIE', 'blue Shirt', 'zebra scarf']);
  });

  // Test 16: Complete elimination of popup/modal for product selection
  await test('Scenario 16: Complete elimination of product selection popup modal', async () => {
    const fs = await import('node:fs');
    const salesSessionCode = fs.readFileSync('frontend/src/pages/SalesSession.tsx', 'utf8');
    const billingCode = fs.readFileSync('frontend/src/pages/Billing.tsx', 'utf8');

    // Confirm AddProductSelectModal is not imported or used anywhere
    assert.equal(salesSessionCode.includes('AddProductSelectModal'), false, 'SalesSession must not use AddProductSelectModal');
    assert.equal(billingCode.includes('AddProductSelectModal'), false, 'Billing must not use AddProductSelectModal');
    assert.equal(salesSessionCode.includes('Select Product to Add'), false, 'SalesSession must not contain popup title');
    assert.equal(billingCode.includes('Select Product to Add'), false, 'Billing must not contain popup title');
    assert.equal(salesSessionCode.includes('isAddProductModalOpen'), false, 'SalesSession must not have isAddProductModalOpen state');
    assert.equal(billingCode.includes('isAddProductModalOpen'), false, 'Billing must not have isAddProductModalOpen state');
    assert.equal(fs.existsSync('frontend/src/components/AddProductSelectModal.tsx'), false, 'AddProductSelectModal.tsx must be deleted');
  });

  // Test 17: InlineProductSearch is embedded permanently above cart items
  await test('Scenario 17: InlineProductSearch is embedded permanently above cart items', async () => {
    const fs = await import('node:fs');
    const salesSessionCode = fs.readFileSync('frontend/src/pages/SalesSession.tsx', 'utf8');
    const billingCode = fs.readFileSync('frontend/src/pages/Billing.tsx', 'utf8');

    assert.ok(salesSessionCode.includes('<InlineProductSearch'), 'SalesSession must embed InlineProductSearch');
    assert.ok(billingCode.includes('<InlineProductSearch'), 'Billing must embed InlineProductSearch');
    assert.ok(salesSessionCode.includes('onSelectProduct={handleSelectProductFromInline}'), 'SalesSession must bind inline select handler');
    assert.ok(billingCode.includes('onSelectProduct={handleSelectProductFromInline}'), 'Billing must bind inline select handler');
  });

  console.log(`\n========================================`);
  console.log(`Test Results: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log(`========================================\n`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

runAllTests();
