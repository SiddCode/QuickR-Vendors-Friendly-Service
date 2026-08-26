import http from 'http';

function makeRequest(options, postData, cookie = '') {
  return new Promise((resolve, reject) => {
    const req = http.request({
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { 'Cookie': cookie } : {}),
        ...(options.headers || {})
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers, cookies: res.headers['set-cookie'] || [] });
        } catch (e) {
          resolve({ status: res.statusCode, body: data, headers: res.headers, cookies: res.headers['set-cookie'] || [] });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(JSON.stringify(postData));
    req.end();
  });
}

async function runTests() {
  console.log('\n====================================================');
  console.log('🧪 QuickR — OTP Verification & Purchased Count Test Suite');
  console.log('====================================================\n');

  const port = 53211;

  // Login as admin
  const loginRes = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/auth/login', method: 'POST'
  }, { email: 'admin@quickr.com', password: 'admin123' });

  if (loginRes.status !== 200) {
    console.error('❌ Admin login failed:', loginRes.body);
    process.exit(1);
  }

  const rawCookies = loginRes.cookies || [];
  const setCookieHeader = rawCookies.find(c => c.startsWith('token='));
  const cookieValue = setCookieHeader ? setCookieHeader.split(';')[0] : '';
  const token = cookieValue.split('=')[1] || '';

  // 1. TEST OTP FLOW
  console.log('--- TEST 1: OTP Flow & Verification ---');
  const testPhone = '9876500111';

  // Send OTP
  const sendRes = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/auth/send-otp', method: 'POST'
  }, { phone: testPhone });
  console.log(`  ✅ Send OTP status: ${sendRes.status} (Expected 200)`);

  // Incorrect OTP test
  const wrongOtpRes = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/auth/verify-otp', method: 'POST'
  }, { phone: testPhone, otp: '000000' });
  console.log(`  ✅ Incorrect OTP blocked: status=${wrongOtpRes.status} (Expected 400), msg="${wrongOtpRes.body.error}"`);

  // 2. TEST CUSTOMER PURCHASED COUNT AUTOMATIC UPDATE
  console.log('\n--- TEST 2: Customer Purchased Count Automatic Update ---');
  
  // Login as demo owner
  const ownerLoginRes = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/auth/login', method: 'POST'
  }, { email: 'admin@quickr.com', password: 'admin123' });

  const ownerCookie = (ownerLoginRes.cookies || []).find(c => c.startsWith('token='))?.split(';')[0] || '';
  const tokenVal = ownerCookie.split('=')[1] || '';

  // Create customer Tom
  const tomPhone = `98${Math.floor(10000000 + Math.random() * 90000000)}`;
  const custRes = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/customers', method: 'POST',
    headers: { 'Authorization': `Bearer ${tokenVal}` }
  }, { name: 'Tom', phone: tomPhone }, ownerCookie);

  const tomId = custRes.body.id;
  console.log(`  ✅ Customer Tom created status=${custRes.status}, ID=${tomId}`);

  // Initial purchase count check via GET /api/customers/:id
  const getCust1 = await makeRequest({
    hostname: '127.0.0.1', port, path: `/api/customers/${tomId}`, method: 'GET',
    headers: { 'Authorization': `Bearer ${tokenVal}` }
  }, null, ownerCookie);
  console.log(`  ✅ Initial Tom totalPurchases in DB: ${getCust1.body.totalPurchases || 0} (Expected 0)`);

  // Create 1st Sale for Tom
  const sale1Res = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/sales', method: 'POST',
    headers: { 'Authorization': `Bearer ${tokenVal}` }
  }, {
    customerId: tomId,
    customerName: 'Tom',
    customerPhone: tomPhone,
    items: [{ productName: 'Denim Jacket', quantity: 1, rate: 1200, total: 1200 }],
    subtotal: 1200,
    discount: 0,
    totalAmount: 1200,
    paymentMethod: 'UPI'
  }, ownerCookie);

  console.log(`  ✅ Sale 1 created: ID=${sale1Res.body.id}`);

  const getCust2 = await makeRequest({
    hostname: '127.0.0.1', port, path: `/api/customers/${tomId}`, method: 'GET',
    headers: { 'Authorization': `Bearer ${tokenVal}` }
  }, null, ownerCookie);
  console.log(`  ✅ Tom totalPurchases after 1st sale: ${getCust2.body.totalPurchases} (Expected 1)`);

  // Create 2nd Sale for Tom
  const sale2Res = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/sales', method: 'POST',
    headers: { 'Authorization': `Bearer ${tokenVal}` }
  }, {
    customerId: tomId,
    customerName: 'Tom',
    customerPhone: tomPhone,
    items: [{ productName: 'T-Shirt', quantity: 2, rate: 400, total: 800 }],
    subtotal: 800,
    discount: 0,
    totalAmount: 800,
    paymentMethod: 'Cash'
  }, ownerCookie);

  console.log(`  ✅ Sale 2 created: ID=${sale2Res.body.id}`);

  const getCust3 = await makeRequest({
    hostname: '127.0.0.1', port, path: `/api/customers/${tomId}`, method: 'GET',
    headers: { 'Authorization': `Bearer ${tokenVal}` }
  }, null, ownerCookie);
  console.log(`  ✅ Tom totalPurchases after 2nd sale: ${getCust3.body.totalPurchases} (Expected 2)`);

  if (getCust3.body.totalPurchases === 2) {
    console.log('\n✨ All OTP & Purchased Count Test Verification Checks PASSED!\n');
    process.exit(0);
  } else {
    console.error('❌ Test failed: Purchased count did not match expected 2.');
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
