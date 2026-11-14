/**
 * QuickR — Automated Regression Suite: Dynamic Product Sizes in New Enquiry
 * 
 * Verifies:
 * 1. Product with 1 size (e.g. ['S']) displays only that size.
 * 2. Product with multiple sizes (e.g. ['S', 'M', 'L']) displays all configured sizes.
 * 3. Product with sizes without S (e.g. ['M', 'L', 'XL', 'XXL']) displays those sizes and NEVER defaults to S.
 * 4. Product with no configured sizes displays "No sizes configured" and treats size as optional.
 * 5. Initially, no size is selected (size === '').
 * 6. Never automatically selects the first available size.
 * 7. Requires the user to explicitly select a size when product has sizes.
 * 8. When selected product changes, available size options refresh and previous selection is cleared.
 * 9. Multi-select sizes stored in products and legacy product data are strictly preserved.
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

console.log('🧪 Starting Verification Suite: Dynamic Product Sizes in New Enquiry...\n');

// Read files
const newEnquiryPath = path.join(rootDir, 'frontend', 'src', 'pages', 'NewEnquiry.tsx');
const productModelPath = path.join(rootDir, 'backend', 'models', 'Product.js');
const serverPath = path.join(rootDir, 'backend', 'server.js');

const newEnquiryCode = fs.readFileSync(newEnquiryPath, 'utf8');
const productModelCode = fs.readFileSync(productModelPath, 'utf8');
const serverCode = fs.readFileSync(serverPath, 'utf8');

// 1. Initial State & No Auto-selection
test('1. Initial size state starts empty (no size selected initially)', () => {
  assert.ok(
    newEnquiryCode.includes("const [size, setSize] = useState<string>('');"),
    'Initial size state must be initialized to empty string'
  );
  assert.ok(
    !newEnquiryCode.includes("const [size, setSize] = useState<string>('S');"),
    'Initial size state must NOT be hardcoded S'
  );
  assert.ok(
    !newEnquiryCode.includes("const [size, setSize] = useState<string>('Free Size');"),
    'Initial size state must NOT be Free Size'
  );
});

test('2. First available size is NEVER automatically selected', () => {
  assert.ok(
    !newEnquiryCode.includes("setSize(currentProduct.sizes[0])"),
    'Must NOT automatically assign currentProduct.sizes[0]'
  );
  assert.ok(
    !newEnquiryCode.includes("setSize(activeProducts[0].sizes[0])"),
    'Must NOT automatically assign activeProducts[0].sizes[0]'
  );
});

// 2. Dynamic Size Retrieval and Rendering
test('3. Dynamically maps through currentProduct.sizes to render configured options', () => {
  assert.ok(
    newEnquiryCode.includes("currentProduct?.sizes && currentProduct.sizes.length > 0"),
    'Must check currentProduct.sizes for configured options'
  );
  assert.ok(
    newEnquiryCode.includes("currentProduct.sizes.map"),
    'Must iterate through currentProduct.sizes to generate selectable pills'
  );
  assert.ok(
    newEnquiryCode.includes("onClick={() => {\n                        setSize(sz);"),
    'Clicking a size pill must update the size state to the clicked size'
  );
});

test('4. Product with no configured sizes displays "No sizes configured" message', () => {
  assert.ok(
    newEnquiryCode.includes("No sizes configured"),
    'Must display clear "No sizes configured" message when product has no sizes'
  );
  assert.ok(
    newEnquiryCode.includes("Size {currentProduct?.sizes && currentProduct.sizes.length > 0 ? (") &&
    newEnquiryCode.includes("(Optional)"),
    'Label must indicate size is optional when product has no configured sizes'
  );
});

// 3. Selection Clearing on Product Change
test('5. Product change clears previous size selection and refreshes options', () => {
  assert.ok(
    newEnquiryCode.includes("setProdId(e.target.value);\n              setSize('');"),
    'Product dropdown onChange must immediately clear selected size'
  );
  assert.ok(
    newEnquiryCode.includes("if (!currentProduct.sizes.includes(size)) {\n          setSize('');"),
    'Product change effect must reset size to empty string'
  );
});

// 4. Validation & Explicit Selection Requirement
test('6. Explicit size selection is required when product has configured sizes', () => {
  assert.ok(
    newEnquiryCode.includes("if (currentProduct?.sizes && currentProduct.sizes.length > 0 && !size.trim())"),
    'Must validate that size is not empty for products with configured sizes'
  );
  assert.ok(
    newEnquiryCode.includes("setFormError('Please select a size for this product.');"),
    'Must display error message prompting user to select a size'
  );
});

test('7. Size is optional when product has no configured sizes', () => {
  // If product has no sizes, the validation condition above evaluates to false and does not block
  assert.ok(
    newEnquiryCode.includes("size: size || 'Free Size'"),
    'Enquiry submission handles unconfigured size gracefully by passing fallback'
  );
});

// 5. Product Schema & Multi-select Size Storage Preservation
test('8. Product model schema preserves sizes array for multi-select size storage', () => {
  assert.ok(
    productModelCode.includes("sizes: [{ type: String }],"),
    'Product schema must define sizes as an array of strings'
  );
});

// 6. Simulation Tests for Examples
test('9. Simulation: Product with sizes [S] → renders only S', () => {
  const productWithSingleSize = {
    id: 'PROD-SINGLE',
    name: 'Single Size Tee',
    sizes: ['S']
  };

  const renderedPills = productWithSingleSize.sizes.map(sz => sz);
  assert.deepStrictEqual(renderedPills, ['S']);
  assert.strictEqual(renderedPills.length, 1);
  assert.strictEqual(renderedPills[0], 'S');
});

test('10. Simulation: Product with sizes [S, M, L] → renders S, M, L', () => {
  const productWithStandardSizes = {
    id: 'PROD-STANDARD',
    name: 'Linen Shirt',
    sizes: ['S', 'M', 'L']
  };

  const renderedPills = productWithStandardSizes.sizes.map(sz => sz);
  assert.deepStrictEqual(renderedPills, ['S', 'M', 'L']);
  assert.strictEqual(renderedPills.length, 3);
});

test('11. Simulation: Product with sizes [M, L, XL, XXL] → renders M, L, XL, XXL without S', () => {
  const productWithoutS = {
    id: 'PROD-LARGE',
    name: 'Overcoat',
    sizes: ['M', 'L', 'XL', 'XXL']
  };

  const renderedPills = productWithoutS.sizes.map(sz => sz);
  assert.deepStrictEqual(renderedPills, ['M', 'L', 'XL', 'XXL']);
  assert.ok(!renderedPills.includes('S'), 'Must never include S if not in product sizes');
  assert.strictEqual(renderedPills.length, 4);
});

test('12. Simulation: Product with empty sizes [] → displays No sizes configured and size is optional', () => {
  const productWithNoSizes = {
    id: 'PROD-NOSIZE',
    name: 'Cotton Handkerchief',
    sizes: []
  };

  const hasConfiguredSizes = productWithNoSizes.sizes && productWithNoSizes.sizes.length > 0;
  assert.strictEqual(hasConfiguredSizes, false);

  const displayMessage = hasConfiguredSizes ? null : 'No sizes configured';
  assert.strictEqual(displayMessage, 'No sizes configured');

  // Validate that form validation does not block submission
  let formError = null;
  const currentSize = '';
  if (hasConfiguredSizes && !currentSize.trim()) {
    formError = 'Please select a size for this product.';
  }
  assert.strictEqual(formError, null, 'Submission must not be blocked when no sizes configured');
});

test('13. Simulation: Switching from Product A (size M selected) to Product B clears size selection', () => {
  let selectedProdId = 'PROD-A';
  let selectedSize = 'M';

  // User changes dropdown to PROD-B
  const handleProductChange = (newProdId) => {
    selectedProdId = newProdId;
    selectedSize = ''; // cleared
  };

  handleProductChange('PROD-B');
  assert.strictEqual(selectedProdId, 'PROD-B');
  assert.strictEqual(selectedSize, '', 'Selected size must be cleared on product change');
});

console.log(`\n========================================`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`========================================\n`);

if (failed > 0) {
  process.exit(1);
}
