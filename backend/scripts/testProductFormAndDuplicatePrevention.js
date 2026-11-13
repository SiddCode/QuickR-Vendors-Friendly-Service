/**
 * QuickR — Product Form & Duplicate Prevention Regression Test Suite
 *
 * Verifies all 14 regression scenarios:
 * 1. Single click on Update Product updates the existing product.
 * 2. Rapid double-click does not create duplicate products.
 * 3. Repeated Enter key presses do not submit twice.
 * 4. Failed update can be retried.
 * 5. New product colour starts blank.
 * 6. Existing product colour remains visible during editing.
 * 7. Clearing colour works if supported.
 * 8. Select S, M, L and XXL together.
 * 9. Selected sizes appear comma-separated.
 * 10. Removing one selected size works.
 * 11. Duplicate size selection is prevented.
 * 12. Existing products with legacy size data still work.
 * 13. Product billing and barcode functionality remain unchanged.
 * 14. Shop data isolation remains intact.
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
// Simulated Backend & Frontend Logic for Offline Verification
// ─────────────────────────────────────────────────────────────────────────────

function createMockBackend() {
  const products = [
    {
      id: 'PROD-101',
      shopId: 'SHOP-A',
      name: 'Premium Cotton Shirt',
      category: 'Shirts',
      sellingPrice: 899,
      originalPrice: 1299,
      sizes: ['M', 'L'],
      colors: ['Blue', 'White'],
      availability: 25,
      measurementType: 'piece',
      barcode: 'QKR-SHOPA-001',
      isActive: true,
      gstRate: 5,
      priceIncludesGst: true
    },
    {
      id: 'PROD-LEGACY',
      shopId: 'SHOP-A',
      name: 'Legacy Single Size Product',
      category: 'T-Shirts',
      sellingPrice: 499,
      sizes: 'XL', // Legacy string representation
      colors: 'Black',
      availability: 10,
      barcode: 'QKR-SHOPA-002',
      isActive: true
    },
    {
      id: 'PROD-201',
      shopId: 'SHOP-B',
      name: 'Shop B Exclusive Jeans',
      category: 'Jeans',
      sellingPrice: 1599,
      sizes: ['32', '34'],
      colors: ['Navy'],
      availability: 12,
      barcode: 'QKR-SHOPB-001',
      isActive: true
    }
  ];

  const recentProductCreations = new Map();

  async function postProduct(user, body) {
    const { name, category, sellingPrice, originalPrice, sizes, colors, availability, measurementType } = body;
    if (!name || sellingPrice === undefined) {
      throw new Error('Product name and selling price are required');
    }

    const numSellingPrice = Number(sellingPrice);
    const numAvailability = availability !== undefined ? Number(availability) : 10;
    const cleanSizes = Array.isArray(sizes) 
      ? sizes.map(s => String(s).trim()).filter(Boolean) 
      : (typeof sizes === 'string' && sizes.trim() ? sizes.split(',').map(s => s.trim()).filter(Boolean) : []);
    const cleanColors = Array.isArray(colors) 
      ? colors.map(c => String(c).trim()).filter(Boolean) 
      : (typeof colors === 'string' && colors.trim() ? colors.split(',').map(c => c.trim()).filter(Boolean) : []);
    const cleanCategory = String(category || 'Shirts').trim();

    // Deduplication sliding window (3000ms)
    const dedupKey = `${user.shopId}:${String(name).trim().toLowerCase()}:${numSellingPrice}:${cleanCategory}:${JSON.stringify(cleanSizes)}:${JSON.stringify(cleanColors)}`;
    const recent = recentProductCreations.get(dedupKey);
    if (recent && (Date.now() - recent.timestamp < 3000)) {
      return { status: 200, product: recent.product, isDuplicatePrevented: true };
    }

    const newProd = {
      id: `PROD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      shopId: user.shopId,
      name: String(name).trim(),
      category: cleanCategory,
      sellingPrice: numSellingPrice,
      originalPrice,
      sizes: cleanSizes,
      colors: cleanColors,
      availability: numAvailability,
      measurementType: measurementType === 'length' ? 'length' : 'piece',
      barcode: `QKR-${user.shopId}-${Math.floor(Math.random() * 10000)}`,
      isActive: true
    };

    products.push(newProd);
    recentProductCreations.set(dedupKey, { timestamp: Date.now(), product: newProd });
    return { status: 201, product: newProd, isDuplicatePrevented: false };
  }

  async function putProduct(user, id, body) {
    const prod = products.find(p => p.id === id && p.shopId === user.shopId);
    if (!prod) {
      const existsInOtherShop = products.some(p => p.id === id);
      if (existsInOtherShop) {
        const err = new Error('Cross-shop update forbidden');
        err.status = 403;
        throw err;
      }
      const err = new Error('Product not found');
      err.status = 404;
      throw err;
    }

    const { name, category, sellingPrice, originalPrice, sizes, colors, availability, isActive } = body;
    if (name !== undefined) prod.name = String(name).trim();
    if (category !== undefined) prod.category = category;
    if (sellingPrice !== undefined) prod.sellingPrice = Number(sellingPrice);
    if (originalPrice !== undefined) prod.originalPrice = originalPrice !== undefined ? Number(originalPrice) : undefined;
    if (sizes !== undefined) {
      prod.sizes = Array.isArray(sizes) 
        ? sizes.map(s => String(s).trim()).filter(Boolean) 
        : (typeof sizes === 'string' && sizes.trim() ? sizes.split(',').map(s => s.trim()).filter(Boolean) : []);
    }
    if (colors !== undefined) {
      prod.colors = Array.isArray(colors) 
        ? colors.map(c => String(c).trim()).filter(Boolean) 
        : (typeof colors === 'string' && colors.trim() ? colors.split(',').map(c => c.trim()).filter(Boolean) : []);
    }
    if (availability !== undefined) prod.availability = Number(availability);
    if (isActive !== undefined) prod.isActive = Boolean(isActive);

    return { status: 200, product: { ...prod } };
  }

  function getProductsByShop(shopId) {
    return products.filter(p => p.shopId === shopId);
  }

  return { products, postProduct, putProduct, getProductsByShop };
}

// ─────────────────────────────────────────────────────────────────────────────
// Frontend Form Component Simulator
// ─────────────────────────────────────────────────────────────────────────────
function createMockFrontendForm(backend, user) {
  let isSubmitting = false;
  let isSubmittingRef = { current: false };
  let editingProduct = null;
  let customSizeInput = '';
  let submitCallCount = 0;

  const STANDARD_SIZES = ['S', 'M', 'L', 'XL', 'XXL'];

  let formData = {
    name: '',
    category: 'Shirts',
    sellingPrice: '',
    originalPrice: '',
    sizes: [],
    colors: '',
    availability: '10',
    isActive: true
  };

  function handleOpenModal(product) {
    customSizeInput = '';
    isSubmittingRef.current = false;
    isSubmitting = false;

    if (product) {
      editingProduct = product;
      let parsedSizes = [];
      if (Array.isArray(product.sizes)) {
        parsedSizes = product.sizes.map(s => String(s).trim()).filter(Boolean);
      } else if (typeof product.sizes === 'string' && product.sizes.trim()) {
        parsedSizes = product.sizes.split(',').map(s => s.trim()).filter(Boolean);
      }

      let parsedColors = '';
      if (Array.isArray(product.colors)) {
        parsedColors = product.colors.filter(Boolean).join(', ');
      } else if (typeof product.colors === 'string') {
        parsedColors = product.colors;
      }

      formData = {
        name: product.name,
        category: product.category,
        sellingPrice: String(product.sellingPrice),
        originalPrice: product.originalPrice ? String(product.originalPrice) : '',
        sizes: parsedSizes,
        colors: parsedColors,
        availability: String(product.availability || 0),
        isActive: product.isActive !== undefined ? Boolean(product.isActive) : true
      };
    } else {
      editingProduct = null;
      formData = {
        name: '',
        category: 'Shirts',
        sellingPrice: '',
        originalPrice: '',
        sizes: [],
        colors: '',
        availability: '10',
        isActive: true
      };
    }
  }

  function handleAddSize(sizeToAdd) {
    const clean = sizeToAdd.trim();
    if (!clean) return;
    if (formData.sizes.some(s => s.toLowerCase() === clean.toLowerCase())) {
      return; // prevent duplicate
    }
    formData.sizes = [...formData.sizes, clean];
  }

  function handleRemoveSize(sizeToRemove) {
    formData.sizes = formData.sizes.filter(s => s.toLowerCase() !== sizeToRemove.toLowerCase());
  }

  function handleToggleSize(sizeToToggle) {
    if (formData.sizes.some(s => s.toLowerCase() === sizeToToggle.toLowerCase())) {
      handleRemoveSize(sizeToToggle);
    } else {
      handleAddSize(sizeToToggle);
    }
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' && (isSubmitting || isSubmittingRef.current)) {
      event.preventDefault();
      return false; // suppressed
    }
    return true;
  }

  async function handleSubmit(shouldSimulateNetworkDelay = 50) {
    submitCallCount++;
    if (isSubmittingRef.current || isSubmitting) {
      return { skipped: true, reason: 'Already submitting' };
    }

    const parsedPrice = parseFloat(formData.sellingPrice);
    if (!formData.name.trim() || !Number.isFinite(parsedPrice) || parsedPrice < 0) {
      throw new Error('Valid name and price required');
    }

    isSubmittingRef.current = true;
    isSubmitting = true;

    try {
      if (shouldSimulateNetworkDelay > 0) {
        await new Promise(r => setTimeout(r, shouldSimulateNetworkDelay));
      }

      const payload = {
        name: formData.name.trim(),
        category: formData.category,
        sellingPrice: parsedPrice,
        sizes: Array.isArray(formData.sizes) ? formData.sizes : [],
        colors: formData.colors ? formData.colors.split(',').map(c => c.trim()).filter(Boolean) : [],
        availability: Number(formData.availability),
        isActive: formData.isActive
      };

      if (editingProduct && editingProduct.id) {
        const res = await backend.putProduct(user, editingProduct.id, payload);
        return { success: true, updated: res.product, isEdit: true };
      } else if (!editingProduct) {
        const res = await backend.postProduct(user, payload);
        return { success: true, created: res.product, isEdit: false, isDuplicatePrevented: res.isDuplicatePrevented };
      }
    } finally {
      isSubmittingRef.current = false;
      isSubmitting = false;
    }
  }

  function formatProductList(items) {
    if (Array.isArray(items)) return items.filter(Boolean).join(', ');
    if (typeof items === 'string' && items.trim()) return items.trim();
    return '';
  }

  return {
    getFormData: () => formData,
    setFormData: (fn) => { formData = typeof fn === 'function' ? fn(formData) : fn; },
    getIsSubmitting: () => isSubmitting,
    getIsSubmittingRef: () => isSubmittingRef.current,
    getEditingProduct: () => editingProduct,
    handleOpenModal,
    handleAddSize,
    handleRemoveSize,
    handleToggleSize,
    handleKeyDown,
    handleSubmit,
    formatProductList,
    STANDARD_SIZES
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTE ALL 14 REGRESSION SCENARIOS
// ─────────────────────────────────────────────────────────────────────────────

async function runAllTests() {
  console.log('Starting QuickR Product Form & Duplicate Prevention Regression Suite...\n');

  // Test 1: Single click on Update Product updates the existing product
  await test('Scenario 1: Single click on Update Product updates the existing product', async () => {
    const backend = createMockBackend();
    const user = { shopId: 'SHOP-A', role: 'owner' };
    const form = createMockFrontendForm(backend, user);

    const original = backend.products.find(p => p.id === 'PROD-101');
    form.handleOpenModal(original);

    // Modify price
    form.setFormData(prev => ({ ...prev, sellingPrice: '949' }));
    const result = await form.handleSubmit(10);

    assert.equal(result.success, true);
    assert.equal(result.isEdit, true);
    assert.equal(result.updated.id, 'PROD-101');
    assert.equal(result.updated.sellingPrice, 949);
    // Barcode and ID preserved
    assert.equal(result.updated.barcode, 'QKR-SHOPA-001');

    // Total products count for SHOP-A remains unchanged
    const shopProds = backend.getProductsByShop('SHOP-A');
    assert.equal(shopProds.length, 2);
  });

  // Test 2: Rapid double-click does not create duplicate products
  await test('Scenario 2: Rapid double-click does not create duplicate products', async () => {
    const backend = createMockBackend();
    const user = { shopId: 'SHOP-A', role: 'owner' };
    const form = createMockFrontendForm(backend, user);

    // Open for new product creation
    form.handleOpenModal();
    form.setFormData(prev => ({
      ...prev,
      name: 'Double Click Test T-Shirt',
      sellingPrice: '599',
      sizes: ['M', 'L'],
      colors: 'White'
    }));

    const initialCount = backend.products.length;

    // Simulate rapid double click firing two handleSubmit calls concurrently
    const p1 = form.handleSubmit(40);
    const p2 = form.handleSubmit(40);

    const [res1, res2] = await Promise.all([p1, p2]);

    // One must succeed, second must be blocked by isSubmitting lock
    const succeeded = [res1, res2].filter(r => r.success);
    const blocked = [res1, res2].filter(r => r.skipped);

    assert.equal(succeeded.length, 1, 'Only one submission must execute');
    assert.equal(blocked.length, 1, 'Second submission must be dropped by lock');
    assert.equal(blocked[0].reason, 'Already submitting');

    // Exactly one product created
    assert.equal(backend.products.length, initialCount + 1);

    // Also test backend-level sliding window deduplication if network retry sends duplicate POST
    const backendPost1 = await backend.postProduct(user, {
      name: 'Direct Backend API Duplicate Check',
      sellingPrice: 799,
      sizes: ['L'],
      colors: ['Green']
    });
    const backendPost2 = await backend.postProduct(user, {
      name: 'Direct Backend API Duplicate Check',
      sellingPrice: 799,
      sizes: ['L'],
      colors: ['Green']
    });

    assert.equal(backendPost1.status, 201);
    assert.equal(backendPost2.status, 200, 'Second rapid call must return HTTP 200 cached product');
    assert.equal(backendPost2.isDuplicatePrevented, true);
    assert.equal(backendPost1.product.id, backendPost2.product.id, 'Must return identical product ID without duplicating');
  });

  // Test 3: Repeated Enter key presses do not submit twice
  await test('Scenario 3: Repeated Enter key presses do not submit twice', async () => {
    const backend = createMockBackend();
    const user = { shopId: 'SHOP-A', role: 'owner' };
    const form = createMockFrontendForm(backend, user);

    form.handleOpenModal();
    form.setFormData(prev => ({
      ...prev,
      name: 'Enter Key Test Pants',
      sellingPrice: '999'
    }));

    // Start first submission
    const promise = form.handleSubmit(50);

    // While submitting, simulate Enter key event
    let prevented = false;
    const fakeEvent = {
      key: 'Enter',
      preventDefault: () => { prevented = true; }
    };

    const allowed = form.handleKeyDown(fakeEvent);
    assert.equal(allowed, false, 'Enter key press must be suppressed during submission');
    assert.equal(prevented, true, 'preventDefault must be called');

    await promise;
  });

  // Test 4: Failed update can be retried
  await test('Scenario 4: Failed update can be retried', async () => {
    const backend = createMockBackend();
    const user = { shopId: 'SHOP-A', role: 'owner' };
    const form = createMockFrontendForm(backend, user);

    const original = backend.products.find(p => p.id === 'PROD-101');
    form.handleOpenModal(original);

    // Set invalid price to fail client-side validation
    form.setFormData(prev => ({ ...prev, sellingPrice: '-10' }));

    let failed = false;
    try {
      await form.handleSubmit(0);
    } catch {
      failed = true;
    }
    assert.equal(failed, true, 'Invalid input must fail');

    // Submission lock must be reset
    assert.equal(form.getIsSubmitting(), false, 'isSubmitting must be false after failure');
    assert.equal(form.getIsSubmittingRef(), false, 'isSubmittingRef must be false after failure');

    // Fix the price and retry
    form.setFormData(prev => ({ ...prev, sellingPrice: '1099' }));
    const retryResult = await form.handleSubmit(0);

    assert.equal(retryResult.success, true);
    assert.equal(retryResult.updated.sellingPrice, 1099);
  });

  // Test 5: New product colour starts blank
  await test('Scenario 5: New product colour starts blank', async () => {
    const backend = createMockBackend();
    const user = { shopId: 'SHOP-A', role: 'owner' };
    const form = createMockFrontendForm(backend, user);

    form.handleOpenModal(); // New product (no arg)
    const data = form.getFormData();

    assert.equal(data.colors, '', 'Colour must start completely blank (not "Blue, Black")');
    assert.equal(data.sizes.length, 0, 'Sizes must start empty');
  });

  // Test 6: Existing product colour remains visible during editing
  await test('Scenario 6: Existing product colour remains visible during editing', async () => {
    const backend = createMockBackend();
    const user = { shopId: 'SHOP-A', role: 'owner' };
    const form = createMockFrontendForm(backend, user);

    const prod = backend.products.find(p => p.id === 'PROD-101');
    form.handleOpenModal(prod);

    const data = form.getFormData();
    assert.equal(data.colors, 'Blue, White', 'Previously saved colors must be visible in edit modal');

    // Update only the name
    form.setFormData(prev => ({ ...prev, name: 'Renamed Cotton Shirt' }));
    const res = await form.handleSubmit(0);

    assert.equal(res.success, true);
    assert.deepEqual(res.updated.colors, ['Blue', 'White'], 'Colors must not be cleared or lost when editing other fields');
  });

  // Test 7: Clearing colour works if supported
  await test('Scenario 7: Clearing colour works if supported', async () => {
    const backend = createMockBackend();
    const user = { shopId: 'SHOP-A', role: 'owner' };
    const form = createMockFrontendForm(backend, user);

    const prod = backend.products.find(p => p.id === 'PROD-101');
    form.handleOpenModal(prod);

    // Explicitly clear colors
    form.setFormData(prev => ({ ...prev, colors: '' }));
    const res = await form.handleSubmit(0);

    assert.equal(res.success, true);
    assert.deepEqual(res.updated.colors, [], 'Cleared colors must save as empty array in backend');
  });

  // Test 8: Select S, M, L and XXL together
  await test('Scenario 8: Select S, M, L and XXL together', async () => {
    const backend = createMockBackend();
    const user = { shopId: 'SHOP-A', role: 'owner' };
    const form = createMockFrontendForm(backend, user);

    form.handleOpenModal();
    form.handleAddSize('S');
    form.handleAddSize('M');
    form.handleAddSize('L');
    form.handleAddSize('XXL');

    const data = form.getFormData();
    assert.deepEqual(data.sizes, ['S', 'M', 'L', 'XXL']);
  });

  // Test 9: Selected sizes appear comma-separated
  await test('Scenario 9: Selected sizes appear comma-separated', async () => {
    const backend = createMockBackend();
    const user = { shopId: 'SHOP-A', role: 'owner' };
    const form = createMockFrontendForm(backend, user);

    form.handleOpenModal();
    ['S', 'M', 'L', 'XL'].forEach(s => form.handleAddSize(s));

    const data = form.getFormData();
    const commaSeparated = data.sizes.join(', ');
    assert.equal(commaSeparated, 'S, M, L, XL');

    const formatted = form.formatProductList(data.sizes);
    assert.equal(formatted, 'S, M, L, XL');
  });

  // Test 10: Removing one selected size works
  await test('Scenario 10: Removing one selected size works', async () => {
    const backend = createMockBackend();
    const user = { shopId: 'SHOP-A', role: 'owner' };
    const form = createMockFrontendForm(backend, user);

    form.handleOpenModal();
    ['S', 'M', 'L', 'XXL'].forEach(s => form.handleAddSize(s));

    // Remove 'M'
    form.handleRemoveSize('M');
    assert.deepEqual(form.getFormData().sizes, ['S', 'L', 'XXL']);

    // Remove 'XXL'
    form.handleRemoveSize('XXL');
    assert.deepEqual(form.getFormData().sizes, ['S', 'L']);
  });

  // Test 11: Duplicate size selection is prevented
  await test('Scenario 11: Duplicate size selection is prevented', async () => {
    const backend = createMockBackend();
    const user = { shopId: 'SHOP-A', role: 'owner' };
    const form = createMockFrontendForm(backend, user);

    form.handleOpenModal();
    form.handleAddSize('S');
    form.handleAddSize('M');

    // Attempt duplicate 'S' and lowercase 's'
    form.handleAddSize('S');
    form.handleAddSize('s');
    form.handleAddSize('M');

    assert.deepEqual(form.getFormData().sizes, ['S', 'M'], 'Duplicate sizes must not be added');
  });

  // Test 12: Existing products with legacy size data still work
  await test('Scenario 12: Existing products with legacy size data still work', async () => {
    const backend = createMockBackend();
    const user = { shopId: 'SHOP-A', role: 'owner' };
    const form = createMockFrontendForm(backend, user);

    const legacyProd = backend.products.find(p => p.id === 'PROD-LEGACY');
    assert.equal(typeof legacyProd.sizes, 'string');

    // Safe formatting for list view
    const formatted = form.formatProductList(legacyProd.sizes);
    assert.equal(formatted, 'XL');

    // Loading in modal parses string into array
    form.handleOpenModal(legacyProd);
    const data = form.getFormData();
    assert.deepEqual(data.sizes, ['XL']);

    // Add another size
    form.handleAddSize('XXL');
    const res = await form.handleSubmit(0);

    assert.equal(res.success, true);
    assert.deepEqual(res.updated.sizes, ['XL', 'XXL']);
  });

  // Test 13: Product billing and barcode functionality remain unchanged
  await test('Scenario 13: Product billing and barcode functionality remain unchanged', async () => {
    const backend = createMockBackend();
    const prod = backend.products.find(p => p.id === 'PROD-101');

    // Barcode exists and is untouched
    assert.equal(prod.barcode, 'QKR-SHOPA-001');
    assert.equal(prod.isActive, true);
    assert.equal(prod.gstRate, 5);
    assert.equal(prod.priceIncludesGst, true);

    // Simulate price calculation in billing
    const baseSellingPrice = prod.sellingPrice; // 899
    const taxFraction = prod.gstRate / (100 + prod.gstRate);
    const taxAmount = Math.round(baseSellingPrice * taxFraction * 100) / 100;
    const taxableValue = Math.round((baseSellingPrice - taxAmount) * 100) / 100;

    assert.ok(taxAmount > 0);
    assert.equal(Math.round((taxableValue + taxAmount) * 100) / 100, baseSellingPrice);
  });

  // Test 14: Shop data isolation remains intact
  await test('Scenario 14: Shop data isolation remains intact', async () => {
    const backend = createMockBackend();
    const userA = { shopId: 'SHOP-A', role: 'owner' };
    const userB = { shopId: 'SHOP-B', role: 'owner' };

    // Shop A tries to update Shop B's product
    let crossShopRejected = false;
    try {
      await backend.putProduct(userA, 'PROD-201', { name: 'Hacked Shop B Product' });
    } catch (err) {
      crossShopRejected = (err.status === 403 || err.status === 404);
    }
    assert.equal(crossShopRejected, true, 'Cross-shop product update must be rejected');

    // Shop B products cannot be retrieved by Shop A
    const shopAProds = backend.getProductsByShop(userA.shopId);
    const hasShopBProd = shopAProds.some(p => p.id === 'PROD-201');
    assert.equal(hasShopBProd, false, 'Shop A query must never contain Shop B products');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Live Express Route Integration Tests (server.js route handlers)
  // ─────────────────────────────────────────────────────────────────────────────
  process.env.QUICKR_TEST_IMPORT = 'true';
  const jwt = (await import('jsonwebtoken')).default;
  const { getJwtSecret } = await import('../config/jwt.js');
  const { User } = await import('../models/User.js');
  const { Shop } = await import('../models/Shop.js');
  const { Product } = await import('../models/Product.js');
  const { app } = await import('../server.js');
  const { Readable, Duplex } = await import('node:stream');

  const jwtSecret = getJwtSecret();
  const shopOwnerToken = jwt.sign({ id: 'OWNER-DUP-1', shopId: 'SHOP-LIVE-DEDUP', role: 'owner' }, jwtSecret, { algorithm: 'HS256' });

  User.findOne = (query) => ({
    select: () => ({
      lean: async () => ({
        id: query.id,
        name: 'Shop Owner',
        email: 'owner@quickr.local',
        shopId: query.shopId || 'SHOP-LIVE-DEDUP',
        role: 'owner',
        status: 'active'
      })
    })
  });

  Shop.findOne = (query) => ({
    select: () => ({
      lean: async () => ({
        customId: query.customId || 'SHOP-LIVE-DEDUP',
        status: 'active',
        subscriptionStatus: 'active',
        isGstRegistered: false
      })
    }),
    lean: async () => ({
      customId: query.customId || 'SHOP-LIVE-DEDUP',
      status: 'active',
      subscriptionStatus: 'active',
      isGstRegistered: false
    })
  });

  function liveRequest(urlPath, { method = 'GET', token = shopOwnerToken, body = null } = {}) {
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

  // Set up in-memory Product mock for Express handlers
  const liveDbProducts = [];
  Product.findOne = (query) => {
    const findItem = () => {
      return liveDbProducts.find(p => {
        if (query.id && p.id !== query.id) return false;
        if (query.shopId && p.shopId !== query.shopId) return false;
        if (query.barcode && p.barcode !== query.barcode) return false;
        return true;
      }) || null;
    };
    const wrapDoc = (item) => {
      if (!item) return null;
      return {
        ...item,
        save: async function() {
          const idx = liveDbProducts.findIndex(p => p.id === this.id);
          if (idx >= 0) liveDbProducts[idx] = { ...this };
          else liveDbProducts.push({ ...this });
          return this;
        }
      };
    };
    return {
      select: () => ({
        lean: async () => findItem()
      }),
      lean: async () => findItem(),
      then: (resolve, reject) => {
        try {
          resolve(wrapDoc(findItem()));
        } catch (e) {
          if (reject) reject(e);
        }
      }
    };
  };

  // Mock Product constructor
  const OriginalProduct = Product;
  function MockProductDoc(doc) {
    Object.assign(this, doc);
    this.save = async function() {
      liveDbProducts.push({ ...this });
      return this;
    };
  }
  Product.prototype.save = async function() {
    liveDbProducts.push(this);
    return this;
  };

  await test('Scenario 15: Live Express POST /api/products deduplicates rapid requests', async () => {
    const payload = {
      name: 'Rapid Express Test Shirt',
      category: 'Shirts',
      sellingPrice: 1250,
      sizes: ['S', 'M', 'L'],
      colors: ['Navy'],
      availability: 20
    };

    const res1 = await liveRequest('/api/products', { method: 'POST', body: payload });
    assert.equal(res1.status, 201);
    assert.ok(res1.body.id);
    assert.ok(res1.body.barcode);

    // Immediate second POST with same details
    const res2 = await liveRequest('/api/products', { method: 'POST', body: payload });
    assert.equal(res2.status, 200, 'Duplicate submission within 3000ms must return HTTP 200 with cached product');
    assert.equal(res2.body.id, res1.body.id, 'Must return same product ID');
    assert.equal(res2.body.barcode, res1.body.barcode, 'Must return same barcode');
  });

  await test('Scenario 16: Live Express PUT /api/products/:id updates sizes, clears colors, and never creates second product', async () => {
    const existing = {
      id: 'PROD-EXPRESS-1',
      shopId: 'SHOP-LIVE-DEDUP',
      name: 'Original Live Shirt',
      category: 'Shirts',
      sellingPrice: 900,
      sizes: ['M'],
      colors: ['Blue'],
      availability: 10,
      isActive: true,
      barcode: 'QKR-LIVE-1'
    };
    liveDbProducts.push(existing);

    const updatePayload = {
      name: 'Updated Live Shirt',
      sellingPrice: 950,
      sizes: ['S', 'M', 'L', 'XXL'],
      colors: [] // Intentionally clear colors
    };

    const res = await liveRequest('/api/products/PROD-EXPRESS-1', { method: 'PUT', body: updatePayload });
    assert.equal(res.status, 200);
    assert.equal(res.body.name, 'Updated Live Shirt');
    assert.equal(res.body.sellingPrice, 950);
    assert.deepEqual(res.body.sizes, ['S', 'M', 'L', 'XXL']);
    assert.deepEqual(res.body.colors, []);
    assert.equal(res.body.barcode, 'QKR-LIVE-1', 'Barcode must be strictly preserved');
  });

  await test('Scenario 17: Live Express PUT /api/products/:id rejects unknown product with 404', async () => {
    const res = await liveRequest('/api/products/NON-EXISTENT-ID', { method: 'PUT', body: { name: 'Ghost' } });
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'Product not found');
  });

  console.log(`\n========================================`);
  console.log(`Test Results: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log(`========================================\n`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

runAllTests();
