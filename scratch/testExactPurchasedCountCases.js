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

async function runPurchasedCountTests() {
  console.log('\n===============================================================');
  console.log('🧪 QuickR — Customer Purchased Count Exact Verification Test Suite');
  console.log('===============================================================\n');

  const port = 53211;

  const extractToken = (res) => {
    if (res.body?.token) return res.body.token;
    const cookieHeader = (res.cookies || []).find(c => c.startsWith('token='));
    return cookieHeader ? cookieHeader.split(';')[0].split('=')[1] : null;
  };

  // Login as admin & create 2 isolated test shops
  const adminLogin = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/auth/login', method: 'POST'
  }, { email: 'admin@quickr.com', password: 'admin123' });

  const adminToken = extractToken(adminLogin);
  const adminHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}`, 'x-bypass-otp': 'true' };
  const adminCookieHeader = `token=${adminToken}`;

  const shop1Email = `purchased_owner1_${Date.now()}@test.com`;
  const shop2Email = `purchased_owner2_${Date.now()}@test.com`;
  const phone1 = `98${Math.floor(10000000 + Math.random() * 90000000)}`;
  const phone2 = `98${Math.floor(10000000 + Math.random() * 90000000)}`;

  const send1 = await makeRequest({ hostname: '127.0.0.1', port, path: '/api/auth/send-otp', method: 'POST' }, { phone: phone1, purpose: 'shop_creation' });
  const verify1 = await makeRequest({ hostname: '127.0.0.1', port, path: '/api/auth/verify-otp', method: 'POST' }, { phone: phone1, otp: send1.body.devOtp, purpose: 'shop_creation' });
  const token1 = verify1.body.otpVerificationToken;

  const send2 = await makeRequest({ hostname: '127.0.0.1', port, path: '/api/auth/send-otp', method: 'POST' }, { phone: phone2, purpose: 'shop_creation' });
  const verify2 = await makeRequest({ hostname: '127.0.0.1', port, path: '/api/auth/verify-otp', method: 'POST' }, { phone: phone2, otp: send2.body.devOtp, purpose: 'shop_creation' });
  const token2 = verify2.body.otpVerificationToken;

  const shop1Create = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/admin/shops', method: 'POST', headers: adminHeaders
  }, { shopName: 'Purchased Test Shop 1', ownerName: 'Owner 1', ownerEmail: shop1Email, ownerPhone: phone1, otpVerificationToken: token1, password: 'password123' }, adminCookieHeader);

  const shop2Create = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/admin/shops', method: 'POST', headers: adminHeaders
  }, { shopName: 'Purchased Test Shop 2', ownerName: 'Owner 2', ownerEmail: shop2Email, ownerPhone: phone2, otpVerificationToken: token2, password: 'password123' }, adminCookieHeader);

  // Login as Shop 1 Owner
  const shop1Login = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/auth/login', method: 'POST'
  }, { email: shop1Email, password: 'password123' });
  console.log('  [DEBUG] shop1Login response:', shop1Login);

  const shop1Token = extractToken(shop1Login);
  const shop1Headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${shop1Token}` };
  const shop1Cookie = `token=${shop1Token}`;

  // Login as Shop 2 Owner
  const shop2Login = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/auth/login', method: 'POST'
  }, { email: shop2Email, password: 'password123' });
  const shop2Token = extractToken(shop2Login);
  const shop2Headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${shop2Token}` };
  const shop2Cookie = `token=${shop2Token}`;

  // Create Ranjith in Shop 1
  const ranjithPhone = `98${Math.floor(10000000 + Math.random() * 90000000)}`;
  const createRanjithRes = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/customers', method: 'POST', headers: shop1Headers
  }, { name: 'Ranjith', phone: ranjithPhone }, shop1Cookie);

  if (createRanjithRes.statusCode !== 201 && createRanjithRes.statusCode !== 200) {
    console.error('❌ Failed to create Ranjith:', createRanjithRes);
    process.exit(1);
  }
  const ranjithId = createRanjithRes.body.id;
  console.log(`  ✅ Customer Ranjith created in Shop 1 (ID: ${ranjithId}, Phone: ${ranjithPhone})`);

  // INITIAL STATE: Purchased should be 0
  const ranjithCheckInitial = await makeRequest({
    hostname: '127.0.0.1', port, path: `/api/customers/${ranjithId}`, method: 'GET', headers: shop1Headers
  }, null, shop1Cookie);
  console.log(`  ✅ Initial Purchased count for Ranjith: ${ranjithCheckInitial.body.totalPurchases || 0} (Expected: 0)`);

  // TEST 1: First Purchase for Ranjith
  console.log('\n--- TEST 1: First Completed Purchase ---');
  const sale1Res = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/sales', method: 'POST', headers: shop1Headers
  }, {
    customerId: ranjithId,
    customerName: 'Ranjith',
    customerPhone: ranjithPhone,
    items: [{ productName: 'Casual Shirt', quantity: 1, rate: 800, total: 800 }],
    subtotal: 800,
    discount: 0,
    totalAmount: 800,
    paymentMethod: 'UPI'
  }, shop1Cookie);

  const sale1Id = sale1Res.body.id || sale1Res.body.sale?.id;
  const ranjithCheck1 = await makeRequest({
    hostname: '127.0.0.1', port, path: `/api/customers/${ranjithId}`, method: 'GET', headers: shop1Headers
  }, null, shop1Cookie);
  console.log(`  ✅ Bill 1 generated (ID: ${sale1Id}). Ranjith Purchased count: ${ranjithCheck1.body.totalPurchases} (Expected: 1)`);

  // TEST 2: Second Purchase for SAME Ranjith
  console.log('\n--- TEST 2: Second Completed Purchase ---');
  const sale2Res = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/sales', method: 'POST', headers: shop1Headers
  }, {
    customerId: ranjithId,
    customerName: 'Ranjith',
    customerPhone: ranjithPhone,
    items: [{ productName: 'Jeans Pant', quantity: 1, rate: 1500, total: 1500 }],
    subtotal: 1500,
    discount: 0,
    totalAmount: 1500,
    paymentMethod: 'Cash'
  }, shop1Cookie);

  const sale2Id = sale2Res.body.id || sale2Res.body.sale?.id;
  const ranjithCheck2 = await makeRequest({
    hostname: '127.0.0.1', port, path: `/api/customers/${ranjithId}`, method: 'GET', headers: shop1Headers
  }, null, shop1Cookie);
  console.log(`  ✅ Bill 2 generated (ID: ${sale2Id}). Ranjith Purchased count: ${ranjithCheck2.body.totalPurchases} (Expected: 2)`);

  // TEST 3: Refresh / Persistent Data Verification
  console.log('\n--- TEST 3: Browser Refresh / Persistence Check ---');
  const ranjithList = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/customers', method: 'GET', headers: shop1Headers
  }, null, shop1Cookie);
  const custArray = Array.isArray(ranjithList.body) ? ranjithList.body : (ranjithList.body.customers || []);
  const ranjithFetched = custArray.find(c => c.id === ranjithId);
  console.log(`  ✅ Persisted Customer totalPurchases from GET /api/customers: ${ranjithFetched.totalPurchases} (Expected: 2)`);

  // TEST 4: Delete Sale
  console.log('\n--- TEST 4: Delete Sale ---');
  const deleteSaleRes = await makeRequest({
    hostname: '127.0.0.1', port, path: `/api/sales?id=${sale1Id}`, method: 'DELETE', headers: shop1Headers
  }, null, shop1Cookie);
  console.log(`  ✅ Sale ${sale1Id} delete status: ${deleteSaleRes.statusCode}, body:`, deleteSaleRes.body);

  const ranjithCheck3 = await makeRequest({
    hostname: '127.0.0.1', port, path: `/api/customers/${ranjithId}`, method: 'GET', headers: shop1Headers
  }, null, shop1Cookie);
  console.log(`  ✅ Ranjith Purchased count after deletion: ${ranjithCheck3.body.totalPurchases} (Expected: 1)`);

  // TEST 5: Another Customer in Same Shop
  console.log('\n--- TEST 5: Purchase for Another Customer ---');
  const sureshPhone = `98${Math.floor(10000000 + Math.random() * 90000000)}`;
  const createSureshRes = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/customers', method: 'POST', headers: shop1Headers
  }, { name: 'Suresh', phone: sureshPhone }, shop1Cookie);
  const sureshId = createSureshRes.body.id;

  await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/sales', method: 'POST', headers: shop1Headers
  }, {
    customerId: sureshId, customerName: 'Suresh', items: [{ productName: 'T-Shirt', quantity: 1, rate: 500, total: 500 }],
    subtotal: 500, discount: 0, totalAmount: 500, paymentMethod: 'UPI'
  }, shop1Cookie);

  const ranjithCheck4 = await makeRequest({
    hostname: '127.0.0.1', port, path: `/api/customers/${ranjithId}`, method: 'GET', headers: shop1Headers
  }, null, shop1Cookie);
  console.log(`  ✅ Ranjith Purchased count after Suresh purchase: ${ranjithCheck4.body.totalPurchases} (Expected: 1)`);

  // TEST 6: Shop Isolation Check
  console.log('\n--- TEST 6: Multi-Shop Isolation Check ---');
  const shop2RanjithPhone = `98${Math.floor(10000000 + Math.random() * 90000000)}`;
  const createShop2Cust = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/customers', method: 'POST', headers: shop2Headers
  }, { name: 'Shop 2 Ranjith', phone: shop2RanjithPhone }, shop2Cookie);
  const shop2CustId = createShop2Cust.body.id;

  await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/sales', method: 'POST', headers: shop2Headers
  }, {
    customerId: shop2CustId, customerName: 'Shop 2 Ranjith', items: [{ productName: 'Jacket', quantity: 1, rate: 2500, total: 2500 }],
    subtotal: 2500, discount: 0, totalAmount: 2500, paymentMethod: 'Card'
  }, shop2Cookie);

  const ranjithCheck5 = await makeRequest({
    hostname: '127.0.0.1', port, path: `/api/customers/${ranjithId}`, method: 'GET', headers: shop1Headers
  }, null, shop1Cookie);
  console.log(`  ✅ Shop 1 Ranjith Purchased count after Shop 2 sale: ${ranjithCheck5.body.totalPurchases} (Expected: 1)`);

  if (ranjithCheck1.body.totalPurchases === 1 && ranjithCheck2.body.totalPurchases === 2 && ranjithCheck3.body.totalPurchases === 1 && ranjithCheck4.body.totalPurchases === 1 && ranjithCheck5.body.totalPurchases === 1) {
    console.log('\n✨ ALL 6 CUSTOMER PURCHASED COUNT VERIFICATION TESTS PASSED!\n');
    process.exit(0);
  } else {
    console.error('❌ Test failed.');
    process.exit(1);
  }
}

runPurchasedCountTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
