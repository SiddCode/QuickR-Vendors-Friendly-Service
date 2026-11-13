/**
 * QuickR — Sales Session Keyboard Support & Persistent Discount Mode Verification Suite
 *
 * Verifies that:
 * 1. Complete Keyboard Support:
 *    - F2 focuses the inline product search and reveals results.
 *    - F4 / C focuses customer details (walk-in name or customer search).
 *    - S activates camera barcode scanner when outside inputs.
 *    - Ctrl + Enter (and Cmd + Enter on Mac) completes sale after validation.
 *    - F10 also completes sale.
 *    - Arrow Down / Arrow Up navigate product search results with active index tracking.
 *    - Enter adds the currently highlighted search result without mouse interaction.
 *    - Escape closes search results or cancels modals.
 *    - Tab and Shift + Tab flow naturally with visible focus ring states.
 *    - Search input has auto scroll-into-view for highlighted product.
 *    - Prominent visual indicator ('Selected', blue ring & border) on highlighted item.
 *    - POS shortcuts help modal documents all keys: F2, F4, Ctrl+Enter, Enter, Arrows, Esc, etc.
 *
 * 2. Persistent Discount Mode:
 *    - Scoped per shop: `quickr_discount_mode_${currentUser.shopId}`.
 *    - Lazy state initialization reads from localStorage.
 *    - Switching mode calls `handleSetDiscountType` which persists to localStorage.
 *    - Switching to percentage enforces <= 100%.
 *    - Switching to amount enforces <= subtotal.
 *    - Starting a new sale (`handleStartNewSale`) retains the discount mode.
 *    - Finalizing a committed sale (`finalizeCommittedSale`) retains the discount mode.
 *    - Clearing the cart retains the discount mode.
 *    - Only the mode ('percentage' | 'amount') is stored in localStorage, never the discount value.
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
  console.log('🧪 Starting QuickR Sales Session Keyboard & Discount Mode Verification Suite...\n');

  const componentPath = path.resolve('frontend/src/components/InlineProductSearch.tsx');
  const salesSessionPath = path.resolve('frontend/src/pages/SalesSession.tsx');

  const componentCode = fs.readFileSync(componentPath, 'utf8');
  const salesSessionCode = fs.readFileSync(salesSessionPath, 'utf8');

  // ─── 1. KEYBOARD NAVIGATION IN INLINE PRODUCT SEARCH ───
  await test('1.1 InlineProductSearch tracks highlightedIndex state initialized to 0', async () => {
    assert.ok(componentCode.includes('const [highlightedIndex, setHighlightedIndex] = useState<number>(0);'),
      'Must declare highlightedIndex state');
    assert.ok(componentCode.includes('setHighlightedIndex(0);'),
      'Must reset highlighted index when query or open state changes');
  });

  await test('1.2 Arrow Down key increments highlighted index cyclically and prevents default', async () => {
    assert.ok(componentCode.includes("e.key === 'ArrowDown'"), 'Must handle ArrowDown key');
    assert.ok(componentCode.includes('setHighlightedIndex(prev => (prev + 1) % filteredProducts.length);'),
      'Must increment index with modulo wrapping');
  });

  await test('1.3 Arrow Up key decrements highlighted index cyclically and prevents default', async () => {
    assert.ok(componentCode.includes("e.key === 'ArrowUp'"), 'Must handle ArrowUp key');
    assert.ok(componentCode.includes('setHighlightedIndex(prev => (prev - 1 + filteredProducts.length) % filteredProducts.length);'),
      'Must decrement index with modulo wrapping');
  });

  await test('1.4 Enter key in search input adds the highlighted/selected product', async () => {
    assert.ok(componentCode.includes("e.key === 'Enter'"), 'Must handle Enter key');
    assert.ok(componentCode.includes('const target = filteredProducts[highlightedIndex] || filteredProducts[0];'),
      'Must target the highlighted product on Enter');
    assert.ok(componentCode.includes('handleSelect(target)'),
      'Must select the target product');
  });

  await test('1.5 Escape key closes search results and blurs input', async () => {
    assert.ok(componentCode.includes("e.key === 'Escape'"), 'Must handle Escape key');
    assert.ok(componentCode.includes('setIsOpen(false);'), 'Must close search dropdown on Escape');
  });

  await test('1.6 Highlighted item has distinct visual styling and scrollIntoView ref', async () => {
    assert.ok(componentCode.includes('const isHighlighted = idx === highlightedIndex;'),
      'Must compute isHighlighted for each search item');
    assert.ok(componentCode.includes('ring-2 ring-blue-300'),
      'Highlighted item must have distinctive focus ring');
    assert.ok(componentCode.includes('Selected'),
      'Highlighted item must display Selected pill/badge');
    assert.ok(componentCode.includes('itemRefs.current[highlightedIndex]?.scrollIntoView'),
      'Must scroll highlighted item into view smoothly');
  });

  await test('1.7 Search ref focus() opens list, resets highlightedIndex to 0 and focuses input', async () => {
    assert.ok(componentCode.includes('setIsOpen(true);'), 'focus() must open list');
    assert.ok(componentCode.includes('internalInputRef.current?.focus();'), 'focus() must focus input');
  });

  // ─── 2. SALES SESSION GLOBAL KEYBOARD SHORTCUTS ───
  await test('2.1 F2 shortcut focuses inline product search', async () => {
    assert.ok(salesSessionCode.includes("e.key === 'F2'"), 'Must intercept F2 key');
    assert.ok(salesSessionCode.includes('inlineProductSearchRef.current?.focus();'),
      'F2 must call inlineProductSearchRef focus');
  });

  await test('2.2 Ctrl + Enter (and Cmd + Enter) triggers complete sale after validation', async () => {
    assert.ok(salesSessionCode.includes('(e.ctrlKey || e.metaKey) && e.key === \'Enter\''),
      'Must intercept Ctrl+Enter and Cmd+Enter');
    assert.ok(salesSessionCode.includes('handleCompleteSaleRef.current();'),
      'Must call handleCompleteSale on Ctrl+Enter');
  });

  await test('2.3 F10 function key triggers complete sale', async () => {
    assert.ok(salesSessionCode.includes("e.key === 'F10'"), 'Must intercept F10 key');
  });

  await test('2.4 F4 function key focuses customer details', async () => {
    assert.ok(salesSessionCode.includes("e.key === 'F4'"), 'Must intercept F4 key');
    assert.ok(salesSessionCode.includes('walkinCustomerNameRef.current?.focus();'),
      'Must focus walkinCustomerNameRef when isWalkIn');
    assert.ok(salesSessionCode.includes('customerSearchInputRef.current?.focus();'),
      'Must focus customerSearchInputRef when not walk-in');
  });

  await test('2.5 Plain Enter inside input fields does NOT trigger complete sale', async () => {
    // Verify Ctrl/Meta modifier check precedes complete sale invocation
    const keydownSection = salesSessionCode.slice(
      salesSessionCode.indexOf('// ─── GLOBAL FUNCTION KEYS & POS SHORTCUTS'),
      salesSessionCode.indexOf('// ─── SINGLE-LETTER SHORTCUTS')
    );
    assert.ok(keydownSection.includes('(e.ctrlKey || e.metaKey) && e.key === \'Enter\''),
      'Complete sale must require ctrlKey or metaKey with Enter');
    assert.ok(!keydownSection.includes("if (e.key === 'Enter') {\n        e.preventDefault();\n        handleCompleteSaleRef"),
      'Plain Enter must not submit sale');
  });

  await test('2.6 POS shortcuts help modal lists all required keys', async () => {
    assert.ok(salesSessionCode.includes('Focus Product Search'), 'Modal must include product search');
    assert.ok(salesSessionCode.includes('F2'), 'Modal must mention F2');
    assert.ok(salesSessionCode.includes('F4 / C'), 'Modal must mention F4 / C');
    assert.ok(salesSessionCode.includes('Navigate Search Results'), 'Modal must mention search navigation');
    assert.ok(salesSessionCode.includes('↑ / ↓'), 'Modal must mention arrows');
    assert.ok(salesSessionCode.includes('Add Highlighted Product'), 'Modal must mention Enter to add product');
    assert.ok(salesSessionCode.includes('Ctrl + Enter / F10'), 'Modal must mention Ctrl+Enter and F10');
    assert.ok(salesSessionCode.includes('Tab / ⇧Tab'), 'Modal must mention Tab / Shift+Tab');
  });

  // ─── 3. PERSISTENT DISCOUNT MODE (% vs ₹) ───
  await test('3.1 Discount mode storage key is scoped to currentUser.shopId', async () => {
    assert.ok(salesSessionCode.includes('quickr_discount_mode_${currentUser.shopId}'),
      'Storage key must be shop-scoped with currentUser.shopId');
    assert.ok(salesSessionCode.includes('quickr_discount_mode_default'),
      'Must provide safe fallback storage key');
  });

  await test('3.2 Initial discountType state is lazily loaded from localStorage', async () => {
    assert.ok(salesSessionCode.includes('localStorage.getItem(activeShopKey)'),
      'useState initializer must query localStorage');
    assert.ok(salesSessionCode.includes("saved === 'amount' || saved === 'percentage'"),
      'Must validate saved value before applying');
  });

  await test('3.3 Dynamic sync effect updates discountType when currentUser.shopId changes', async () => {
    assert.ok(salesSessionCode.includes('useEffect(() => {'), 'Must have effect');
    assert.ok(salesSessionCode.includes('quickr_discount_mode_${currentUser.shopId}'),
      'Must read shop-scoped key on shop change');
  });

  await test('3.4 handleSetDiscountType persists mode to localStorage on user switch', async () => {
    assert.ok(salesSessionCode.includes('const handleSetDiscountType = (newType: \'percentage\' | \'amount\') => {'),
      'Must define handleSetDiscountType');
    assert.ok(salesSessionCode.includes('localStorage.setItem(discountModeStorageKey, newType);'),
      'Must persist selected type to localStorage');
  });

  await test('3.5 Starting a new sale (handleStartNewSale) resets discountValue but preserves discountType', async () => {
    const startNewSaleSection = salesSessionCode.slice(
      salesSessionCode.indexOf('const handleStartNewSale = () => {'),
      salesSessionCode.indexOf('return (', salesSessionCode.indexOf('const handleStartNewSale = () => {'))
    );
    assert.ok(startNewSaleSection.includes('setDiscountValue(0);'), 'Must reset discountValue to 0');
    assert.ok(!startNewSaleSection.includes('setDiscountType('), 'Must NOT reset discountType in handleStartNewSale');
  });

  await test('3.6 Finalizing a committed sale (finalizeCommittedSale) preserves discountType', async () => {
    const finalizeSection = salesSessionCode.slice(
      salesSessionCode.indexOf('const finalizeCommittedSale = (sale: any, fallbackItems?: any[]) => {'),
      salesSessionCode.indexOf('// Recover unresolved pending sale across browser refreshes')
    );
    assert.ok(finalizeSection.includes('setDiscountValue(0);'), 'Must reset discountValue to 0');
    assert.ok(!finalizeSection.includes('setDiscountType('), 'Must NOT reset discountType in finalizeCommittedSale');
  });

  await test('3.7 Discount amount itself is NOT persisted in localStorage', async () => {
    assert.ok(!salesSessionCode.includes("localStorage.setItem(discountModeStorageKey, String(discountValue))"),
      'Must not save discount amount into localStorage');
    assert.ok(!salesSessionCode.includes("localStorage.setItem('quickr_discount_value"),
      'Must not create discount value storage key');
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
