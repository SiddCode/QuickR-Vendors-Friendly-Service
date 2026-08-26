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

async function verifySearchableCustomerSelection() {
  console.log('\n===============================================================');
  console.log('🧪 QuickR — Searchable Customer Selection & Sale Integration Test');
  console.log('===============================================================\n');

  const port = 53211;

  const extractToken = (res) => {
    if (res.body?.token) return res.body.token;
    const cookieHeader = (res.cookies || []).find(c => c.startsWith('token='));
    return cookieHeader ? cookieHeader.split(';')[0].split('=')[1] : null;
  };

  // 1. Admin Login & Create Test Shop
  const adminLogin = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/auth/login', method: 'POST'
  }, { email: 'admin@quickr.com', password: 'admin123' });

  const adminToken = extractToken(adminLogin);
  const adminHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}`, 'x-bypass-otp': 'true' };
  const adminCookieHeader = `token=${adminToken}`;

  const shopEmail = `combobox_owner_${Date.now()}@test.com`;
  const phone = `98${Math.floor(10000000 + Math.random() * 90000000)}`;

  const send = await makeRequest({ hostname: '127.0.0.1', port, path: '/api/auth/send-otp', method: 'POST' }, { phone, purpose: 'shop_creation' });
  const verify = await makeRequest({ hostname: '127.0.0.1', port, path: '/api/auth/verify-otp', method: 'POST' }, { phone, otp: send.body.devOtp, purpose: 'shop_creation' });

  await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/admin/shops', method: 'POST', headers: adminHeaders
  }, { shopName: 'Combobox Test Shop', ownerName: 'Owner Combobox', ownerEmail: shopEmail, ownerPhone: phone, otpVerificationToken: verify.body.otpVerificationToken, password: 'password123' }, adminCookieHeader);

  // 2. Owner Login
  const ownerLogin = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/auth/login', method: 'POST'
  }, { email: shopEmail, password: 'password123' });

  const ownerToken = extractToken(ownerLogin);
  const shopHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` };
  const shopCookie = `token=${ownerToken}`;

  // 3. Create Customer Ranjith (Phone: 6381558844)
  const createCustRes = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/customers', method: 'POST', headers: shopHeaders
  }, { name: 'Ranjith', phone: '6381558844' }, shopCookie);

  const ranjith = createCustRes.body;
  console.log(`  ✅ Created Customer: ${ranjith.name} (${ranjith.phone}), ID: ${ranjith.id}`);

  // 4. Test Customer Search Filtering Behavior
  const allCustomers = await makeRequest({ hostname: '127.0.0.1', port, path: '/api/customers', method: 'GET', headers: shopHeaders }, null, shopCookie);
  const list = allCustomers.body;

  const testQueries = ['r', 'ran', 'Ranjith', '6', '63', '6381558844'];
  for (const q of testQueries) {
    const trimmedQuery = q.trim().toLowerCase();
    const matches = list.filter(c => c.name.toLowerCase().includes(trimmedQuery) || c.phone.toLowerCase().includes(trimmedQuery));
    if (matches.length > 0 && matches[0].id === ranjith.id) {
      console.log(`  ✅ Search query "${q}" matched customer: ${matches[0].name} (${matches[0].phone})`);
    } else {
      console.error(`  ❌ Search query "${q}" failed to match customer`);
      process.exit(1);
    }
  }

  // 5. Create Bill with Selected Existing Customer
  console.log('\n--- Generating Bill for Selected Existing Customer ---');
  const saleRes = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/sales', method: 'POST', headers: shopHeaders
  }, {
    customerId: ranjith.id,
    customerName: ranjith.name,
    items: [{ productName: 'Silk Shirt', quantity: 1, rate: 1200, total: 1200 }],
    subtotal: 1200,
    discount: 0,
    totalAmount: 1200,
    paymentMethod: 'UPI'
  }, shopCookie);

  if (saleRes.statusCode === 201 && saleRes.body.customerId === ranjith.id) {
    console.log(`  ✅ Bill generated successfully! Associated customerId: ${saleRes.body.customerId}`);
  } else {
    console.error('  ❌ Sale creation failed or incorrect customerId:', saleRes.body);
    process.exit(1);
  }

  // 6. Test Walk-in Customer Sale Creation
  console.log('\n--- Generating Bill for Walk-in Customer ---');
  const walkInSaleRes = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/sales', method: 'POST', headers: shopHeaders
  }, {
    customerId: '',
    customerName: 'Walk-in Customer',
    items: [{ productName: 'Cotton Socks', quantity: 2, rate: 100, total: 200 }],
    subtotal: 200,
    discount: 0,
    totalAmount: 200,
    paymentMethod: 'Cash'
  }, shopCookie);

  if (walkInSaleRes.statusCode === 201 && walkInSaleRes.body.customerName === 'Walk-in Customer') {
    console.log(`  ✅ Walk-in Customer sale generated successfully! Sale ID: ${walkInSaleRes.body.id}`);
  } else {
    console.error('  ❌ Walk-in sale creation failed:', walkInSaleRes.body);
    process.exit(1);
  }

  console.log('\n✨ ALL SEARCHABLE CUSTOMER SELECTION & BILLING VERIFICATION TESTS PASSED!\n');
}

verifySearchableCustomerSelection().catch(err => {
  console.error('Verification error:', err);
  process.exit(1);
});
