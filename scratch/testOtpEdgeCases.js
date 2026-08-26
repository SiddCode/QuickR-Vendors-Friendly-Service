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

async function verifyOtpEdgeCases() {
  console.log('\n===============================================================');
  console.log('🧪 QuickR — OTP Backend Verification Edge Cases Test Suite');
  console.log('===============================================================\n');

  const port = 53211;
  const testPhone = `98${Math.floor(10000000 + Math.random() * 90000000)}`;

  // 1. Send OTP
  console.log(`1️⃣ Request OTP for phone: ${testPhone}`);
  const sendRes = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/auth/send-otp', method: 'POST'
  }, { phone: testPhone, purpose: 'shop_creation' });

  if (sendRes.statusCode !== 200 || !sendRes.body.devOtp) {
    console.error('❌ Send OTP failed:', sendRes.body);
    process.exit(1);
  }

  const validOtp = sendRes.body.devOtp;
  console.log(`  ✅ OTP generated & returned in Mock Mode: ${validOtp}`);

  // 2. Test Incorrect OTP
  console.log('\n2️⃣ Test Incorrect OTP Verification');
  const wrongRes = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/auth/verify-otp', method: 'POST'
  }, { phone: testPhone, otp: '000000', purpose: 'shop_creation' });

  if (wrongRes.statusCode === 400 && wrongRes.body.error.includes('Incorrect OTP')) {
    console.log(`  ✅ Incorrect OTP correctly rejected: "${wrongRes.body.error}"`);
  } else {
    console.error('  ❌ Incorrect OTP test failed:', wrongRes);
    process.exit(1);
  }

  // 3. Test Correct OTP Verification
  console.log('\n3️⃣ Test Correct OTP Verification');
  const correctRes = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/auth/verify-otp', method: 'POST'
  }, { phone: testPhone, otp: validOtp, purpose: 'shop_creation' });

  if (correctRes.statusCode === 200 && correctRes.body.otpVerificationToken) {
    console.log(`  ✅ Correct OTP verified successfully. Token issued: ${correctRes.body.otpVerificationToken.substring(0, 25)}...`);
  } else {
    console.error('  ❌ Correct OTP verification failed:', correctRes);
    process.exit(1);
  }

  // 4. Test Reused OTP Verification (Should fail as verified === true)
  console.log('\n4️⃣ Test Reused OTP Prevention');
  const reuseRes = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/auth/verify-otp', method: 'POST'
  }, { phone: testPhone, otp: validOtp, purpose: 'shop_creation' });

  if (reuseRes.statusCode === 400 && reuseRes.body.error.includes('expired or is invalid')) {
    console.log(`  ✅ Reused OTP correctly blocked: "${reuseRes.body.error}"`);
  } else {
    console.error('  ❌ Reused OTP test failed:', reuseRes);
    process.exit(1);
  }

  console.log('\n✨ ALL OTP BACKEND EDGE CASE TESTS PASSED!\n');
}

verifyOtpEdgeCases().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
