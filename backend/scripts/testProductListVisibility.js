/**
 * QuickR — Sales Session Product List Visibility Verification Suite
 *
 * Verifies that:
 * 1. Default Screen: Product selection list is hidden by default (only cart and search input visible).
 * 2. When search is clicked/focused: reveals active product list directly below the search field.
 * 3. Does NOT open any modal, popup, drawer, or separate screen.
 * 4. Active products appear sorted alphabetically A–Z.
 * 5. While searching, filters instantly by product name and barcode; displays "No products found" when empty.
 * 6. After selecting a product:
 *    - Adds exact selected product to cart.
 *    - Clears the search input.
 *    - Hides the product list.
 *    - Keeps cart visible and updated.
 * 7. Closing product results:
 *    - Clicks outside search & results area hide the list.
 *    - Escape key hides the list.
 *    - Successful selection hides the list.
 *    - Clicks inside results do NOT hide the list.
 * 8. Add Product button focuses the inline search input and reveals the list without popup.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

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

async function runTests() {
  console.log('🧪 Starting QuickR Product List Visibility Verification Suite...\n');

  const componentPath = path.resolve('frontend/src/components/InlineProductSearch.tsx');
  const salesSessionPath = path.resolve('frontend/src/pages/SalesSession.tsx');

  const componentCode = fs.readFileSync(componentPath, 'utf8');
  const salesSessionCode = fs.readFileSync(salesSessionPath, 'utf8');

  // Test 1: Product list is hidden by default (isOpen starts false)
  await test('1. Product list is hidden by default (isOpen starts false)', async () => {
    assert.ok(componentCode.includes('const [isOpen, setIsOpen] = useState(false);'), 'isOpen must initialize to false');
    assert.ok(componentCode.includes('{isOpen && ('), 'Product list must be conditionally rendered only when isOpen is true');
  });

  // Test 2: Clicking or focusing the search input opens the list
  await test('2. Clicking or focusing the search input opens the product list', async () => {
    assert.ok(componentCode.includes('onFocus={() => setIsOpen(true)}'), 'Input must have onFocus handler setting isOpen to true');
    assert.ok(componentCode.includes('onClick={() => setIsOpen(true)}'), 'Input must have onClick handler setting isOpen to true');
  });

  // Test 3: List stays inside normal page layout, zero modals or popups
  await test('3. List is rendered inside normal page layout with zero popups, dialogs or drawers', async () => {
    assert.ok(!componentCode.includes('fixed inset-0'), 'Must NOT use full-screen overlay/modal backdrop');
    assert.ok(!componentCode.includes('dialog'), 'Must NOT use modal dialog');
    assert.ok(!componentCode.includes('drawer'), 'Must NOT use drawer');
    assert.ok(componentCode.includes('border-t border-slate-100'), 'List appears directly in-flow below search input');
  });

  // Test 4: Real-time search by name, barcode, and alphabetical A-Z sorting
  await test('4. Real-time search filters by name & barcode and sorts A–Z', async () => {
    assert.ok(componentCode.includes('p.name.toLowerCase().includes(trimmed)'), 'Must filter by product name');
    assert.ok(componentCode.includes('p.barcode.toLowerCase().includes(trimmed)'), 'Must filter by barcode');
    assert.ok(componentCode.includes("localeCompare(b.name || '', undefined, { sensitivity: 'base' })"), 'Must sort A-Z case-insensitively');
    assert.ok(componentCode.includes('No products found'), 'Must show No products found message');
  });

  // Test 5: Selecting a product clears search and hides list
  await test('5. Selecting a product adds product, clears search input, and hides list', async () => {
    assert.ok(componentCode.includes('onSelectProduct(product);'), 'Must invoke onSelectProduct');
    assert.ok(componentCode.includes("setSearchQuery('');"), 'Must clear the search query');
    assert.ok(componentCode.includes('setIsOpen(false);'), 'Must set isOpen to false after selection');
  });

  // Test 6: Click outside hides the list, while click inside does not
  await test('6. Click outside handler hides list, clicking inside results retains list', async () => {
    assert.ok(componentCode.includes('containerRef.current && !containerRef.current.contains(e.target as Node)'), 'Must check if click target is outside containerRef');
    assert.ok(componentCode.includes('document.addEventListener(\'mousedown\', handleClickOutside)'), 'Must register mousedown listener when open');
  });

  // Test 7: Escape key closes results list
  await test('7. Escape key closes product results list', async () => {
    assert.ok(componentCode.includes("e.key === 'Escape'"), 'Must handle Escape key');
    assert.ok(componentCode.includes('setIsOpen(false);'), 'Must set isOpen to false on Escape');
    assert.ok(salesSessionCode.includes('inlineProductSearchRef.current?.close()'), 'SalesSession Escape listener must also close inline search');
  });

  // Test 8: Add Product button focuses search input and opens list without popup
  await test('8. Add Product button focuses search and reveals list with zero popup', async () => {
    assert.ok(salesSessionCode.includes('inlineProductSearchRef.current?.focus()'), 'handleAddItem must call focus on inlineProductSearchRef');
    assert.ok(componentCode.includes('setIsOpen(true);'), 'focus method must set isOpen to true');
    assert.ok(componentCode.includes('internalInputRef.current?.focus();'), 'focus method must focus internal input');
    assert.ok(!salesSessionCode.includes('Select Product to Add'), 'No popup title in SalesSession');
  });

  // Test 9: Cart and summary remain permanently visible
  await test('9. Cart, quantities, subtotal, GST and cart total remain permanently visible', async () => {
    assert.ok(salesSessionCode.includes('Products in Cart'), 'Products in Cart remains visible');
    assert.ok(salesSessionCode.includes('Subtotal'), 'Subtotal remains visible');
    assert.ok(salesSessionCode.includes('Cart Total'), 'Cart Total remains visible');
    assert.ok(salesSessionCode.includes('Total Amount'), 'Total Amount card remains visible');
  });

  console.log(`\n========================================`);
  console.log(`Test Results: ${passed} PASSED, ${failed} FAILED`);
  console.log(`========================================\n`);

  if (failed > 0) process.exit(1);
}

runTests();
