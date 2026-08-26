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

async function verifyWhatsAppOfferFormatting() {
  console.log('\n===============================================================');
  console.log('🧪 QuickR — WhatsApp Offer Formatting & Emoji-Free Verification');
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

  const shopEmail = `wa_owner_${Date.now()}@test.com`;
  const phone = `98${Math.floor(10000000 + Math.random() * 90000000)}`;

  const send = await makeRequest({ hostname: '127.0.0.1', port, path: '/api/auth/send-otp', method: 'POST' }, { phone, purpose: 'shop_creation' });
  const verify = await makeRequest({ hostname: '127.0.0.1', port, path: '/api/auth/verify-otp', method: 'POST' }, { phone, otp: send.body.devOtp, purpose: 'shop_creation' });

  await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/admin/shops', method: 'POST', headers: adminHeaders
  }, { shopName: 'Sid Clothes', ownerName: 'Sid Owner', ownerEmail: shopEmail, ownerPhone: phone, otpVerificationToken: verify.body.otpVerificationToken, password: 'password123' }, adminCookie);

  const ownerLogin = await makeRequest({ hostname: '127.0.0.1', port, path: '/api/auth/login', method: 'POST' }, { email: shopEmail, password: 'password123' });
  const ownerToken = extractToken(ownerLogin);
  const shopHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` };
  const shopCookie = `token=${ownerToken}`;

  // 2. Create Customer Sid with consent
  const sidRes = await makeRequest({ hostname: '127.0.0.1', port, path: '/api/customers', method: 'POST', headers: shopHeaders }, { name: 'Sid', phone: '6381558844' }, shopCookie);
  const sid = sidRes.body;

  // Grant marketing consent
  await makeRequest({ hostname: '127.0.0.1', port, path: `/api/privacy/customers/${sid.id}/permission`, method: 'POST', headers: shopHeaders }, { allowWhatsAppOffers: true }, shopCookie);

  // 3. Create Campaign Offer: "Special Offer Products" with 20% OFF
  const campaignRes = await makeRequest({ hostname: '127.0.0.1', port, path: '/api/campaigns', method: 'POST', headers: shopHeaders }, {
    title: 'Special Offer Products',
    description: 'Special offer for returning customers',
    discountType: 'Percentage',
    discountValue: 20,
    productIds: [],
    startDate: '2026-08-21',
    endDate: '2026-08-28',
    mediaType: 'image',
    temporaryMediaReference: '/api/campaigns/media/temp_test.jpg',
    selectedCustomerIds: [sid.id],
    targetAudienceType: 'all_eligible',
    status: 'READY'
  }, shopCookie);

  const campaign = campaignRes.body.campaign;

  // 4. Retrieve Manual Campaign Targets & Personalized Message
  const targetsRes = await makeRequest({ hostname: '127.0.0.1', port, path: `/api/campaigns/${campaign.id}/manual-targets`, method: 'GET', headers: shopHeaders }, null, shopCookie);

  const target = targetsRes.body.targets[0];
  console.log('\n--- Generated Personalized WhatsApp Message ---');
  console.log(target.personalizedMessage);
  console.log('----------------------------------------------\n');

  // Check for emojis or malformed character 
  const hasEmojiOrMalformed = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\uFFFD]/gu.test(target.personalizedMessage);

  if (!hasEmojiOrMalformed) {
    console.log('  ✅ 0 Emojis and 0 malformed () characters found!');
  } else {
    console.error('  ❌ Message contains emojis or malformed characters!');
    process.exit(1);
  }

  if (target.personalizedMessage.includes('Hi Sid!') && target.personalizedMessage.includes('Sid Clothes') && target.personalizedMessage.includes('20% OFF')) {
    console.log('  ✅ Template variables {{CustomerName}}, {{ShopName}}, and {{Discount}} populated correctly!');
  } else {
    console.error('  ❌ Template variable population failed:', target.personalizedMessage);
    process.exit(1);
  }

  if (target.mediaUrl && target.mediaUrl.endsWith('/api/campaigns/media/temp_test.jpg')) {
    console.log(`  ✅ Media URL passed cleanly to manual target workflow: ${target.mediaUrl}`);
  } else {
    console.error('  ❌ Media URL association failed:', target);
    process.exit(1);
  }

  console.log('\n✨ ALL WHATSAPP OFFER FORMATTING & EMOJI-FREE TESTS PASSED!\n');
}

verifyWhatsAppOfferFormatting().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
