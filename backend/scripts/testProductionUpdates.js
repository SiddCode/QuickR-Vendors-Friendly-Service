// Node 18+ built-in fetch used

const BASE_URL = 'http://localhost:53211';

async function runProductionUpdatesSuite() {
  console.log('====================================================');
  console.log('🧪 QUICKR — PRODUCTION UPDATES AUTOMATED TEST SUITE');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    // 1. Login to obtain session cookie
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ram@gmail.com', password: 'testpass123' })
    });
    assert(loginRes.status === 200, 'Authentication successful');
    const setCookie = loginRes.headers.get('set-cookie');
    const cookie = setCookie ? setCookie.split(';')[0] : '';

    // ──────────────────────────────────────────────────────────────────────────
    // UPDATE 2 TESTS — BILLING DISCOUNT (TESTS 1 to 10)
    // ──────────────────────────────────────────────────────────────────────────

    // TEST 1: Subtotal ₹800, Percentage 10% -> Discount ₹80, Final ₹720
    const sale1Res = await fetch(`${BASE_URL}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
      body: JSON.stringify({
        items: [{ productName: 'Casual Shirt', quantity: 2, rate: 400, total: 800 }],
        subtotal: 800,
        discount: 10,
        discountType: 'percentage',
        totalAmount: 720,
        paymentMethod: 'Cash'
      })
    });
    const sale1Data = await sale1Res.json();
    assert(sale1Res.status === 200 || sale1Res.status === 201, 'TEST 1: Percentage 10% sale created successfully');
    assert(sale1Data.sale?.discount === 80, 'TEST 1: Calculated discount amount is ₹80');
    assert(sale1Data.sale?.totalAmount === 720, 'TEST 1: Calculated total amount is ₹720');

    // TEST 2: Subtotal ₹800, Amount ₹50 -> Discount ₹50, Final ₹750
    const sale2Res = await fetch(`${BASE_URL}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
      body: JSON.stringify({
        items: [{ productName: 'Denim Jeans', quantity: 1, rate: 800, total: 800 }],
        subtotal: 800,
        discount: 50,
        discountType: 'amount',
        totalAmount: 750,
        paymentMethod: 'UPI'
      })
    });
    const sale2Data = await sale2Res.json();
    assert(sale2Res.status === 200 || sale2Res.status === 201, 'TEST 2: Amount ₹50 sale created successfully');
    assert(sale2Data.sale?.discount === 50, 'TEST 2: Calculated discount amount is ₹50');
    assert(sale2Data.sale?.totalAmount === 750, 'TEST 2: Calculated total amount is ₹750');

    // TEST 3: Subtotal ₹800, Amount ₹800 -> Final ₹0
    const sale3Res = await fetch(`${BASE_URL}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
      body: JSON.stringify({
        items: [{ productName: 'Cotton T-Shirt', quantity: 2, rate: 400, total: 800 }],
        subtotal: 800,
        discount: 800,
        discountType: 'amount',
        totalAmount: 0,
        paymentMethod: 'Cash'
      })
    });
    const sale3Data = await sale3Res.json();
    assert(sale3Data.sale?.totalAmount === 0, 'TEST 3: Subtotal ₹800 with ₹800 amount discount results in Final ₹0');

    // TEST 4: Subtotal ₹800, Amount ₹900 -> Rejected with error (amount cannot exceed subtotal)
    const sale4Res = await fetch(`${BASE_URL}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
      body: JSON.stringify({
        items: [{ productName: 'Summer Dress', quantity: 1, rate: 800, total: 800 }],
        subtotal: 800,
        discount: 900,
        discountType: 'amount',
        totalAmount: -100,
        paymentMethod: 'Cash'
      })
    });
    assert(sale4Res.status === 400, 'TEST 4: Discount amount > subtotal rejected with 400 error');

    // TEST 5: Percentage 100% -> Final ₹0
    const sale5Res = await fetch(`${BASE_URL}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
      body: JSON.stringify({
        items: [{ productName: 'Kurtis', quantity: 1, rate: 500, total: 500 }],
        subtotal: 500,
        discount: 100,
        discountType: 'percentage',
        totalAmount: 0,
        paymentMethod: 'Cash'
      })
    });
    const sale5Data = await sale5Res.json();
    assert(sale5Data.sale?.totalAmount === 0, 'TEST 5: 100% percentage discount results in Final ₹0');

    // TEST 6: Percentage > 100% -> Rejected with error
    const sale6Res = await fetch(`${BASE_URL}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
      body: JSON.stringify({
        items: [{ productName: 'Silk Saree', quantity: 1, rate: 1000, total: 1000 }],
        subtotal: 1000,
        discount: 150,
        discountType: 'percentage',
        totalAmount: -500,
        paymentMethod: 'Cash'
      })
    });
    assert(sale6Res.status === 400, 'TEST 6: Percentage discount > 100% rejected with 400 error');

    // TEST 7: Negative discount -> Rejected with error
    const sale7Res = await fetch(`${BASE_URL}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
      body: JSON.stringify({
        items: [{ productName: 'Jacket', quantity: 1, rate: 1000, total: 1000 }],
        subtotal: 1000,
        discount: -50,
        discountType: 'amount',
        totalAmount: 1050,
        paymentMethod: 'Cash'
      })
    });
    assert(sale7Res.status === 400, 'TEST 7: Negative discount rejected with 400 error');

    // ──────────────────────────────────────────────────────────────────────────
    // UPDATE 1 TESTS — EXCEL SALES REPORT EXPORT (TESTS 12 to 15)
    // ──────────────────────────────────────────────────────────────────────────
    const exportRes = await fetch(`${BASE_URL}/api/sales/export?period=today`, {
      headers: { 'Cookie': cookie }
    });
    assert(exportRes.status === 200, 'TEST 12: Sales Excel report export API returned 200 OK');
    const contentType = exportRes.headers.get('content-type');
    assert(contentType && contentType.includes('spreadsheetml'), 'TEST 12b: Export returns valid .xlsx binary buffer');

    console.log('\n====================================================');
    console.log(`SUMMARY: ${passed} Passed, ${failed} Failed`);
    console.log('====================================================\n');

  } catch (err) {
    console.error('Test execution error:', err.message);
  }
}

runProductionUpdatesSuite();
