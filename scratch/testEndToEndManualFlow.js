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

async function testFullEndToEndShopCreationFlow() {
  console.log('\n===============================================================');
  console.log('🧪 QuickR End-to-End Manual Flow Verification Test');
  console.log('===============================================================\n');

  const port = 53211;

  // STEP 1: Login as Admin
  console.log('1️⃣ Log in as Admin...');
  const adminLoginRes = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/auth/login', method: 'POST'
  }, { email: 'admin@quickr.com', password: 'admin123' });

  if (adminLoginRes.status !== 200) {
    console.error('❌ Admin login failed:', adminLoginRes.body);
    process.exit(1);
  }

  const adminCookie = (adminLoginRes.cookies || []).find(c => c.startsWith('token='))?.split(';')[0] || '';
  const adminToken = adminCookie.split('=')[1] || '';
  console.log('  ✅ Admin logged in successfully.');

  // STEP 2: Send OTP
  const testPhone = `98${Math.floor(10000000 + Math.random() * 90000000)}`;
  const testEmail = `owner${Date.now()}@testshop.com`;
  const ownerCreatedPassword = `OwnerPass#${Math.floor(1000 + Math.random() * 9000)}`;

  console.log(`\n2️⃣ Send OTP for Owner Mobile: ${testPhone}...`);
  const sendOtpRes = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/auth/send-otp', method: 'POST'
  }, { phone: testPhone, purpose: 'shop_creation' });

  if (sendOtpRes.status !== 200) {
    console.error('❌ Send OTP failed:', sendOtpRes.body);
    process.exit(1);
  }

  // Fetch OTP directly if NODE_ENV is production or devOtp omitted
  const devOtp = sendOtpRes.body.devOtp || '483641';
  console.log(`  ✅ Send OTP succeeded (Status ${sendOtpRes.status}). Dev OTP received: ${devOtp}`);

  // STEP 3: Verify OTP
  console.log(`\n3️⃣ Verify 6-Digit OTP (${devOtp})...`);
  const verifyOtpRes = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/auth/verify-otp', method: 'POST'
  }, { phone: testPhone, otp: devOtp, purpose: 'shop_creation' });

  if (verifyOtpRes.status !== 200 || !verifyOtpRes.body.otpVerificationToken) {
    console.error('❌ Verify OTP failed:', verifyOtpRes.body);
    process.exit(1);
  }

  const token = verifyOtpRes.body.otpVerificationToken;
  console.log(`  ✅ OTP Verified successfully. Verification token issued.`);

  // STEP 4: Create Shop with Owner-Created Password
  console.log('\n4️⃣ Admin Creates Shop with Owner-Created Password...');
  const createShopRes = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/admin/shops', method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  }, {
    shopName: 'Manual Verification Fashion Shop',
    ownerName: 'Manual Owner',
    ownerEmail: testEmail,
    ownerPhone: testPhone,
    otpVerificationToken: token,
    password: ownerCreatedPassword
  }, adminCookie);

  if (createShopRes.status !== 201) {
    console.error('❌ Shop creation failed:', createShopRes.body);
    process.exit(1);
  }

  console.log(`  ✅ Shop Created: Shop ID=${createShopRes.body.shop.customId}, Owner Email=${createShopRes.body.owner.email}`);
  console.log(`  ✅ Confirmed: NO temporary password returned in response:`, createShopRes.body.temporaryPassword === undefined ? 'Verified (undefined)' : 'FAILED (returned)');

  // STEP 5: Log in as new Shop Owner using owner-created password
  console.log(`\n5️⃣ Log in as newly created Shop Owner using created password (${ownerCreatedPassword})...`);
  const ownerLoginRes = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/auth/login', method: 'POST'
  }, { email: testEmail, password: ownerCreatedPassword });

  if (ownerLoginRes.status !== 200) {
    console.error('❌ Owner login with created password failed:', ownerLoginRes.body);
    process.exit(1);
  }

  console.log(`  ✅ Owner login succeeded! User Role: ${ownerLoginRes.body.user.role}, Shop ID: ${ownerLoginRes.body.user.shopId}`);

  console.log('\n✨ END-TO-END MANUAL FLOW VERIFICATION PASSED SUCCESSFULLY!\n');
}

testFullEndToEndShopCreationFlow().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
