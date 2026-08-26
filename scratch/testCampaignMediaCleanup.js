import http from 'http';
import fs from 'fs';
import path from 'path';

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

async function testCampaignMediaCleanup() {
  console.log('\n===============================================================');
  console.log('🧪 QuickR — Campaign Media Cleanup & Retention Rule Verification');
  console.log('===============================================================\n');

  const port = 53211;

  const extractToken = (res) => {
    if (res.body?.token) return res.body.token;
    const cookieHeader = (res.cookies || []).find(c => c.startsWith('token='));
    return cookieHeader ? cookieHeader.split(';')[0].split('=')[1] : null;
  };

  // 1. Login Admin & Create Shop
  const adminLogin = await makeRequest({ hostname: '127.0.0.1', port, path: '/api/auth/login', method: 'POST' }, { email: 'admin@quickr.com', password: 'admin123' });
  const adminToken = extractToken(adminLogin);
  const adminHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}`, 'x-bypass-otp': 'true' };
  const adminCookie = `token=${adminToken}`;

  const shopEmail = `cleanup_owner_${Date.now()}@test.com`;
  const phone = `98${Math.floor(10000000 + Math.random() * 90000000)}`;

  const send = await makeRequest({ hostname: '127.0.0.1', port, path: '/api/auth/send-otp', method: 'POST' }, { phone, purpose: 'shop_creation' });
  const verify = await makeRequest({ hostname: '127.0.0.1', port, path: '/api/auth/verify-otp', method: 'POST' }, { phone, otp: send.body.devOtp, purpose: 'shop_creation' });

  await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/admin/shops', method: 'POST', headers: adminHeaders
  }, { shopName: 'Cleanup Shop', ownerName: 'Cleanup Owner', ownerEmail: shopEmail, ownerPhone: phone, otpVerificationToken: verify.body.otpVerificationToken, password: 'password123' }, adminCookie);

  const ownerLogin = await makeRequest({ hostname: '127.0.0.1', port, path: '/api/auth/login', method: 'POST' }, { email: shopEmail, password: 'password123' });
  const ownerToken = extractToken(ownerLogin);
  const shopHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` };
  const shopCookie = `token=${ownerToken}`;

  // 2. Create Expired Campaign (End Date = 5 days ago)
  const threeDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const dummyFile = path.join(process.cwd(), 'backend', 'uploads', 'temp_campaign_media', `temp_SHOP-CLEANUP_EXPIRED.jpg`);
  
  if (!fs.existsSync(path.dirname(dummyFile))) {
    fs.mkdirSync(path.dirname(dummyFile), { recursive: true });
  }
  fs.writeFileSync(dummyFile, 'DUMMY_IMAGE_BINARY');

  const campaignRes = await makeRequest({ hostname: '127.0.0.1', port, path: '/api/campaigns', method: 'POST', headers: shopHeaders }, {
    title: 'Expired Offer Test',
    description: 'Expired offer',
    discountType: 'Percentage',
    discountValue: 15,
    productIds: [],
    startDate: '2026-08-01',
    endDate: threeDaysAgo,
    mediaType: 'image',
    temporaryMediaReference: '/api/campaigns/media/temp_SHOP-CLEANUP_EXPIRED.jpg',
    selectedCustomerIds: [],
    targetAudienceType: 'all_eligible',
    status: 'READY'
  }, shopCookie);

  console.log('1️⃣ Expired campaign created with End Date + 5 days ago.');
  console.log(`  Dummy file created on disk: ${fs.existsSync(dummyFile)}`);

  // 3. Trigger GET /api/campaigns (which runs automatic cleanup)
  console.log('\n2️⃣ Fetching campaigns list to trigger automatic cleanup...');
  const listRes = await makeRequest({ hostname: '127.0.0.1', port, path: '/api/campaigns', method: 'GET', headers: shopHeaders }, null, shopCookie);

  const cleanedCampaign = listRes.body.find(c => c.id === campaignRes.body.campaign.id);

  console.log(`  File exists on disk after cleanup: ${fs.existsSync(dummyFile)}`);
  console.log(`  Campaign metadata preserved: Title: "${cleanedCampaign.title}", Discount: ${cleanedCampaign.discountValue}%`);
  console.log(`  Campaign temporaryMediaReference cleared: ${cleanedCampaign.temporaryMediaReference === null}`);

  if (!fs.existsSync(dummyFile) && cleanedCampaign.title === 'Expired Offer Test' && cleanedCampaign.temporaryMediaReference === null) {
    console.log('\n✨ AUTOMATIC CAMPAIGN MEDIA CLEANUP VERIFICATION PASSED!\n');
  } else {
    console.error('❌ Media cleanup test failed!');
    process.exit(1);
  }
}

testCampaignMediaCleanup().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
