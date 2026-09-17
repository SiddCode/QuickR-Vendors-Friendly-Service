// Node 18+ built-in fetch used

const BASE_URL = 'http://localhost:53211/api';

async function runSecurityTests() {
  console.log('====================================================');
  console.log('🔒 QUICKR - PASSWORD & AUTH SECURITY AUTOMATED TESTS');
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
    // 1. Unauthenticated request to protected endpoint fails
    const unauthRes = await fetch(`${BASE_URL}/auth/me`);
    assert(unauthRes.status === 401, '1. Missing JWT cookie/header fails with 401 Unauthorized');

    // 2. Login with incorrect password fails cleanly
    const badLoginRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'siddharthank45@gmail.com', password: 'wrongpassword' })
    });
    const badLoginJson = await badLoginRes.json();
    assert(badLoginRes.status === 401, '2. Invalid password rejected with 401');
    assert(badLoginJson.error === 'Invalid email or password.', '2b. Generic error message prevents email enumeration');

    // 3. Login with correct credentials succeeds
    const loginRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'siddharthank45@gmail.com', password: 'whiskey' })
    });
    assert(loginRes.status === 200, '3. Valid credentials login successful');
    const loginData = await loginRes.json();
    
    // 4. Verify password and passwordHash are NOT returned in login response
    assert(loginData.user && !loginData.user.password && !loginData.user.passwordHash, '4. password/passwordHash NOT present in login response');

    // 5. Verify Cookie set-cookie header contains HttpOnly
    const setCookie = loginRes.headers.get('set-cookie');
    assert(setCookie && setCookie.toLowerCase().includes('httponly'), '5. Auth token set with HttpOnly cookie flag');

    const cookieHeader = setCookie ? setCookie.split(';')[0] : '';

    // 6. Verify getMe endpoint protects password fields
    const meRes = await fetch(`${BASE_URL}/auth/me`, {
      headers: { 'Cookie': cookieHeader }
    });
    const meData = await meRes.json();
    assert(meRes.status === 200, '6. /auth/me returns 200 OK with valid cookie');
    assert(meData.user && !meData.user.password && !meData.user.passwordHash, '6b. password/passwordHash NOT present in /auth/me response');

    // 7. Verify JWT payload structure (by decoding payload base64 part)
    if (loginData.token) {
      const parts = loginData.token.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
      assert(!payload.password && !payload.passwordHash, '7. JWT payload does NOT contain password or passwordHash');
      assert(payload.id && payload.role, '7b. JWT payload contains minimal identity info (id, role)');
    }

    // 8. Verify Authorization header fallback works safely with Bearer token
    if (loginData.token) {
      const bearerRes = await fetch(`${BASE_URL}/auth/me`, {
        headers: { 'Authorization': `Bearer ${loginData.token}` }
      });
      assert(bearerRes.status === 200, '8. Authorization Bearer header fallback authenticated successfully');
    }

    // 9. Verify malformed Authorization header is rejected
    const malformedRes = await fetch(`${BASE_URL}/auth/me`, {
      headers: { 'Authorization': `Bearer invalid.jwt.token` }
    });
    assert(malformedRes.status === 401, '9. Malformed Authorization token rejected with 401');

    console.log('\n====================================================');
    console.log(`SUMMARY: ${passed} Passed, ${failed} Failed`);
    console.log('====================================================\n');

  } catch (err) {
    console.error('Test execution error:', err.message);
  }
}

runSecurityTests();
