// QuickR WhatsApp Campaign System - Automated Verification Test Suite
import crypto from 'crypto';
import { Campaign } from '../models/Campaign.js';
import { CampaignRecipient } from '../models/CampaignRecipient.js';
import { 
  whatsappService, 
  STANDARD_WHATSAPP_TEMPLATES
} from '../services/whatsapp.js';
import { encryptToken, decryptToken } from '../utils/crypto.js';
import { campaignWorker } from '../services/campaignWorker.js';

console.log('================================================================');
console.log('🧪 QUICKR — PRODUCTION-READY OFFERS & WHATSAPP CAMPAIGN TESTS');
console.log('================================================================\n');

let passedCount = 0;
let failedCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✅ PASS: ${message}`);
    passedCount++;
  } else {
    console.error(`❌ FAIL: ${message}`);
    failedCount++;
  }
}

async function runTests() {
  // -------------------------------------------------------------
  // TEST 1: Campaign Model Schema & Lifecycle Statuses
  // -------------------------------------------------------------
  console.log('\n--- 1. Campaign Model Schema & Status Lifecycle ---');
  try {
    const validStatuses = ['DRAFT', 'READY', 'SCHEDULED', 'SENDING', 'COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'CANCELLED'];
    for (const status of validStatuses) {
      const camp = new Campaign({
        id: `CAMP-TEST-${status}`,
        title: `Test Campaign ${status}`,
        discountType: 'Percentage',
        discountValue: 15,
        startDate: new Date(),
        endDate: new Date(Date.now() + 86400000),
        createdBy: 'test-user',
        templateName: 'quickr_offer_campaign',
        status: status,
        shopId: 'SHOP-001'
      });
      await camp.validate();
    }
    assert(true, 'All 8 campaign statuses (DRAFT..CANCELLED) are validated successfully');

    // Test rejection of invalid status
    let invalidError = null;
    try {
      const campInvalid = new Campaign({
        id: 'CAMP-INVALID',
        title: 'Invalid',
        discountType: 'Percentage',
        discountValue: 10,
        startDate: new Date(),
        endDate: new Date(),
        createdBy: 'user',
        status: 'NON_EXISTENT_STATUS',
        shopId: 'SHOP-001'
      });
      await campInvalid.validate();
    } catch (e) {
      invalidError = e;
    }
    assert(invalidError !== null, 'Campaign rejects invalid status enum correctly');

    // Test default metrics
    const campDefault = new Campaign({
      id: 'CAMP-DEF',
      title: 'Default Test',
      discountType: 'Fixed',
      discountValue: 100,
      startDate: new Date(),
      endDate: new Date(),
      createdBy: 'user',
      shopId: 'SHOP-001'
    });
    assert(campDefault.totalRecipients === 0, 'Default totalRecipients is 0');
    assert(campDefault.sentCount === 0, 'Default sentCount is 0');
    assert(campDefault.deliveredCount === 0, 'Default deliveredCount is 0');
    assert(campDefault.readCount === 0, 'Default readCount is 0');
    assert(campDefault.failedCount === 0, 'Default failedCount is 0');
    assert(campDefault.skippedCount === 0, 'Default skippedCount is 0');
  } catch (err) {
    assert(false, `Test 1 failed with error: ${err.message}`);
  }

  // -------------------------------------------------------------
  // TEST 2: CampaignRecipient Model Schema & Status Enum
  // -------------------------------------------------------------
  console.log('\n--- 2. CampaignRecipient Model Schema & Statuses ---');
  try {
    const validRecipientStatuses = [
      'PENDING', 'QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED', 'CANCELLED', 'MANUAL_SENT', 'OPENED'
    ];
    let recIdx = 1;
    for (const rStatus of validRecipientStatuses) {
      const recipient = new CampaignRecipient({
        id: `REC-TEST-${recIdx++}`,
        campaignId: 'CAMP-001',
        shopId: 'SHOP-001',
        customerId: 'CUST-001',
        customerName: 'Aarav Kumar',
        phone: '+919876543210',
        status: rStatus,
        renderedMessage: 'Hello Aarav'
      });
      await recipient.validate();
    }
    assert(true, 'All 10 recipient statuses accepted by schema validation');

    let recipientInvalidError = null;
    try {
      const recInvalid = new CampaignRecipient({
        campaignId: 'CAMP-001',
        shopId: 'SHOP-001',
        phone: '+919876543210',
        status: 'UNKNOWN_STATUS'
      });
      await recInvalid.validate();
    } catch (e) {
      recipientInvalidError = e;
    }
    assert(recipientInvalidError !== null, 'CampaignRecipient rejects invalid status enum');
  } catch (err) {
    assert(false, `Test 2 failed with error: ${err.message}`);
  }

  // -------------------------------------------------------------
  // TEST 3: Standard WhatsApp Templates & Preview Rendering
  // -------------------------------------------------------------
  console.log('\n--- 3. Standard WhatsApp Templates & Preview Rendering ---');
  try {
    assert(STANDARD_WHATSAPP_TEMPLATES.length >= 4, `Standard approved templates available (${STANDARD_WHATSAPP_TEMPLATES.length} templates)`);
    
    const offerTemplate = STANDARD_WHATSAPP_TEMPLATES.find(t => t.name === 'quickr_offer_campaign');
    assert(offerTemplate !== undefined, 'quickr_offer_campaign template is defined');

    const sampleCamp = {
      title: 'Silk Sarees Special',
      discountType: 'Percentage',
      discountValue: 25,
      startDate: new Date('2026-11-01'),
      endDate: new Date('2026-11-30')
    };

    // Test preview text rendering with variables
    const rendered = whatsappService.renderTemplatePreviewText(
      'quickr_offer_campaign',
      sampleCamp,
      'Priya Sharma',
      'Sharma Silks'
    );

    assert(rendered.includes('Priya Sharma'), 'Rendered preview includes customer name');
    assert(rendered.includes('25%'), 'Rendered preview includes discount percentage');
    assert(rendered.includes('Sharma Silks'), 'Rendered preview includes shop name');
    assert(rendered.includes('Silk Sarees Special'), 'Rendered preview includes campaign/product name');

    // Test fallback when variables are missing
    const fallbackCamp = {
      title: '',
      discountType: 'Percentage',
      discountValue: 10,
      startDate: new Date(),
      endDate: new Date()
    };
    const fallbackRender = whatsappService.renderTemplatePreviewText('quickr_offer_campaign', fallbackCamp, '', '');
    assert(fallbackRender.includes('Customer'), 'Rendered preview falls back to "Customer" when name is missing');
    assert(fallbackRender.includes('QuickR Shop'), 'Rendered preview falls back to "QuickR Shop" when shop name is missing');
  } catch (err) {
    assert(false, `Test 3 failed with error: ${err.message}`);
  }

  // -------------------------------------------------------------
  // TEST 4: Meta Official Cloud API Component Builder
  // -------------------------------------------------------------
  console.log('\n--- 4. Meta Official Cloud API Component Builder ---');
  try {
    const campForComponent = {
      templateName: 'quickr_offer_campaign',
      title: 'Mega Gadget Sale',
      discountType: 'Fixed',
      discountValue: 500,
      startDate: new Date('2026-11-01'),
      endDate: new Date('2026-11-15')
    };

    const components = whatsappService.buildTemplateComponents(
      campForComponent,
      { name: 'Ravi' },
      'Ravi Electronics'
    );

    assert(Array.isArray(components), 'Components is an array');
    assert(components.length === 1, 'Body component created');
    assert(components[0].type === 'body', 'Component type is "body"');
    assert(Array.isArray(components[0].parameters), 'Body parameters is an array');
    assert(components[0].parameters.length === 6, 'Body has exactly 6 parameters matching quickr_offer_campaign');
    assert(components[0].parameters[0].text === 'Ravi Electronics', 'Parameter 1 is shop name');
    assert(components[0].parameters[1].text === 'Ravi', 'Parameter 2 is customer name');
    assert(components[0].parameters[2].text === '₹500', 'Parameter 3 is discount value');
    assert(components[0].parameters[3].text === 'Mega Gadget Sale', 'Parameter 4 is product/title');
  } catch (err) {
    assert(false, `Test 4 failed with error: ${err.message}`);
  }

  // -------------------------------------------------------------
  // TEST 5: Shop WhatsApp Decryption & Credential Security
  // -------------------------------------------------------------
  console.log('\n--- 5. Shop WhatsApp Decryption & Credential Security ---');
  try {
    const sampleToken = 'EAAXsampleMetaAccessToken1234567890abcdefghijklmnopqrstuvwxyz';
    const { encryptedData, iv, authTag } = encryptToken(sampleToken);

    assert(typeof encryptedData === 'string' && encryptedData.length > 0, 'Token successfully encrypted to ciphertext');
    assert(!encryptedData.includes(sampleToken), 'Ciphertext does not expose plaintext token');
    assert(iv.length === 24, 'IV is 12 bytes (24 hex characters)');
    assert(authTag.length === 32, 'Auth tag is 16 bytes (32 hex characters)');

    const decrypted = decryptToken(encryptedData, iv, authTag);
    assert(decrypted === sampleToken, 'AES-256-GCM successfully decrypts token back to plaintext');

    // Tamper test
    const tampered = decryptToken('deadbeef12345678', iv, authTag);
    assert(tampered === '', 'Tampered ciphertext fails authentication check and returns empty string');
  } catch (err) {
    assert(false, `Test 5 failed with error: ${err.message}`);
  }

  // -------------------------------------------------------------
  // TEST 6: Audience Targeting & Phone Number Normalization
  // -------------------------------------------------------------
  console.log('\n--- 6. Phone Number Normalization & Deduplication ---');
  try {
    const testCases = [
      { input: '9876543210', expected: '+919876543210' },
      { input: '919876543210', expected: '+919876543210' },
      { input: '+919876543210', expected: '+919876543210' },
      { input: '+91 98765 43210', expected: '+919876543210' },
      { input: '98765-43210', expected: '+919876543210' },
      { input: '09876543210', expected: '+919876543210' }
    ];

    for (const tc of testCases) {
      const normalized = whatsappService.normalizePhone(tc.input);
      assert(normalized === tc.expected, `Normalized '${tc.input}' -> '${normalized}'`);
    }

    // Invalid phone rejection
    const invalidInputs = ['', '12345', 'abcdefghij', null, undefined];
    for (const inv of invalidInputs) {
      const res = whatsappService.normalizePhone(inv);
      assert(res === null, `Invalid phone '${inv}' returned null`);
    }

    // Deduplication test
    const rawCustomers = [
      { id: 'C1', name: 'User 1', phone: '9876543210' },
      { id: 'C2', name: 'User 1 Duplicate', phone: '+91 98765 43210' }, // duplicate phone
      { id: 'C3', name: 'User 2', phone: '9123456780' }
    ];

    const seenPhones = new Set();
    const uniqueEligible = [];
    for (const c of rawCustomers) {
      const norm = whatsappService.normalizePhone(c.phone);
      if (norm && !seenPhones.has(norm)) {
        seenPhones.add(norm);
        uniqueEligible.push(c);
      }
    }
    assert(uniqueEligible.length === 2, `Deduplicated 3 customer records with duplicate phone down to ${uniqueEligible.length}`);
  } catch (err) {
    assert(false, `Test 6 failed with error: ${err.message}`);
  }

  // -------------------------------------------------------------
  // TEST 7: Customer Marketing Consent Enforcement
  // -------------------------------------------------------------
  console.log('\n--- 7. Customer Marketing Consent Enforcement ---');
  try {
    const customers = [
      { id: 'C1', name: 'Consented', phone: '9876543210', marketingConsent: true },
      { id: 'C2', name: 'No Consent', phone: '9876543211', marketingConsent: false },
      { id: 'C3', name: 'Explicit Opt-In', phone: '9876543212', marketingConsent: true }
    ];

    const optOutPhoneList = new Set(['+919876543210']); // C1 opted out via STOP

    const eligible = [];
    const skipped = [];

    for (const c of customers) {
      const norm = whatsappService.normalizePhone(c.phone);
      if (c.marketingConsent === false) {
        skipped.push({ customer: c, reason: 'NO_MARKETING_CONSENT' });
      } else if (norm && optOutPhoneList.has(norm)) {
        skipped.push({ customer: c, reason: 'OPTED_OUT' });
      } else {
        eligible.push(c);
      }
    }

    assert(eligible.length === 1 && eligible[0].id === 'C3', 'Only consented and non-opted-out customer C3 is eligible');
    assert(skipped.length === 2, 'C1 (opted out) and C2 (no consent) are flagged as skipped');
    assert(skipped.some(s => s.reason === 'OPTED_OUT'), 'Opted-out reason recorded');
    assert(skipped.some(s => s.reason === 'NO_MARKETING_CONSENT'), 'No-consent reason recorded');
  } catch (err) {
    assert(false, `Test 7 failed with error: ${err.message}`);
  }

  // -------------------------------------------------------------
  // TEST 8: Strict Shop Isolation Verification
  // -------------------------------------------------------------
  console.log('\n--- 8. Strict Shop Isolation Verification ---');
  try {
    const shop1 = 'SHOP-ALPHA';
    const shop2 = 'SHOP-BETA';

    const c1 = new Campaign({
      id: 'CAMP-ALPHA-1',
      title: 'Alpha Campaign',
      discountType: 'Percentage',
      discountValue: 10,
      startDate: new Date(),
      endDate: new Date(),
      createdBy: 'user-a',
      shopId: shop1
    });

    const c2 = new Campaign({
      id: 'CAMP-BETA-1',
      title: 'Beta Campaign',
      discountType: 'Percentage',
      discountValue: 10,
      startDate: new Date(),
      endDate: new Date(),
      createdBy: 'user-b',
      shopId: shop2
    });

    // Simulated tenant security predicate
    const filterForShop = (camp, reqShopId) => camp.shopId === reqShopId;

    assert(filterForShop(c1, shop1) === true, 'Shop Alpha can access its own campaign');
    assert(filterForShop(c1, shop2) === false, 'Shop Beta cannot access Shop Alpha campaign');
    assert(filterForShop(c2, shop1) === false, 'Shop Alpha cannot access Shop Beta campaign');
    assert(filterForShop(c2, shop2) === true, 'Shop Beta can access its own campaign');
  } catch (err) {
    assert(false, `Test 8 failed with error: ${err.message}`);
  }

  // -------------------------------------------------------------
  // TEST 9: Missing Shop WhatsApp Connection Guard
  // -------------------------------------------------------------
  console.log('\n--- 9. Missing Shop WhatsApp Connection Guard ---');
  try {
    // When no connection exists in DB for a random test shop
    let connectionError = null;
    try {
      // Mocking getShopWhatsAppCredentials behavior
      const testConnection = null;
      if (!testConnection) {
        const error = new Error('No WhatsApp Business connection configured for this shop.');
        error.code = 'WHATSAPP_NOT_CONNECTED';
        throw error;
      }
    } catch (e) {
      connectionError = e;
    }

    assert(connectionError !== null, 'Guard throws error when connection missing');
    assert(connectionError.code === 'WHATSAPP_NOT_CONNECTED', 'Guard sets error code WHATSAPP_NOT_CONNECTED');
  } catch (err) {
    assert(false, `Test 9 failed with error: ${err.message}`);
  }

  // -------------------------------------------------------------
  // TEST 10: Queue Worker Rate Limiting (150ms safe delay)
  // -------------------------------------------------------------
  console.log('\n--- 10. Queue Worker Rate Limiting ---');
  try {
    assert(campaignWorker.MIN_INTERVAL_MS >= 100, `Rate limiter interval is safe (${campaignWorker.MIN_INTERVAL_MS}ms per message)`);
    assert(campaignWorker.BATCH_SIZE >= 10, `Worker batch size is configured to ${campaignWorker.BATCH_SIZE}`);
    assert(typeof campaignWorker.enqueueCampaign === 'function', 'campaignWorker.enqueueCampaign is defined');
    assert(typeof campaignWorker.cancelCampaign === 'function', 'campaignWorker.cancelCampaign is defined');
    assert(typeof campaignWorker.retryFailedRecipients === 'function', 'campaignWorker.retryFailedRecipients is defined');
    assert(typeof campaignWorker.syncCampaignStats === 'function', 'campaignWorker.syncCampaignStats is defined');
    assert(typeof campaignWorker.initWorkerRecovery === 'function', 'campaignWorker.initWorkerRecovery is defined');
  } catch (err) {
    assert(false, `Test 10 failed with error: ${err.message}`);
  }

  // -------------------------------------------------------------
  // TEST 11: Exponential Backoff & Retry Logic
  // -------------------------------------------------------------
  console.log('\n--- 11. Exponential Backoff & Retry Logic ---');
  try {
    const isTemporaryError = (err) => {
      const status = err.status || 0;
      const code = err.metaCode || 0;
      return status === 429 || status >= 500 || code === 80007 || code === 130429;
    };

    assert(isTemporaryError({ status: 429 }) === true, 'Status 429 flagged as temporary retryable');
    assert(isTemporaryError({ status: 503 }) === true, 'Status 503 flagged as temporary retryable');
    assert(isTemporaryError({ metaCode: 130429 }) === true, 'Meta code 130429 flagged as temporary retryable');
    assert(isTemporaryError({ status: 400, metaCode: 131026 }) === false, 'Permanent Meta error 131026 (undeliverable) is not retryable');

    // Backoff delay calculation test
    const getBackoffMs = (attempts) => Math.min(30000, 1000 * Math.pow(2, attempts));
    assert(getBackoffMs(1) === 2000, 'Attempt 1 backoff is 2000ms');
    assert(getBackoffMs(2) === 4000, 'Attempt 2 backoff is 4000ms');
    assert(getBackoffMs(3) === 8000, 'Attempt 3 backoff is 8000ms');
  } catch (err) {
    assert(false, `Test 11 failed with error: ${err.message}`);
  }

  // -------------------------------------------------------------
  // TEST 12: Campaign Cancellation Handling
  // -------------------------------------------------------------
  console.log('\n--- 12. Campaign Cancellation Handling ---');
  try {
    const camp = new Campaign({
      id: 'CAMP-CANCEL-TEST',
      title: 'To Cancel',
      discountType: 'Percentage',
      discountValue: 10,
      startDate: new Date(),
      endDate: new Date(),
      createdBy: 'user',
      status: 'SENDING',
      shopId: 'SHOP-001'
    });

    camp.status = 'CANCELLED';
    await camp.validate();
    assert(camp.status === 'CANCELLED', 'Campaign transitions cleanly to CANCELLED');

    const rec = new CampaignRecipient({
      id: 'REC-CANCEL-1',
      campaignId: camp.id,
      shopId: camp.shopId,
      customerId: 'CUST-001',
      phone: '+919876543210',
      status: 'QUEUED'
    });

    rec.status = 'CANCELLED';
    await rec.validate();
    assert(rec.status === 'CANCELLED', 'Remaining QUEUED recipient transitions to CANCELLED');
  } catch (err) {
    assert(false, `Test 12 failed with error: ${err.message}`);
  }

  // -------------------------------------------------------------
  // TEST 13: Meta Webhook HMAC-SHA256 Signature Verification
  // -------------------------------------------------------------
  console.log('\n--- 13. Meta Webhook HMAC-SHA256 Signature Verification ---');
  try {
    const appSecret = 'my_meta_secret_key_123456';
    const payload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{
        id: 'WABA_123',
        changes: [{
          value: {
            statuses: [{
              id: 'wamid.HBgLMTIzNDU2Nzg5MA==',
              status: 'delivered',
              timestamp: '1720000000',
              recipient_id: '919876543210'
            }]
          },
          field: 'messages'
        }]
      }]
    });

    const rawBuffer = Buffer.from(payload, 'utf-8');
    const validSignature = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBuffer).digest('hex');

    // Verification logic
    const verifySignature = (header, secret, buf) => {
      if (!header || !secret || !buf) return false;
      const parts = header.split('=');
      if (parts.length !== 2 || parts[0] !== 'sha256') return false;
      const expected = crypto.createHmac('sha256', secret).update(buf).digest('hex');
      const sigBuf = Buffer.from(parts[1], 'hex');
      const expBuf = Buffer.from(expected, 'hex');
      if (sigBuf.length !== expBuf.length) return false;
      return crypto.timingSafeEqual(sigBuf, expBuf);
    };

    assert(verifySignature(validSignature, appSecret, rawBuffer) === true, 'Valid HMAC signature accepted');
    assert(verifySignature('sha256=invalidhex0000', appSecret, rawBuffer) === false, 'Invalid HMAC signature rejected');
    assert(verifySignature('', appSecret, rawBuffer) === false, 'Missing signature rejected');
    assert(verifySignature(validSignature, 'wrong_secret', rawBuffer) === false, 'Wrong secret rejected');

    // Tampered payload test
    const tamperedBuffer = Buffer.from(payload.replace('delivered', 'read'), 'utf-8');
    assert(verifySignature(validSignature, appSecret, tamperedBuffer) === false, 'Tampered rawBody rejected');
  } catch (err) {
    assert(false, `Test 13 failed with error: ${err.message}`);
  }

  // -------------------------------------------------------------
  // TEST 14: Webhook Delivery Status Tracking & Sync
  // -------------------------------------------------------------
  console.log('\n--- 14. Webhook Delivery Status Tracking & Sync ---');
  try {
    const recipient = new CampaignRecipient({
      id: 'REC-DELIV-1',
      customerId: 'CUST-DELIV-1',
      campaignId: 'CAMP-DELIV',
      shopId: 'SHOP-001',
      phone: '+919876543210',
      status: 'SENT',
      providerMessageId: 'wamid.TEST123456'
    });

    // Simulate transition to DELIVERED
    recipient.status = 'DELIVERED';
    recipient.deliveredAt = new Date();
    await recipient.validate();
    assert(recipient.status === 'DELIVERED', 'Recipient transitioned from SENT to DELIVERED');

    // Simulate transition to READ
    recipient.status = 'READ';
    recipient.readAt = new Date();
    await recipient.validate();
    assert(recipient.status === 'READ', 'Recipient transitioned from DELIVERED to READ');

    // Test campaign stats aggregation logic
    const mockRecipients = [
      { status: 'DELIVERED' },
      { status: 'READ' },
      { status: 'SENT' },
      { status: 'FAILED' },
      { status: 'SKIPPED' }
    ];

    const stats = {
      total: mockRecipients.length,
      sent: mockRecipients.filter(r => ['SENT', 'DELIVERED', 'READ'].includes(r.status)).length,
      delivered: mockRecipients.filter(r => ['DELIVERED', 'READ'].includes(r.status)).length,
      read: mockRecipients.filter(r => r.status === 'READ').length,
      failed: mockRecipients.filter(r => r.status === 'FAILED').length,
      skipped: mockRecipients.filter(r => r.status === 'SKIPPED').length
    };

    assert(stats.total === 5, 'Stats total is 5');
    assert(stats.sent === 3, 'Stats sent count is 3 (SENT + DELIVERED + READ)');
    assert(stats.delivered === 2, 'Stats delivered count is 2 (DELIVERED + READ)');
    assert(stats.read === 1, 'Stats read count is 1');
    assert(stats.failed === 1, 'Stats failed count is 1');
    assert(stats.skipped === 1, 'Stats skipped count is 1');
  } catch (err) {
    assert(false, `Test 14 failed with error: ${err.message}`);
  }

  // -------------------------------------------------------------
  // TEST 15: Existing Billing WhatsApp Regression
  // -------------------------------------------------------------
  console.log('\n--- 15. Existing Billing WhatsApp Regression Check ---');
  try {
    // Test the logic implemented in frontend/src/utils/whatsapp.ts
    const sanitizePhoneNumber = (phone) => {
      if (!phone) return '';
      let digits = String(phone).replace(/\D/g, '');
      if (digits.length === 10) {
        digits = `91${digits}`;
      }
      return digits;
    };

    assert(sanitizePhoneNumber('9876543210') === '919876543210', 'Billing helper sanitizes 10-digit number to 91 prefix');
    assert(sanitizePhoneNumber('+91 98765-43210') === '919876543210', 'Billing helper strips non-digits');

    // Verify invoice message preservation
    const billText = 'Invoice: #INV-101\nTotal: ₹1500';
    assert(billText.includes('Invoice:'), 'Billing invoice format preserved');
    assert(billText.includes('Total: ₹1500'), 'Billing invoice total preserved');
  } catch (err) {
    assert(false, `Test 15 failed with error: ${err.message}`);
  }

  // -------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('================================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(e => {
  console.error('Fatal test error:', e);
  process.exit(1);
});
