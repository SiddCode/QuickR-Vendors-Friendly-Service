// Automated test suite for Admin Subscription Approval flow
const BASE_URL = 'http://127.0.0.1:53211';

async function runApprovalTests() {
  console.log('====================================================');
  console.log('🧪 QUICKR — ADMIN SUBSCRIPTION APPROVAL TEST SUITE');
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
    // 1. Login as Admin
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'siddharthank45@gmail.com', password: 'whiskey' })
    });
    assert(loginRes.status === 200, '1. Admin login successful');
    const setCookie = loginRes.headers.get('set-cookie');
    const cookie = setCookie ? setCookie.split(';')[0] : '';

    // 2. Submit a fresh subscription request
    const uniqueEmail = `test_owner_${Date.now()}@quickrtest.com`;
    const uniquePhone = `98${Math.floor(10000000 + Math.random() * 90000000)}`;
    const uniqueShopName = `Test Shop ${Date.now()}`;
    const subReqRes = await fetch(`${BASE_URL}/api/subscription-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Owner Name',
        shopName: uniqueShopName,
        phone: uniquePhone,
        email: uniqueEmail,
        password: 'testPassword123'
      })
    });
    assert(subReqRes.status === 201, '2. Subscription request submitted');

    // 3. Retrieve request ID from admin list
    const reqsRes = await fetch(`${BASE_URL}/api/admin/subscription-requests`, {
      headers: { 'Cookie': cookie }
    });
    const reqs = await reqsRes.json();
    const freshReq = reqs.find(r => r.email === uniqueEmail && r.status === 'pending');
    assert(!!freshReq, '3. Fresh subscription request found in Admin list');

    if (freshReq) {
      // 4. Approve subscription request
      const approveRes = await fetch(`${BASE_URL}/api/admin/subscription-requests/${freshReq.id}/approve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
        body: JSON.stringify({ adminNotes: 'Automated test approval notes' })
      });
      assert(approveRes.status === 200, '4. Approval API returned 200 OK');
      const approveData = await approveRes.json();
      assert(approveData.success === true, '4b. Approval response success is true');
      assert(!!approveData.shop?.customId, '4c. Created shop customId returned');
      assert(!!approveData.owner?.id, '4d. Created owner ID returned');

      // 5. Test login with newly created owner account
      const ownerLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: uniqueEmail, password: 'testPassword123' })
      });
      assert(ownerLoginRes.status === 200, '5. Newly created owner logged in successfully');
      const ownerLoginData = await ownerLoginRes.json();
      assert(ownerLoginData.user?.role === 'owner', '5b. Owner role confirmed');
      assert(ownerLoginData.user?.shopId === approveData.shop.customId, '5c. Owner user.shopId matches created shop');

      // 6. Test duplicate approval (Already approved)
      const reApproveRes = await fetch(`${BASE_URL}/api/admin/subscription-requests/${freshReq.id}/approve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
        body: JSON.stringify({ adminNotes: 'Duplicate approval attempt' })
      });
      assert(reApproveRes.status === 400, '6. Already-approved request returns 400 Bad Request');
      const reApproveData = await reApproveRes.json();
      assert(reApproveData.error.includes('already been approved'), '6b. Correct error message returned for duplicate approval');

      // 7. Test request with duplicate email
      const dupSubReqRes = await fetch(`${BASE_URL}/api/subscription-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Another Owner',
          shopName: 'Another Shop',
          phone: '9876543210',
          email: uniqueEmail, // same email
          password: 'anotherPassword123'
        })
      });
      // Submit might succeed or be blocked, if allowed we test approving it
      if (dupSubReqRes.status === 201) {
        const reqsRes2 = await fetch(`${BASE_URL}/api/admin/subscription-requests`, {
          headers: { 'Cookie': cookie }
        });
        const reqs2 = await reqsRes2.json();
        const dupReq = reqs2.find(r => r.email === uniqueEmail && r.status === 'pending');
        if (dupReq) {
          const dupApproveRes = await fetch(`${BASE_URL}/api/admin/subscription-requests/${dupReq.id}/approve`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
            body: JSON.stringify({})
          });
          assert(dupApproveRes.status === 400, '7. Request with existing user email rejected with 400');
          const dupApproveData = await dupApproveRes.json();
          assert(dupApproveData.error.includes('already exists'), '7b. Clean error message returned for duplicate email');
        }
      }
    }

    console.log('\n====================================================');
    console.log(`SUMMARY: ${passed} Passed, ${failed} Failed`);
    console.log('====================================================\n');

  } catch (err) {
    console.error('Test error:', err.message);
  }
}

runApprovalTests();
