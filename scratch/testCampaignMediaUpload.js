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
    if (postData && Buffer.isBuffer(postData)) req.write(postData);
    else if (postData) req.write(JSON.stringify(postData));
    req.end();
  });
}

async function verifyCampaignMediaUpload() {
  console.log('\n===============================================================');
  console.log('🧪 QuickR — Campaign Media Upload & Re-Engagement Removal Test');
  console.log('===============================================================\n');

  const port = 53211;

  const extractToken = (res) => {
    if (res.body?.token) return res.body.token;
    const cookieHeader = (res.cookies || []).find(c => c.startsWith('token='));
    return cookieHeader ? cookieHeader.split(';')[0].split('=')[1] : null;
  };

  // 1. Owner Login
  const adminLogin = await makeRequest({ hostname: '127.0.0.1', port, path: '/api/auth/login', method: 'POST' }, { email: 'admin@quickr.com', password: 'admin123' });
  const adminToken = extractToken(adminLogin);
  const adminHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}`, 'x-bypass-otp': 'true' };
  const adminCookie = `token=${adminToken}`;

  const shopEmail = `media_owner_${Date.now()}@test.com`;
  const phone = `98${Math.floor(10000000 + Math.random() * 90000000)}`;

  const send = await makeRequest({ hostname: '127.0.0.1', port, path: '/api/auth/send-otp', method: 'POST' }, { phone, purpose: 'shop_creation' });
  const verify = await makeRequest({ hostname: '127.0.0.1', port, path: '/api/auth/verify-otp', method: 'POST' }, { phone, otp: send.body.devOtp, purpose: 'shop_creation' });

  await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/admin/shops', method: 'POST', headers: adminHeaders
  }, { shopName: 'Media Test Shop', ownerName: 'Owner Media', ownerEmail: shopEmail, ownerPhone: phone, otpVerificationToken: verify.body.otpVerificationToken, password: 'password123' }, adminCookie);

  const ownerLogin = await makeRequest({ hostname: '127.0.0.1', port, path: '/api/auth/login', method: 'POST' }, { email: shopEmail, password: 'password123' });
  const ownerToken = extractToken(ownerLogin);
  const shopCookie = `token=${ownerToken}`;

  // 2. Upload Dummy Image (JPEG Binary)
  console.log('1️⃣ Uploading Campaign Image...');
  const dummyImageBuffer = Buffer.from('FAKE_JPEG_IMAGE_BINARY_DATA_PAYLOAD_FOR_TESTING');
  const imageUploadRes = await makeRequest({
    hostname: '127.0.0.1',
    port,
    path: '/api/campaigns/upload-media',
    method: 'POST',
    headers: {
      'Content-Type': 'image/jpeg',
      'x-media-type': 'image',
      'x-file-name': 'offer_banner.jpg',
      'Authorization': `Bearer ${ownerToken}`
    }
  }, dummyImageBuffer, shopCookie);

  if (imageUploadRes.statusCode === 200 && imageUploadRes.body.success) {
    console.log(`  ✅ Image upload succeeded! Ref: ${imageUploadRes.body.temporaryMediaReference}`);
  } else {
    console.error('  ❌ Image upload failed:', imageUploadRes.body);
    process.exit(1);
  }

  // 3. Retrieve Uploaded Image
  console.log('\n2️⃣ Serving Temporary Image File...');
  const mediaFetchRes = await makeRequest({
    hostname: '127.0.0.1',
    port,
    path: imageUploadRes.body.temporaryMediaReference,
    method: 'GET',
    headers: { 'Authorization': `Bearer ${ownerToken}` }
  }, null, shopCookie);

  if (mediaFetchRes.statusCode === 200 && mediaFetchRes.body === 'FAKE_JPEG_IMAGE_BINARY_DATA_PAYLOAD_FOR_TESTING') {
    console.log('  ✅ Image retrieved successfully with matching binary payload!');
  } else {
    console.error('  ❌ Image retrieval failed:', mediaFetchRes.statusCode, mediaFetchRes.body);
    process.exit(1);
  }

  // 4. Upload Dummy Video (MP4 Binary)
  console.log('\n3️⃣ Uploading Campaign Video...');
  const dummyVideoBuffer = Buffer.from('FAKE_MP4_VIDEO_BINARY_DATA_PAYLOAD_FOR_TESTING');
  const videoUploadRes = await makeRequest({
    hostname: '127.0.0.1',
    port,
    path: '/api/campaigns/upload-media',
    method: 'POST',
    headers: {
      'Content-Type': 'video/mp4',
      'x-media-type': 'video',
      'x-file-name': 'promo_video.mp4',
      'Authorization': `Bearer ${ownerToken}`
    }
  }, dummyVideoBuffer, shopCookie);

  if (videoUploadRes.statusCode === 200 && videoUploadRes.body.success) {
    console.log(`  ✅ Video upload succeeded! Ref: ${videoUploadRes.body.temporaryMediaReference}`);
  } else {
    console.error('  ❌ Video upload failed:', videoUploadRes.body);
    process.exit(1);
  }

  // 5. Verify Re-Engagement Default Period
  console.log('\n4️⃣ Verifying Customer Re-Engagement Default Period & Removal of Test Mode...');
  const reengageSummary = await makeRequest({
    hostname: '127.0.0.1', port, path: '/api/reengagement/summary', method: 'GET', headers: { Authorization: `Bearer ${ownerToken}` }
  }, null, shopCookie);

  if (reengageSummary.statusCode === 200 && reengageSummary.body.daysCutoff === 30 && reengageSummary.body.isTestMode === undefined) {
    console.log(`  ✅ Customer Re-Engagement default daysCutoff is 30. Test mode cleanly removed!`);
  } else {
    console.error('  ❌ Re-Engagement verification failed:', reengageSummary.body);
    process.exit(1);
  }

  console.log('\n✨ ALL CAMPAIGN MEDIA UPLOAD & RE-ENGAGEMENT VERIFICATION TESTS PASSED!\n');
}

verifyCampaignMediaUpload().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
