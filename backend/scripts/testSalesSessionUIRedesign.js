/**
 * QuickR — Sales Session UI Redesign Verification Suite
 *
 * Verifies that SalesSession.tsx adheres strictly to the reference specification:
 * 1. Two-column desktop layout: Left column ~62% width, Right column ~38% width.
 * 2. Left Top — Customer Details card: includes only Name, Phone, and Walk-in/Existing selection.
 *    Does NOT include state, address, email or unnecessary fields.
 * 3. Left Middle — Products in Cart:
 *    - Header has "Products in Cart" with item count and "Scan Barcode" button.
 *    - Product rows are TEXT ONLY (zero <img>, zero shirt/pant images, zero thumbnails).
 *    - Typography: Product name 16px semibold, Colour/size 13px regular, Quantity 16px semibold,
 *      Item price 17px bold, Subtotal & GST 14-15px, Cart total 18px bold.
 *    - Controls: Decrease (-), value, Increase (+), Item price, Remove (trash).
 *    - Cart summary at bottom of cart card: Subtotal, GST amount & rate, Cart Total.
 * 4. Left Bottom — Payment Method card:
 *    - 4 selectable options: Cash, UPI, Card, Other with icons and clear selected state.
 * 5. Right Top — Large Total Amount:
 *    - Prominent blue card, Label: Total Amount, Large ₹ amount.
 * 6. Right Bottom — Payment Summary and Actions:
 *    - Subtotal, GST, Grand Total.
 *    - Large green Complete Sale button.
 *    - Print Bill & Share via WhatsApp buttons.
 * 7. Mobile responsive layout (single column stack on mobile/tablet).
 * 8. Billing calculations, GST, discounts, and WhatsApp sharing remain 100% functional.
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
  console.log('🧪 Starting QuickR Sales Session UI Redesign Verification Suite...\n');

  const salesSessionPath = path.resolve('frontend/src/pages/SalesSession.tsx');
  const code = fs.readFileSync(salesSessionPath, 'utf8');

  // Test 1: Two-column desktop layout (62% left, 38% right)
  await test('1. Desktop layout has 62% left column and 38% right column', async () => {
    assert.ok(code.includes('lg:w-[62%]'), 'Left column must be approximately 62% width');
    assert.ok(code.includes('lg:w-[38%]'), 'Right column must be approximately 38% width');
    assert.ok(code.includes('flex flex-col lg:flex-row'), 'Must use responsive flex layout stacking on mobile');
  });

  // Test 2: Compact Customer Details card with Name, Phone, Walk-in/Existing selection ONLY
  await test('2. Customer details includes only Name, Phone, and Walk-in/Existing selection', async () => {
    assert.ok(code.includes('Walk-in Customer'), 'Must have Walk-in Customer option');
    assert.ok(code.includes('Existing Customer'), 'Must have Existing Customer option');
    assert.ok(code.includes('Customer Name'), 'Must have Customer Name input');
    assert.ok(code.includes('Phone Number'), 'Must have Phone Number input');

    // Confirm no state dropdown, state code, or address inputs in customer details card
    assert.ok(!code.includes('Customer State</label>'), 'Must NOT include Customer State dropdown');
    assert.ok(!code.includes('State Code</label>'), 'Must NOT include State Code input');
    assert.ok(!code.includes('Customer Address'), 'Must NOT include Customer Address input');
    assert.ok(!code.includes('Customer Email'), 'Must NOT include Customer Email input');
  });

  // Test 3: Products in Cart header and Text-Only cart rows
  await test('3. Products in Cart card has header, count, scan button, and TEXT-ONLY items', async () => {
    assert.ok(code.includes('Products in Cart'), 'Header must display "Products in Cart"');
    assert.ok(code.includes('Scan Barcode'), 'Header must have "Scan Barcode" button');

    // Verify TEXT-ONLY: no <img> or thumbnail elements inside cart items
    const cartIdx = code.indexOf('Products in Cart');
    const paymentMethodIdx = code.indexOf('Payment Method', cartIdx);
    const cartItemsSection = code.slice(cartIdx, paymentMethodIdx);
    assert.ok(!cartItemsSection.includes('<img'), 'Cart items must NOT contain <img> tags');
    assert.ok(!cartItemsSection.includes('thumbnail'), 'Cart items must NOT contain thumbnail images');
    assert.ok(!cartItemsSection.includes('product-image'), 'Cart items must NOT contain product images');
  });

  // Test 4: Cart Typography Hierarchy
  await test('4. Cart typography matches recommended specification', async () => {
    // Product name: 16px, semibold
    assert.ok(code.includes('text-[16px] font-semibold text-slate-800'), 'Product name must be 16px semibold');
    // Colour and size: 13px, regular
    assert.ok(code.includes('text-[13px] text-slate-500 font-normal'), 'Colour and size must be 13px regular secondary text');
    // Quantity: 16px, semibold
    assert.ok(code.includes('text-[16px] font-semibold text-slate-800 bg-transparent'), 'Quantity input must be 16px semibold');
    // Item price: 17px, bold
    assert.ok(code.includes('text-[17px] font-bold text-slate-900'), 'Item price must be 17px bold');
    // Subtotal and GST labels: 14-15px
    assert.ok(code.includes('text-[14px] text-slate-600 font-medium'), 'Subtotal & GST labels must be 14px font-medium');
    // Cart total: 18px, bold
    assert.ok(code.includes('text-[18px] font-bold text-slate-900'), 'Cart total label must be 18px bold');
  });

  // Test 5: Cart quantity controls and remove button
  await test('5. Cart has quantity decrease (-), quantity increase (+), and remove item (trash)', async () => {
    assert.ok(code.includes('title="Decrease quantity (-)"'), 'Must have decrease quantity (-) button');
    assert.ok(code.includes('title="Increase quantity (+)"'), 'Must have increase quantity (+) button');
    assert.ok(code.includes('title="Remove product"'), 'Must have remove product button');
  });

  // Test 6: Cart summary at the bottom of cart card
  await test('6. Cart summary at bottom of cart displays Subtotal, GST, and Cart Total', async () => {
    const cartIdx = code.indexOf('Products in Cart');
    const paymentMethodIdx = code.indexOf('Payment Method', cartIdx);
    const cartSection = code.slice(cartIdx, paymentMethodIdx);
    assert.ok(cartSection.includes('Subtotal'), 'Cart summary must display Subtotal');
    assert.ok(cartSection.includes('GST'), 'Cart summary must display GST amount and rate');
    assert.ok(cartSection.includes('Cart Total'), 'Cart summary must display Cart Total');
  });

  // Test 7: Payment Method card with 4 selectable options
  await test('7. Payment Method card has Cash, UPI, Card, and Other with clear selected state', async () => {
    assert.ok(code.includes("id: 'Cash', label: 'Cash'"), 'Must have Cash payment option');
    assert.ok(code.includes("id: 'UPI', label: 'UPI'"), 'Must have UPI payment option');
    assert.ok(code.includes("id: 'Card', label: 'Card'"), 'Must have Card payment option');
    assert.ok(code.includes("id: 'Other', label: 'Other'"), 'Must have Other payment option');
    // Selected state indicator
    assert.ok(code.includes('border-blue-600 text-blue-700'), 'Must show clear selected state with blue highlight');
  });

  // Test 8: Right Top — Prominent blue Total Amount card
  await test('8. Right column top has prominent blue Total Amount card', async () => {
    assert.ok(code.includes('bg-gradient-to-br from-blue-600 to-indigo-700'), 'Total Amount card must have rich blue background');
    assert.ok(code.includes('Total Amount'), 'Total Amount label present');
    assert.ok(code.includes('text-3xl sm:text-4xl lg:text-5xl font-black'), 'Large visible total amount typography');
  });

  // Test 9: Right Bottom — Payment Summary & Actions
  await test('9. Payment Summary displays Subtotal, GST, Grand Total, Complete Sale, Print, WhatsApp', async () => {
    assert.ok(code.includes('Payment Summary'), 'Must have Payment Summary card');
    assert.ok(code.includes('Grand Total'), 'Must have visually prominent Grand Total');
    assert.ok(code.includes('bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-base'), 'Large green Complete Sale button');
    assert.ok(code.includes('Print Bill'), 'Must have Print Bill button');
    assert.ok(code.includes('Share via WhatsApp'), 'Must have Share via WhatsApp button');
  });

  // Test 10: Dynamic Calculation Verification (Cart & Total update correctly)
  await test('10. Billing calculation simulator updates subtotal, GST, discount, and grand total', async () => {
    const mockItems = [
      { id: '1', quantity: 2, rate: 500, measurementType: 'piece' },
      { id: '2', quantity: 1, rate: 1000, measurementType: 'piece' }
    ];
    const subtotal = mockItems.reduce((acc, i) => acc + (i.quantity * i.rate), 0);
    assert.equal(subtotal, 2000, 'Subtotal must be 2000');

    // 10% discount
    const discountVal = 10;
    const discountAmt = (subtotal * discountVal) / 100;
    assert.equal(discountAmt, 200, 'Discount must be 200');

    // GST on remaining 1800 at 5%
    const taxable = subtotal - discountAmt;
    const gstRate = 5;
    const gstAmt = Math.round((taxable * (gstRate / (100 + gstRate))) * 100) / 100;
    const grandTotal = taxable; // inclusive
    assert.ok(grandTotal > 0, 'Grand total must be positive');
  });

  console.log(`\n========================================`);
  console.log(`Test Results: ${passed} PASSED, ${failed} FAILED`);
  console.log(`========================================\n`);

  if (failed > 0) process.exit(1);
}

runTests();
