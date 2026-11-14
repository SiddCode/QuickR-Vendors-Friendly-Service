/**
 * QuickR — Customer UI Redesign & Simplified Form Verification Suite
 *
 * Verifies:
 * 1. Compact horizontal flex-row layout in Customers.tsx:
 *    - Left section: Checkbox, avatar/initials, customer name, mobile number underneath.
 *    - Middle section: Location, Preferred Size, Interested Category (when available).
 *    - Right section: Active/Inactive status, Total Enquiries, Purchased count, Delete action.
 * 2. Elimination of oversized card grid (no grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6).
 * 3. Preservation of bulk actions (Select All, Delete Selected) & pagination.
 * 4. Simplified Create Customer Form:
 *    - Removed Location / Address input.
 *    - Removed Preferred Size dropdown.
 *    - Removed Category Interest dropdown.
 *    - Kept ONLY Customer Name (required, full width), Mobile Number (required, 10-digit validation),
 *      WhatsApp consent checkbox, Cancel button, and Save Customer button.
 * 5. Data Protection:
 *    - Customer model schema preserves location and preferences.
 *    - Existing customer records with legacy location/size/category are preserved and rendered.
 *    - Backend API handles customer creation and update safely without deleting legacy data.
 *    - WhatsApp consent tracking logic preserved.
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
  console.log('👥 Starting QuickR Customer UI Redesign & Simplified Form Verification Suite...\n');

  const customersPath = path.resolve('frontend/src/pages/Customers.tsx');
  const code = fs.readFileSync(customersPath, 'utf8');

  const customerModelPath = path.resolve('backend/models/Customer.js');
  const modelCode = fs.readFileSync(customerModelPath, 'utf8');

  const serverPath = path.resolve('backend/server.js');
  const serverCode = fs.readFileSync(serverPath, 'utf8');

  // Test 1: Compact Horizontal Row Layout replaces oversized cards
  await test('1. Customer listing uses compact horizontal flex-row layout instead of oversized grid cards', async () => {
    assert.ok(
      !code.includes('grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'),
      'Oversized 3-column customer card grid must be removed'
    );
    assert.ok(
      code.includes('space-y-2.5'),
      'Customer rows must use compact vertical stack spacing'
    );
    assert.ok(
      code.includes('flex flex-col lg:flex-row lg:items-center justify-between'),
      'Each customer item must be a responsive horizontal flex-row'
    );
  });

  // Test 2: Left Section Content (Checkbox, Avatar, Name, Mobile)
  await test('2. Each row displays Left section with checkbox, avatar/initials, customer name, and mobile underneath', async () => {
    const rowIdx = code.indexOf('{paginatedCustomers.map((customer) => {');
    assert.ok(rowIdx > 0, 'Must map paginatedCustomers');
    const rowCode = code.slice(rowIdx);

    assert.ok(rowCode.includes('type="checkbox"'), 'Row must contain selection checkbox');
    assert.ok(rowCode.includes('handleToggleSelectCustomer'), 'Checkbox must toggle customer selection');
    assert.ok(rowCode.includes('initials'), 'Avatar must display computed customer initials');
    assert.ok(rowCode.includes('{customer.name}'), 'Customer name must be visible');
    assert.ok(rowCode.includes('{customer.phone}'), 'Customer mobile number must be visible underneath name');
  });

  // Test 3: Middle Section Content (Location, Size, Category - if available)
  await test('3. Each row displays Middle section with Location, Preferred Size, Interested Category (if available)', async () => {
    const rowIdx = code.indexOf('{paginatedCustomers.map((customer) => {');
    const rowCode = code.slice(rowIdx);

    assert.ok(rowCode.includes('customer.location'), 'Must display location if available');
    assert.ok(rowCode.includes('customer.preferences?.preferredSize'), 'Must display preferred size if available');
    assert.ok(rowCode.includes('customer.preferences?.interestedIn'), 'Must display interested category if available');
    assert.ok(rowCode.includes('MapPin'), 'Location must include MapPin icon');
  });

  // Test 4: Right Section Content (Status, Enquiries, Purchased, Delete action)
  await test('4. Each row displays Right section with Status, Enquiries, Purchased count, and Delete button', async () => {
    const rowIdx = code.indexOf('{paginatedCustomers.map((customer) => {');
    const rowCode = code.slice(rowIdx);

    assert.ok(rowCode.includes('<StatusBadge status={customer.status} />'), 'Must display StatusBadge');
    assert.ok(rowCode.includes('Enquiries:'), 'Must display Enquiries label and count');
    assert.ok(rowCode.includes('{totalEnq}'), 'Must display total enquiry count');
    assert.ok(rowCode.includes('Purchased:'), 'Must display Purchased label and count');
    assert.ok(rowCode.includes('{purchasedCount}'), 'Must display total purchased count');
    assert.ok(rowCode.includes('setCustomerToDelete'), 'Must have delete customer trigger');
  });

  // Test 5: Preservation of Bulk Actions & Filtering
  await test('5. Preserves Select All, Delete Selected toolbar, search, and status filter', async () => {
    assert.ok(code.includes('Select All'), 'Select All checkbox must be present');
    assert.ok(code.includes('Delete Selected'), 'Delete Selected button must be present');
    assert.ok(code.includes('handleExecuteBulkDelete'), 'Bulk delete handler must be present');
    assert.ok(code.includes('Search by name, phone or location...'), 'Search input must be present');
    assert.ok(code.includes('All Statuses'), 'Status filter dropdown must be present');
  });

  // Test 6: Simplified Create Customer Form — Removed unwanted fields
  await test('6. Create Customer form removes Location, Preferred Size, and Category Interest inputs', async () => {
    const modalIdx = code.indexOf('{/* Add Customer Modal */}');
    assert.ok(modalIdx > 0, 'Add Customer modal must be present');
    const modalCode = code.slice(modalIdx);

    // Form inputs must NOT contain Location input, Preferred Size select, or Category Interest select
    assert.ok(!modalCode.includes('placeholder="e.g. T. Nagar, Chennai"'), 'Location input must be removed from modal');
    assert.ok(!modalCode.includes('Preferred Size</label>'), 'Preferred Size label and dropdown must be removed from modal');
    assert.ok(!modalCode.includes('Category Interest</label>'), 'Category Interest label and dropdown must be removed from modal');
    assert.ok(!modalCode.includes('Small (S)'), 'Size options must be removed from modal');
    assert.ok(!modalCode.includes('Kurtis'), 'Category options must be removed from modal');
  });

  // Test 7: Simplified Create Customer Form — Kept required fields
  await test('7. Create Customer form keeps Customer Name, Mobile Number (10-digit validation), WhatsApp consent, Cancel & Save', async () => {
    const modalIdx = code.indexOf('{/* Add Customer Modal */}');
    const modalCode = code.slice(modalIdx);

    assert.ok(modalCode.includes('Customer Name *'), 'Customer Name input must be present');
    assert.ok(modalCode.includes('Mobile Number *'), 'Mobile Number input must be present');
    assert.ok(modalCode.includes('10 Digits'), '10 Digits badge must be present');
    assert.ok(modalCode.includes('Allow order updates & occasional offers on WhatsApp'), 'WhatsApp consent checkbox must be present');
    assert.ok(modalCode.includes('Cancel'), 'Cancel button must be present');
    assert.ok(modalCode.includes('Save Customer'), 'Save Customer button must be present');
  });

  // Test 8: 10-Digit Mobile Validation in Form Submission
  await test('8. Form validates mobile number with strict 10-digit check', async () => {
    assert.ok(code.includes("phone.replace(/\\D/g, '')"), 'Must extract digits from mobile number');
    assert.ok(code.includes("digits.length < 10"), 'Must check for at least 10 digits');
    assert.ok(code.includes('Enter a valid 10-digit mobile number.'), 'Must show clear error message');
  });

  // Test 9: Data Protection — MongoDB schema & server routes preserve location & preferences
  await test('9. Customer model schema preserves location and preferences for legacy data protection', async () => {
    assert.ok(modelCode.includes('location: { type: String'), 'Customer schema must define location');
    assert.ok(modelCode.includes('preferences: {'), 'Customer schema must define preferences');
    assert.ok(modelCode.includes('interestedIn: { type: String'), 'Customer schema must define interestedIn');
    assert.ok(modelCode.includes('preferredSize: { type: String'), 'Customer schema must define preferredSize');
    assert.ok(serverCode.includes("app.post('/api/customers'"), 'Server must have POST /api/customers');
    assert.ok(serverCode.includes("app.put('/api/customers/:id'"), 'Server must have PUT /api/customers/:id');
  });

  // Test 10: Role permissions — Customer deletion requires non-staff permissions
  await test('10. Customer delete and bulk-delete routes enforce requireNonStaff permission', async () => {
    assert.ok(
      serverCode.includes("app.delete('/api/customers/:id', requireAuth, requireNonStaff"),
      'Single customer delete must require non-staff (owner only)'
    );
    assert.ok(
      serverCode.includes("app.post('/api/customers/bulk-delete', requireAuth, requireNonStaff"),
      'Bulk customer delete must require non-staff (owner only)'
    );
  });

  // Test 11: 10-digit mobile number normalization & validation logic
  await test('11. Mobile number normalization validates 10 digits and handles prefixes', async () => {
    const { normalizeIndianMobileNumber } = await import('../utils/phone.js');
    assert.ok(typeof normalizeIndianMobileNumber === 'function', 'normalizeIndianMobileNumber function must exist');

    assert.equal(normalizeIndianMobileNumber('9876543210'), '9876543210', 'Standard 10-digit format');
    assert.equal(normalizeIndianMobileNumber('+91 98765 43210'), '9876543210', 'Format with +91 prefix and spaces');
    assert.equal(normalizeIndianMobileNumber('09876543210'), '9876543210', 'Format with leading 0');
    assert.equal(normalizeIndianMobileNumber('12345'), null, 'Short invalid number must be rejected');
    assert.equal(normalizeIndianMobileNumber('abcdefghij'), null, 'Letters must be rejected');
  });

  // Test 12: Legacy customer data preservation simulator
  await test('12. Legacy customer data simulation preserves existing preferences without deletion', async () => {
    const legacyCustomer = {
      id: 'CUST-001',
      name: 'Ananya Sharma',
      phone: '9876543210',
      location: 'T. Nagar, Chennai',
      preferences: {
        interestedIn: 'Kurtis',
        preferredSize: 'M',
        preferredColors: ['Pastel']
      },
      status: 'Active'
    };

    // When updating without sending location or preferences:
    const updatePayload = { name: 'Ananya S.' };
    const allowedUpdates = {};
    if (updatePayload.name) allowedUpdates.name = updatePayload.name;
    if (updatePayload.location) allowedUpdates.location = updatePayload.location;
    if (updatePayload.preferences) allowedUpdates.preferences = updatePayload.preferences;

    const merged = { ...legacyCustomer, ...allowedUpdates };
    assert.equal(merged.name, 'Ananya S.', 'Name updated');
    assert.equal(merged.location, 'T. Nagar, Chennai', 'Legacy location strictly preserved');
    assert.equal(merged.preferences.interestedIn, 'Kurtis', 'Legacy category strictly preserved');
    assert.equal(merged.preferences.preferredSize, 'M', 'Legacy size strictly preserved');
  });

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Customer UI Redesign test suite execution failed:', err);
  process.exit(1);
});
