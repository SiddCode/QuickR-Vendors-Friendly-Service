import http from 'http';

function makeRequest(options, postData, cookie = '') {
  return new Promise((resolve, reject) => {
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...(cookie ? { 'Cookie': cookie } : {}),
      ...(options.headers || {})
    };
    const req = http.request({
      ...options,
      headers: reqHeaders
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(data), headers: res.headers, cookies: res.headers['set-cookie'] || [] });
        } catch (e) {
          resolve({ statusCode: res.statusCode, body: data, headers: res.headers, cookies: res.headers['set-cookie'] || [] });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(JSON.stringify(postData));
    req.end();
  });
}

async function verifyReengagementTestMode() {
  console.log('\n===============================================================');
  console.log('🧪 QuickR — Customer Re-Engagement TEST MODE Verification Suite');
  console.log('===============================================================\n');

  const port = 53211;

  const extractToken = (res) => {
    if (res.body?.token) return res.body.token;
    const cookieHeader = (res.cookies || []).find(c => c.startsWith('token='));
    return cookieHeader ? cookieHeader.split(';')[0].split('=')[1] : null;
  };

  // 1. Create Shop & Owner
  const adminLogin = await makeRequest({ hostname: '127.0.0.1', port, path: '/api/auth/login', method: 'POST' }, { email: 'admin@quickr.com', password: 'admin123' });
  const adminToken = extractToken(adminLogin);
  const adminHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}`, 'x-bypass-otp': 'true' };
  const adminCookie = `token=${adminToken}`;

  const shopEmail = `reengage_owner_${Date.now()}@test.com`;
  const phone = `98${Math.floor(10000000 + Math.random() * 90000000)}`;

  const send = await makeRequest({ hostname: '127.0.0.1', port, path: '/api/auth/send-otp', method: 'POST' }, { phone, purpose: 'shop_creation' });
  const verify = await makeRequest({ hostname: '127.0.0.1', port, path: '/api/auth/verify-otp', method: 'POST' }, { phone, otp: send.body.devOtp, purpose: 'shop_creation' });

  await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/admin/shops', method: 'POST', headers: adminHeaders
  }, { shopName: 'Reengagement Test Shop', ownerName: 'Owner Reengage', ownerEmail: shopEmail, ownerPhone: phone, otpVerificationToken: verify.body.otpVerificationToken, password: 'password123' }, adminCookie);

  const ownerLogin = await makeRequest({ hostname: '127.0.0.1', port, path: '/api/auth/login', method: 'POST' }, { email: shopEmail, password: 'password123' });
  const ownerToken = extractToken(ownerLogin);
  const shopHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` };
  const shopCookie = `token=${ownerToken}`;

  // 2. Create Products
  const prodRes = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/products', method: 'POST', headers: shopHeaders
  }, { name: 'Polo T-Shirt', category: 'Apparel', sellingPrice: 999, costPrice: 499, stockQuantity: 50, isActive: true }, shopCookie);
  const tshirt = prodRes.body;

  // 3. Create Customers: Ranjith (Today Sale) & Yesterday Customer
  const ranjithRes = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/customers', method: 'POST', headers: shopHeaders
  }, { name: 'Ranjith', phone: '6381558844' }, shopCookie);
  const ranjith = ranjithRes.body;

  // Create Sale TODAY for Ranjith
  await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/sales', method: 'POST', headers: shopHeaders
  }, {
    customerId: ranjith.id,
    customerName: ranjith.name,
    items: [{ productId: tshirt.id, productName: tshirt.name, quantity: 1, rate: 999, total: 999 }],
    subtotal: 999,
    discount: 0,
    totalAmount: 999,
    paymentMethod: 'UPI'
  }, shopCookie);

  console.log(`  ✅ Sale created TODAY for customer: ${ranjith.name} (${ranjith.phone})`);

  // 4. TEST 1: TEST — Purchased Today
  console.log('\n--- TEST 1: TEST — Purchased Today ---');
  const todaySummary = await makeRequest({ hostname: '127.0.0.1', port, path: '/api/reengagement/summary?days=TEST_TODAY', method: 'GET', headers: shopHeaders }, null, shopCookie);
  const todayCusts = await makeRequest({ hostname: '127.0.0.1', port, path: '/api/reengagement/customers?days=TEST_TODAY', method: 'GET', headers: shopHeaders }, null, shopCookie);

  if (todaySummary.body.potentialCustomers === 1 && todayCusts.body.customers.length === 1 && todayCusts.body.customers[0].id === ranjith.id) {
    console.log(`  ✅ TEST — Purchased Today matched customer Ranjith! Potential: ${todaySummary.body.potentialCustomers}, WhatsApp Eligible: ${todaySummary.body.whatsappEligible}`);
  } else {
    console.error('  ❌ TEST — Purchased Today failed:', todaySummary.body, todayCusts.body);
    process.exit(1);
  }

  // 5. TEST 2: Product Filter Combination
  console.log('\n--- TEST 2: TEST — Purchased Today + Product Filter ---');
  const prodFiltered = await makeRequest({ hostname: '127.0.0.1', port, path: `/api/reengagement/customers?days=TEST_TODAY&productId=${tshirt.id}`, method: 'GET', headers: shopHeaders }, null, shopCookie);
  if (prodFiltered.body.customers.length === 1 && prodFiltered.body.customers[0].lastPurchasedProduct === tshirt.name) {
    console.log(`  ✅ Product filter combined with TEST MODE successfully: ${prodFiltered.body.customers[0].lastPurchasedProduct}`);
  } else {
    console.error('  ❌ Product filter combination failed:', prodFiltered.body);
    process.exit(1);
  }

  // 6. TEST 3: Permission & Mobile Filtering Rules
  console.log('\n--- TEST 3: Permission & Phone Filtering in TEST MODE ---');
  const phoneFiltered = await makeRequest({ hostname: '127.0.0.1', port, path: '/api/reengagement/customers?days=TEST_TODAY&phone=NO_PHONE', method: 'GET', headers: shopHeaders }, null, shopCookie);
  if (phoneFiltered.body.customers.length === 0) {
    console.log('  ✅ Phone availability filter (NO_PHONE) correctly excluded Ranjith (has phone)');
  } else {
    console.error('  ❌ Phone filter failed:', phoneFiltered.body);
    process.exit(1);
  }

  // 7. TEST 4: Data Non-Destruction Check
  console.log('\n--- TEST 4: Non-Destruction Check ---');
  const checkRanjith = await makeRequest({ hostname: '127.0.0.1', port, path: `/api/customers/${ranjith.id}`, method: 'GET', headers: shopHeaders }, null, shopCookie);
  if (checkRanjith.body.totalPurchases === 1 && checkRanjith.body.totalSpending === 999) {
    console.log(`  ✅ MongoDB customer record intact! totalPurchases: ${checkRanjith.body.totalPurchases}, totalSpending: ${checkRanjith.body.totalSpending}`);
  } else {
    console.error('  ❌ Customer record was unexpectedly mutated:', checkRanjith.body);
    process.exit(1);
  }

  console.log('\n✨ ALL CUSTOMER RE-ENGAGEMENT TEST MODE VERIFICATION TESTS PASSED!\n');
}

verifyReengagementTestMode().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
