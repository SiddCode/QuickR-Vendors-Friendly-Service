/**
 * QuickR — Sales Session Mobile Responsive UI Polish Verification Suite
 *
 * Verifies mobile polish requirements for SalesSession.tsx & InlineProductSearch.tsx:
 * 1. Single-column mobile layout structure with natural section ordering:
 *    Customer Details -> Search/Scanner -> Cart Products -> Subtotal/GST ->
 *    Payment Method -> Large Total Amount -> Complete Sale -> Print & WhatsApp.
 * 2. Responsive Customer Details card (compact padding, wrapping radio options, mobile input modes).
 * 3. Mobile Product Search & Barcode Scanner (responsive header, touch targets, inputMode="search").
 * 4. Mobile Cart Products (natural wrapping on names, full-width responsive controls row, touch steppers, price editing).
 * 5. Subtotal, GST & Cart Total cleanly displayed without horizontal overflow.
 * 6. Responsive 2x2 Payment Method grid on narrow screens with >= 48px touch targets.
 * 7. Prominent Total Amount card, full-width Complete Sale (>= 48px), stacked Print/WhatsApp (>= 44px).
 * 8. Zero floating overlays covering cart content (natural scroll flow).
 * 9. Strict preservation of approved desktop layout (lg:w-[62%], lg:w-[38%]).
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
  console.log('📱 Starting QuickR Sales Session Mobile Responsive Verification Suite...\n');

  const salesSessionPath = path.resolve('frontend/src/pages/SalesSession.tsx');
  const code = fs.readFileSync(salesSessionPath, 'utf8');

  const inlinePath = path.resolve('frontend/src/components/InlineProductSearch.tsx');
  const inlineCode = fs.readFileSync(inlinePath, 'utf8');

  // Test 1: Single-Column Mobile Layout & Natural Flow
  await test('1. Single-column mobile layout with natural DOM section order', async () => {
    assert.ok(code.includes('flex flex-col lg:flex-row'), 'Must use responsive flex column on mobile, row on lg');
    assert.ok(code.includes('lg:w-[62%]'), 'Desktop left column 62% intact');
    assert.ok(code.includes('lg:w-[38%]'), 'Desktop right column 38% intact');

    // Search specifically within the billing workspace JSX
    const workspaceStart = code.indexOf('{/* ─── TWO-COLUMN ACTIVE BILLING WORKSPACE ─── */}');
    assert.ok(workspaceStart > 0, 'Billing workspace must be present');
    const workspaceCode = code.slice(workspaceStart);

    const custIdx = workspaceCode.indexOf('Customer Details');
    const searchIdx = workspaceCode.indexOf('<InlineProductSearch');
    const cartItemsIdx = workspaceCode.indexOf('items.map');
    const cartSummaryIdx = workspaceCode.indexOf('Cart Total');
    const paymentMethodIdx = workspaceCode.indexOf('Payment Method');
    const totalAmountIdx = workspaceCode.indexOf('Total Amount');
    const completeSaleIdx = workspaceCode.indexOf('Complete Sale');
    const printBillIdx = workspaceCode.indexOf('Print Bill');
    const whatsAppIdx = workspaceCode.indexOf('Share via WhatsApp');

    assert.ok(custIdx > 0, 'Customer Details must be present in workspace');
    assert.ok(searchIdx > custIdx, 'Product Search must follow Customer Details');
    assert.ok(cartItemsIdx > searchIdx, 'Cart Items must follow Product Search');
    assert.ok(cartSummaryIdx > cartItemsIdx, 'Cart Summary must follow Cart Items');
    assert.ok(paymentMethodIdx > cartSummaryIdx, 'Payment Method must follow Cart Summary');
    assert.ok(totalAmountIdx > paymentMethodIdx, 'Large Total Amount must follow Payment Method on mobile');
    assert.ok(completeSaleIdx > totalAmountIdx, 'Complete Sale must follow Total Amount');
    assert.ok(printBillIdx > completeSaleIdx, 'Print Bill must follow Complete Sale');
    assert.ok(whatsAppIdx > printBillIdx, 'WhatsApp Sharing must follow Print Bill');
  });

  // Test 2: Customer Details Mobile Polish
  await test('2. Customer details card has compact padding, wrapping radios, and mobile touch input modes', async () => {
    assert.ok(code.includes('p-3.5 sm:p-5'), 'Card padding must be compact on mobile (p-3.5) and spacious on desktop (p-5)');
    assert.ok(code.includes('flex flex-wrap items-center gap-3.5 sm:gap-6'), 'Radios must wrap cleanly without overflow');
    assert.ok(code.includes('grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4'), 'Input grid stacks vertically on mobile (grid-cols-1)');
    assert.ok(code.includes('inputMode="text"'), 'Walk-in customer name has inputMode="text"');
    assert.ok(code.includes('inputMode="tel"'), 'Walk-in customer phone has inputMode="tel"');
    assert.ok(code.includes('inputMode="search"'), 'Customer search has inputMode="search"');
  });

  // Test 3: Product Search & Barcode Scanner Mobile Polish
  await test('3. Cart header has responsive wrapping and touch-friendly scanner & search buttons', async () => {
    assert.ok(
      code.includes('flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2 border-b border-slate-100'),
      'Cart header stacks vertically on mobile to prevent crowding'
    );
    assert.ok(code.includes('min-h-[38px] sm:min-h-[32px]'), 'Add Product & Scan Barcode buttons have comfortable touch targets');
    assert.ok(inlineCode.includes('inputMode="search"'), 'Inline search input has inputMode="search"');
    assert.ok(inlineCode.includes('p-3 sm:p-4'), 'Inline search container has mobile-optimized padding');
    assert.ok(inlineCode.includes('flex flex-wrap items-center justify-between gap-1'), 'Inline search status info wraps cleanly');
  });

  // Test 4: Cart Products Mobile Polish (No Aggressive Truncation)
  await test('4. Cart items wrap naturally without clipping and have responsive full-width controls row', async () => {
    assert.ok(
      code.includes('text-[16px] font-semibold text-slate-800 leading-snug break-words'),
      'Product name must have natural multiline wrapping (break-words) instead of clipping'
    );
    assert.ok(
      code.includes('text-[13px] text-slate-500 font-normal mt-0.5 break-words'),
      'Variant text must have natural wrapping (break-words)'
    );
    assert.ok(
      code.includes('flex items-center justify-between sm:justify-end gap-2.5 sm:gap-4 shrink-0 w-full sm:w-auto pt-2 sm:pt-0 border-t border-slate-100 sm:border-t-0'),
      'Controls row must span full width on mobile with subtle separator'
    );
    assert.ok(code.includes('inputMode="decimal"'), 'Quantity and price edit inputs have inputMode="decimal" for numeric keypad');
    assert.ok(code.includes('min-w-[100px] sm:min-w-[120px]'), 'Price container has responsive min-width');
  });

  // Test 5: Subtotal, GST & Cart Total
  await test('5. Cart summary neatly aligns with card edges on mobile without horizontal scroll', async () => {
    assert.ok(
      code.includes('-mx-3.5 -mb-3.5 sm:-mx-5 sm:-mb-5 p-3.5 sm:p-5'),
      'Negative margins match responsive card padding on mobile and desktop'
    );
    assert.ok(code.includes('text-[14px] text-slate-600 font-medium'), 'Subtotal & GST labels preserved');
    assert.ok(code.includes('text-[18px] font-bold text-slate-900'), 'Cart Total label preserved');
  });

  // Test 6: Payment Methods 2x2 Grid with Touch Targets >= 48px
  await test('6. Payment methods display in 2x2 grid on mobile with >= 48px touch targets', async () => {
    assert.ok(code.includes('grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3'), 'Must be 2x2 grid on mobile, 4 cols on sm/desktop');
    assert.ok(code.includes('min-h-[50px]'), 'Payment method buttons have >= 50px touch target height');
    assert.ok(code.includes('border-blue-600 text-blue-700'), 'Clear active selection styling preserved');
  });

  // Test 7: Total Amount, Complete Sale & Print/WhatsApp
  await test('7. Prominent Total Amount card, full-width Complete Sale (>= 48px), and responsive Print/WhatsApp (>= 44px)', async () => {
    assert.ok(code.includes('bg-gradient-to-br from-blue-600 to-indigo-700'), 'Total Amount has blue gradient card');
    assert.ok(
      code.includes('text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-white mt-1.5 flex items-baseline break-words'),
      'Total Amount typography wraps safely'
    );
    assert.ok(code.includes('min-h-[48px]'), 'Complete Sale button has comfortable >= 48px touch target');
    assert.ok(code.includes('flex flex-col sm:flex-row gap-2.5 sm:gap-3'), 'Print Bill and WhatsApp buttons stack on mobile');
    assert.ok(code.includes('min-h-[44px]'), 'Print Bill and WhatsApp buttons have comfortable >= 44px touch targets');
  });

  // Test 8: No Floating Buttons Covering Cart Content
  await test('8. Zero fixed floating button overlays covering cart content', async () => {
    assert.ok(!code.includes('fixed bottom-0'), 'Must NOT have fixed bottom overlay covering cart content');
    assert.ok(!code.includes('fixed inset-x-0 bottom-0'), 'Must NOT have fixed inset-x-0 bottom bar');
    assert.ok(!code.includes('sticky bottom-0'), 'Must NOT have sticky bottom bar covering cart content');
  });

  // Test 9: Overall Page Padding & Spacing
  await test('9. Overall page has compact responsive outer padding and spacing', async () => {
    assert.ok(code.includes('p-3 sm:p-4 lg:p-6 space-y-4 sm:space-y-6'), 'Outer container padding is responsive');
    assert.ok(code.includes('p-3.5 sm:p-5 shadow-sm flex flex-col md:flex-row'), 'Session header padding is responsive');
  });

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test suite execution failed:', err);
  process.exit(1);
});
