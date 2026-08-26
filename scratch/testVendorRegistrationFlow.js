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

async function verifyVendorRegistrationFlow() {
  console.log('\n===============================================================');
  console.log('🧪 QuickR — Start Using QuickR Vendor Registration Flow Test');
  console.log('===============================================================\n');

  const port = 53211;

  const extractToken = (res) => {
    if (res.body?.token) return res.body.token;
    const cookieHeader = (res.cookies || []).find(c => c.startsWith('token='));
    return cookieHeader ? cookieHeader.split(';')[0].split('=')[1] : null;
  };

  const vendorPhone = `98${Math.floor(10000000 + Math.random() * 90000000)}`;
  const vendorEmail = `vendor_${Date.now()}@quickrfashion.com`;
  const vendorPassword = `VendorCustomPass#${Math.floor(1000 + Math.random() * 9000)}`;

  // 1. Send OTP
  console.log(`1️⃣ Vendor clicks Send OTP for Mobile: ${vendorPhone}`);
  const sendRes = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/auth/send-otp', method: 'POST'
  }, { phone: vendorPhone, purpose: 'shop_creation' });

  if (sendRes.statusCode !== 200 || !sendRes.body.devOtp) {
    console.error('❌ Send OTP failed:', sendRes.body);
    process.exit(1);
  }
  const devOtp = sendRes.body.devOtp;
  console.log(`  ✅ OTP received in DEV ONLY mode: ${devOtp}`);

  // 2. Verify OTP
  console.log('\n2️⃣ Vendor verifies OTP...');
  const verifyRes = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/auth/verify-otp', method: 'POST'
  }, { phone: vendorPhone, otp: devOtp, purpose: 'shop_creation' });

  if (verifyRes.statusCode !== 200 || !verifyRes.body.otpVerificationToken) {
    console.error('❌ OTP Verification failed:', verifyRes.body);
    process.exit(1);
  }
  const token = verifyRes.body.otpVerificationToken;
  console.log('  ✅ Mobile number verified! Signed token issued.');

  // 3. Submit Subscription Request with Owner-Created Password
  console.log('\n3️⃣ Submitting Request QuickR Access with Owner-Created Password...');
  const subRes = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/subscription-requests', method: 'POST'
  }, {
    name: 'Ananya Sharma',
    shopName: 'Ananya Fashion Hub',
    phone: vendorPhone,
    email: vendorEmail,
    password: vendorPassword,
    otpVerificationToken: token,
    requestedPlan: 'Standard',
    message: 'We handle 50+ retail enquiries daily.'
  });

  if (subRes.statusCode !== 201) {
    console.error('❌ Subscription submission failed:', subRes.body);
    process.exit(1);
  }
  console.log(`  ✅ Subscription request submitted! Message: "${subRes.body.message}"`);

  // 4. Admin Login & Get Pending Subscription Requests
  console.log('\n4️⃣ Admin logs in & reviews pending subscription requests...');
  const adminLogin = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/auth/login', method: 'POST'
  }, { email: 'admin@quickr.com', password: 'admin123' });

  const adminToken = extractToken(adminLogin);
  const adminHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` };
  const adminCookie = `token=${adminToken}`;

  const requestsRes = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/admin/subscription-requests', method: 'GET', headers: adminHeaders
  }, null, adminCookie);

  const pendingReq = (requestsRes.body || []).find(r => r.email === vendorEmail);
  if (!pendingReq) {
    console.error('❌ Submitted subscription request not found on Admin dashboard');
    process.exit(1);
  }
  console.log(`  ✅ Found pending request in Admin: ID=${pendingReq.id}, Shop=${pendingReq.shopName}, Phone=${pendingReq.phone}`);

  // 5. Admin Approves Subscription Request
  console.log('\n5️⃣ Admin approves subscription request...');
  const approveRes = await makeRequest({
    hostname: '127.0.0.1', port, path: `/api/admin/subscription-requests/${pendingReq.id}/approve`, method: 'PATCH', headers: adminHeaders
  }, { adminNotes: 'Approved during test' }, adminCookie);

  if (approveRes.statusCode !== 200) {
    console.error('❌ Admin approval failed:', approveRes.body);
    process.exit(1);
  }
  console.log(`  ✅ Request approved! Shop Created ID: ${approveRes.body.shop.customId}`);

  // 6. Vendor Login with Created Password
  console.log(`\n6️⃣ Vendor attempts login using email (${vendorEmail}) and created password (${vendorPassword})...`);
  const vendorLogin = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/auth/login', method: 'POST'
  }, { email: vendorEmail, password: vendorPassword });

  if (vendorLogin.statusCode === 200 && vendorLogin.body.user) {
    console.log(`  ✅ Vendor Login Successful! User Role: ${vendorLogin.body.user.role}, Shop ID: ${vendorLogin.body.user.shopId}`);
  } else {
    console.error('  ❌ Vendor Login failed:', vendorLogin.body);
    process.exit(1);
  }

  // 7. Verify Incorrect Password Fails
  console.log('\n7️⃣ Testing incorrect password rejection...');
  const wrongLogin = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/auth/login', method: 'POST'
  }, { email: vendorEmail, password: 'WrongPassword#123' });

  if (wrongLogin.statusCode === 401) {
    console.log('  ✅ Incorrect password correctly rejected (401 Unauthorized)');
  } else {
    console.error('  ❌ Incorrect password was not rejected!');
    process.exit(1);
  }

  console.log('\n✨ ALL VENDOR REGISTRATION & AUTHENTICATION FLOW TESTS PASSED!\n');
}

verifyVendorRegistrationFlow().catch(err => {
  console.error('Verification error:', err);
  process.exit(1);
});
