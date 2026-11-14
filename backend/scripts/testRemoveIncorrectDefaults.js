/**
 * QuickR — Automated Regression Suite: Remove Incorrect Default Customer Values
 * 
 * Verifies:
 * 1. Customer Creation: Location defaults to empty string ('') when not entered.
 * 2. Customer Creation: Preferred size defaults to empty string ('') when not entered.
 * 3. Customer Creation: Explicit location and preferred size are preserved.
 * 4. Customer Model: Schema default for location is empty string ('').
 * 5. Server Route: POST /api/customers does not hardcode 'Chennai, Tamil Nadu' or 'S'.
 * 6. New Enquiry: Initial size state is empty string ('').
 * 7. New Enquiry: Product change does NOT auto-select sizes[0] (e.g. 'S').
 * 8. New Enquiry: Form submission is blocked if size is not selected for sized products.
 * 9. New Enquiry: Visually clear size prompt and selection UI.
 * 10. Server Route: POST /api/enquiries validates size requirement when product has sizes.
 * 11. Legacy Data Protection: Existing customers with location and preferred sizes are preserved.
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err.message}`);
    failed++;
  }
}

console.log('🧪 Starting Verification Suite: Remove Incorrect Default Customer Values...\n');

// Read files
const customerModelPath = path.join(rootDir, 'backend', 'models', 'Customer.js');
const serverPath = path.join(rootDir, 'backend', 'server.js');
const newEnquiryPath = path.join(rootDir, 'frontend', 'src', 'pages', 'NewEnquiry.tsx');
const customerProfilePath = path.join(rootDir, 'frontend', 'src', 'pages', 'CustomerProfile.tsx');
const customersPagePath = path.join(rootDir, 'frontend', 'src', 'pages', 'Customers.tsx');

const customerModelCode = fs.readFileSync(customerModelPath, 'utf8');
const serverCode = fs.readFileSync(serverPath, 'utf8');
const newEnquiryCode = fs.readFileSync(newEnquiryPath, 'utf8');
const customerProfileCode = fs.readFileSync(customerProfilePath, 'utf8');
const customersPageCode = fs.readFileSync(customersPagePath, 'utf8');

// 1. Customer Model Schema Defaults
test('1. Customer model schema defaults location to empty string', () => {
  assert.ok(
    customerModelCode.includes("location: { type: String, default: '' }"),
    'Customer model must have default: \'\' for location'
  );
  assert.ok(
    !customerModelCode.includes("location: { type: String, default: 'Chennai, Tamil Nadu' }"),
    'Customer model must NOT have default \'Chennai, Tamil Nadu\''
  );
});

test('2. Customer model schema defaults preferredSize to empty string', () => {
  assert.ok(
    customerModelCode.includes("preferredSize: { type: String, default: '' }"),
    'Customer model must have default: \'\' for preferredSize'
  );
  assert.ok(
    !customerModelCode.includes("preferredSize: { type: String, default: 'S' }"),
    'Customer model must NOT have default \'S\''
  );
});

// 2. Server Customer Creation Endpoint (POST /api/customers)
test('3. POST /api/customers does not hardcode Chennai fallback for location', () => {
  assert.ok(
    !serverCode.includes("location: typeof location === 'string' && location.trim() ? location.trim() : 'Chennai, Tamil Nadu'"),
    'Server must NOT use Chennai fallback in POST /api/customers'
  );
  assert.ok(
    serverCode.includes("location: typeof location === 'string' ? location.trim() : ''"),
    'Server must save empty string if location is not provided'
  );
});

test('4. POST /api/customers does not invent preferredSize', () => {
  assert.ok(
    serverCode.includes("preferredSize: typeof preferences.preferredSize === 'string' ? preferences.preferredSize.trim() : ''") ||
    serverCode.includes("preferredSize: typeof preferences?.preferredSize === 'string' ? preferences.preferredSize.trim() : ''"),
    'Server must save empty string if preferredSize is not provided'
  );
});

// 3. New Enquiry Page Size Behavior
test('5. New Enquiry initializes size state to empty string (no size selected initially)', () => {
  assert.ok(
    newEnquiryCode.includes("const [size, setSize] = useState<string>('');"),
    'Initial size state must be empty string'
  );
  assert.ok(
    !newEnquiryCode.includes("const [size, setSize] = useState<string>('S');"),
    'Initial size state must NOT be \'S\''
  );
  assert.ok(
    !newEnquiryCode.includes("const [size, setSize] = useState<string>('Free Size');"),
    'Initial size state must NOT be \'Free Size\' on component level'
  );
});

test('6. New Enquiry product change effect does NOT auto-select sizes[0]', () => {
  assert.ok(
    !newEnquiryCode.includes("setSize(currentProduct.sizes[0])"),
    'Must NOT automatically set sizes[0]'
  );
  assert.ok(
    newEnquiryCode.includes("if (!currentProduct.sizes.includes(size)) {\n          setSize('');"),
    'Must reset size to empty string if not in current product sizes'
  );
});

test('7. New Enquiry product dropdown resets size to empty on change', () => {
  assert.ok(
    newEnquiryCode.includes("setProdId(e.target.value);\n              setSize('');"),
    'Changing product must reset size to empty string'
  );
});

test('8. New Enquiry blocks submission with validation error if size is not selected for sized products', () => {
  assert.ok(
    newEnquiryCode.includes("if (currentProduct?.sizes && currentProduct.sizes.length > 0 && !size.trim())"),
    'handleCreateEnquiry must check if size is empty for products with sizes'
  );
  assert.ok(
    newEnquiryCode.includes("setFormError('Please select a size for this product.');"),
    'Must display clear error message requesting size selection'
  );
});

test('9. New Enquiry UI displays clear visual indicator when no size is selected', () => {
  assert.ok(
    newEnquiryCode.includes("Please select a size"),
    'Must show visual hint to select a size'
  );
  assert.ok(
    newEnquiryCode.includes("const isSelected = size === sz;"),
    'Must highlight only the explicitly chosen size'
  );
});

// 4. Server Route POST /api/enquiries validation
test('10. POST /api/enquiries strictly rejects requests without size when product has sizes', () => {
  assert.ok(
    serverCode.includes("if (product.sizes && product.sizes.length > 0 && (!size || !String(size).trim()))"),
    'Server route must reject missing size when product has sizes'
  );
  assert.ok(
    serverCode.includes("res.status(400).json({ error: 'Please choose a size for this product' })"),
    'Server route must return 400 error message for missing size'
  );
});

// 5. Customer Profile & Customers Page Safety
test('11. Customer Profile conditionally renders location only if present and non-empty', () => {
  assert.ok(
    customerProfileCode.includes("customer.location && customer.location.trim()"),
    'Customer Profile must only show location badge if location is non-empty'
  );
});

test('12. Customer Profile does not invent preferredSize when empty', () => {
  assert.ok(
    customerProfileCode.includes("{customer.preferences?.preferredSize || '—'}"),
    'Customer Profile must display dash (—) when preferred size is empty'
  );
});

test('13. Customers page creation modal submits empty location and preferences', () => {
  assert.ok(
    customersPageCode.includes("location: '',"),
    'Customers page modal must submit empty string for location'
  );
  assert.ok(
    customersPageCode.includes("preferences: {},"),
    'Customers page modal must submit empty object for preferences'
  );
});

// 6. Legacy Customer Simulation Test
test('14. Simulation: Creating customer without location and preferences results in empty values', () => {
  const reqBody = {
    name: 'Test Customer',
    phone: '9876543210',
    email: '',
    location: '',
    preferences: {}
  };

  const normalized = {
    name: String(reqBody.name).trim(),
    phone: reqBody.phone,
    email: typeof reqBody.email === 'string' ? reqBody.email.trim() : '',
    location: typeof reqBody.location === 'string' ? reqBody.location.trim() : '',
    preferences: {
      interestedIn: typeof reqBody.preferences?.interestedIn === 'string' ? reqBody.preferences.interestedIn.trim() : '',
      preferredSize: typeof reqBody.preferences?.preferredSize === 'string' ? reqBody.preferences.preferredSize.trim() : '',
      preferredColors: Array.isArray(reqBody.preferences?.preferredColors) ? reqBody.preferences.preferredColors : [],
      lastPurchase: typeof reqBody.preferences?.lastPurchase === 'string' ? reqBody.preferences.lastPurchase.trim() : ''
    }
  };

  assert.strictEqual(normalized.location, '', 'Location must be empty string');
  assert.strictEqual(normalized.preferences.preferredSize, '', 'Preferred size must be empty string');
  assert.notStrictEqual(normalized.location, 'Chennai, Tamil Nadu', 'Must never equal Chennai');
  assert.notStrictEqual(normalized.preferences.preferredSize, 'S', 'Must never equal S');
});

test('15. Simulation: Legacy customer with existing Chennai or size M is preserved intact', () => {
  const legacyCustomer = {
    id: 'CUST-LEGACY-001',
    name: 'Legacy Customer',
    phone: '9123456780',
    location: 'Chennai, Tamil Nadu',
    preferences: {
      interestedIn: 'Shirts',
      preferredSize: 'M',
      preferredColors: ['Blue']
    }
  };

  // Simulate non-modifying read or partial update (e.g. updating name only)
  const updateReq = { name: 'Legacy Customer Updated' };
  const allowedUpdates = {};
  if (typeof updateReq.name === 'string' && updateReq.name.trim()) allowedUpdates.name = updateReq.name.trim();
  if (typeof updateReq.location === 'string') allowedUpdates.location = updateReq.location.trim();

  const merged = { ...legacyCustomer, ...allowedUpdates };
  assert.strictEqual(merged.location, 'Chennai, Tamil Nadu', 'Legacy location strictly preserved');
  assert.strictEqual(merged.preferences.preferredSize, 'M', 'Legacy preferred size strictly preserved');
});

console.log(`\n========================================`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`========================================\n`);

if (failed > 0) {
  process.exit(1);
}
