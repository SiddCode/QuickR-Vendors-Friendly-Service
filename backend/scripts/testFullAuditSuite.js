import assert from 'node:assert/strict';
import http from 'node:http';
import { Duplex } from 'node:stream';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';

mongoose.set('bufferCommands', false);

process.env.QUICKR_TEST_IMPORT = 'true';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'quickr-audit-test-jwt-secret-key-min-32-chars';
process.env.META_TOKEN_ENCRYPTION_KEY = process.env.META_TOKEN_ENCRYPTION_KEY || 'quickr-audit-test-encryption-key-32-bytes!';
process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'audit_verify_token_123';
process.env.META_APP_SECRET = 'audit_meta_app_secret_123';

const bcrypt = (await import('bcryptjs')).default;
const { getJwtSecret } = await import('../config/jwt.js');
const {
  escapeRegex,
  sanitizeSpreadsheetCell,
  asSafeString,
  securityHeadersMiddleware,
  compressionMiddleware,
  createRateLimiter
} = await import('../utils/security.js');
const { encryptToken, decryptToken } = await import('../utils/crypto.js');
const { getISTDayBounds, calculateScheduledDateIST } = await import('../utils/date.js');
const { calculatePriorityAndReason } = await import('../services/priorityService.js');
const {
  extractInvoiceNumericValue,
  formatInvoiceNumber,
  allocateNextInvoiceNumber
} = await import('../services/invoiceCounterService.js');
const { InvoiceCounter } = await import('../models/InvoiceCounter.js');
const { app: serverApp } = await import('../server.js');
const { Sale } = await import('../models/Sale.js');
const { Activity } = await import('../models/Activity.js');
const { PrivacyAuditLog } = await import('../models/PrivacyAuditLog.js');
const { User } = await import('../models/User.js');
const { Shop } = await import('../models/Shop.js');
const { Product } = await import('../models/Product.js');
const { Customer } = await import('../models/Customer.js');
const { ConsentRecord } = await import('../models/ConsentRecord.js');
const { Campaign } = await import('../models/Campaign.js');
const { CampaignRecipient } = await import('../models/CampaignRecipient.js');
const { CampaignResponse } = await import('../models/CampaignResponse.js');
const { WhatsAppConnection } = await import('../models/WhatsAppConnection.js');
const { Message } = await import('../models/Message.js');
const { FollowUp } = await import('../models/FollowUp.js');
const { Enquiry } = await import('../models/Enquiry.js');
const { StorageCleanupSetting } = await import('../models/StorageCleanupSetting.js');
const { OtpVerification } = await import('../models/OtpVerification.js');
const { PrivacyRequest } = await import('../models/PrivacyRequest.js');

const { adminRouter } = await import('../routes/admin.js');
const { aiRouter } = await import('../routes/ai.js');
const { reengagementRouter } = await import('../routes/reengagement.js');
const { campaignRouter } = await import('../routes/campaigns.js');
const { whatsappRouter } = await import('../routes/whatsapp.js');
const { storageRouter } = await import('../routes/storage.js');
const { privacyRouter } = await import('../routes/privacy.js');

let passed = 0;
let failed = 0;

async function runTest(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    failed++;
    console.error(`  [FAIL] ${name}: ${err.stack || err.message}`);
  }
}

function makeQuery(valueOrFn) {
  const resolveValue = async () => (typeof valueOrFn === 'function' ? valueOrFn() : valueOrFn);
  const q = {
    select() { return q; },
    sort() { return q; },
    limit() { return q; },
    skip() { return q; },
    populate() { return q; },
    session() { return q; },
    lean() { return resolveValue(); },
    then(onFulfilled, onRejected) {
      return resolveValue().then(onFulfilled, onRejected);
    },
    catch(onRejected) {
      return resolveValue().catch(onRejected);
    }
  };
  return q;
}

class StubTracker {
  constructor() {
    this.restores = [];
  }
  stub(obj, key, impl) {
    const hadOwn = Object.prototype.hasOwnProperty.call(obj, key);
    const original = obj[key];
    obj[key] = impl;
    this.restores.push(() => {
      if (hadOwn) obj[key] = original;
      else obj[key] = original;
    });
  }
  restoreAll() {
    while (this.restores.length > 0) {
      const fn = this.restores.pop();
      fn();
    }
  }
}

function signToken(payload) {
  return jwt.sign(payload, getJwtSecret(), { algorithm: 'HS256', expiresIn: '1h' });
}

function makeUnsignedNoneToken(payload) {
  const h = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${h}.${p}.`;
}

async function httpRequest(app, method, path, { headers = {}, body = undefined, rawBody = undefined } = {}) {
  const finalHeaders = {};
  for (const [k, v] of Object.entries(headers)) {
    finalHeaders[k.toLowerCase()] = v;
  }
  let payloadBuffer;
  if (rawBody !== undefined) {
    payloadBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody));
  } else if (body !== undefined) {
    payloadBuffer = Buffer.from(JSON.stringify(body));
    if (!finalHeaders['content-type']) finalHeaders['content-type'] = 'application/json';
  }
  if (payloadBuffer !== undefined && !finalHeaders['content-length']) {
    finalHeaders['content-length'] = String(payloadBuffer.length);
  }

  return new Promise((resolve, reject) => {
    const reqSocket = new Duplex({
      allowHalfOpen: true,
      autoDestroy: false,
      read() {},
      write(_chunk, _enc, cb) { cb(); }
    });
    reqSocket.remoteAddress = '127.0.0.1';

    const resSocket = new Duplex({
      allowHalfOpen: true,
      autoDestroy: false,
      read() {},
      write(_chunk, _enc, cb) { cb(); }
    });
    resSocket.remoteAddress = '127.0.0.1';

    const req = new http.IncomingMessage(reqSocket);
    req.method = method;
    req.url = path;
    req.httpVersion = '1.1';
    req.httpVersionMajor = 1;
    req.httpVersionMinor = 1;
    req.headers = finalHeaders;
    setImmediate(() => {
      if (payloadBuffer !== undefined && payloadBuffer.length > 0) {
        req.push(payloadBuffer);
      }
      req.push(null);
    });

    const res = new http.ServerResponse(req);
    res.assignSocket(resSocket);

    const bodyChunks = [];
    const origWrite = res.write.bind(res);
    const origEnd = res.end.bind(res);
    res.write = (chunk, encoding, cb) => {
      if (chunk) bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8'));
      return origWrite(chunk, encoding, cb);
    };
    res.end = (chunk, encoding, cb) => {
      if (chunk && typeof chunk !== 'function') {
        bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8'));
      }
      return origEnd(chunk, encoding, cb);
    };

    res.on('error', reject);
    const guardTimer = setTimeout(() => {
      reject(new Error(`httpRequest timeout waiting for finish on ${method} ${path} (status=${res.statusCode}, headersSent=${res.headersSent}, ended=${req.readableEnded}, writableEnded=${res.writableEnded}, socket=${Boolean(res.socket)})`));
    }, 2000);
    res.on('finish', () => {
      clearTimeout(guardTimer);
      try {
        const resHeaders = {};
        for (const [k, v] of Object.entries(res.getHeaders())) {
          resHeaders[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
        }
        let buf = Buffer.concat(bodyChunks);
        const enc = resHeaders['content-encoding'];
        if (enc === 'gzip' && buf.length > 0) {
          buf = zlib.gunzipSync(buf);
        }
        const text = buf.toString('utf8');
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          // Non-JSON body
        }
        resolve({ status: res.statusCode, headers: resHeaders, text, json });
      } catch (err) {
        reject(err);
      }
    });

    app.handle(req, res, (err) => {
      if (err) reject(err);
    });
  });
}

function setupDefaultAuthStubs(stubs, {
  user = { id: 'USR-OWNER', name: 'Owner', email: 'owner@shop.test', shopId: 'SHOP-001', role: 'owner', status: 'active' },
  shop = { customId: 'SHOP-001', name: 'Silk Palace', status: 'active', subscriptionStatus: 'active' }
} = {}) {
  stubs.stub(User, 'findOne', (query = {}) => {
    if (query.role === 'admin' && query.id === 'USR-ADMIN') {
      return makeQuery({ id: 'USR-ADMIN', name: 'Admin', email: 'admin@quickr.test', role: 'admin', status: 'active' });
    }
    if (user && query.id === user.id) {
      return makeQuery(user);
    }
    return makeQuery(null);
  });
  stubs.stub(Shop, 'findOne', () => makeQuery(shop));
}

async function main() {
  console.log('\n=== QuickR Full Production Audit Automated Verification Suite ===\n');

  // ---------------------------------------------------------------------------
  // 1. SECURITY, CRYPTO, DATE & PRIORITY ENGINE UNIT CHECKS
  // ---------------------------------------------------------------------------
  console.log('1. Security, Crypto, Date & Priority Utilities:');

  await runTest('escapeRegex escapes all RegExp metacharacters', async () => {
    assert.equal(escapeRegex('a+b(c)?[d]{1}.*$^|\\'), 'a\\+b\\(c\\)\\?\\[d\\]\\{1\\}\\.\\*\\$\\^\\|\\\\');
    assert.equal(escapeRegex(null), '');
  });

  await runTest('sanitizeSpreadsheetCell neutralizes CSV/Excel formula injection', async () => {
    assert.equal(sanitizeSpreadsheetCell('=CMD|"/C calc"!A0'), '\'=CMD|"/C calc"!A0');
    assert.equal(sanitizeSpreadsheetCell('+1234'), '\'+1234');
    assert.equal(sanitizeSpreadsheetCell('-1234'), '\'-1234');
    assert.equal(sanitizeSpreadsheetCell('@SUM(A1:A2)'), '\'@SUM(A1:A2)');
    assert.equal(sanitizeSpreadsheetCell('\t=1+1'), '\'\t=1+1');
    assert.equal(sanitizeSpreadsheetCell('  =HYPERLINK("bad")'), '\'  =HYPERLINK("bad")');
    assert.equal(sanitizeSpreadsheetCell('Plain Text'), 'Plain Text');
  });

  await runTest('asSafeString blocks NoSQL operator objects', async () => {
    assert.equal(asSafeString('active'), 'active');
    assert.equal(asSafeString({ $ne: '' }), '');
    assert.equal(asSafeString(['a', 'b']), '');
    assert.equal(asSafeString(undefined), '');
  });

  await runTest('encryptToken & decryptToken round-trip AES-256-GCM tokens and fail closed in prod without env keys', async () => {
    const enc = encryptToken('EAAG-sample-meta-token');
    assert.ok(enc.encryptedData && enc.iv && enc.authTag);
    assert.equal(decryptToken(enc.encryptedData, enc.iv, enc.authTag), 'EAAG-sample-meta-token');

    const prevEnv = process.env.NODE_ENV;
    const prevEnc = process.env.META_TOKEN_ENCRYPTION_KEY;
    const prevJwt = process.env.JWT_SECRET;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.META_TOKEN_ENCRYPTION_KEY;
      delete process.env.JWT_SECRET;
      assert.throws(() => encryptToken('secret'), /META_TOKEN_ENCRYPTION_KEY or JWT_SECRET is required/i);
    } finally {
      process.env.NODE_ENV = prevEnv;
      process.env.META_TOKEN_ENCRYPTION_KEY = prevEnc;
      process.env.JWT_SECRET = prevJwt;
    }
  });

  await runTest('IST date helpers compute valid UTC day bounds and Invalid Date falls back safely', async () => {
    const bounds = getISTDayBounds(new Date('2026-05-10T20:00:00.000Z')); // 2026-05-11 01:30 IST
    assert.equal(bounds.istDateStr, '2026-05-11');
    assert.equal(bounds.endOfToday.getTime() - bounds.startOfToday.getTime(), 24 * 60 * 60 * 1000 - 1);

    const tomorrow = calculateScheduledDateIST('Tomorrow');
    assert.ok(tomorrow instanceof Date && !isNaN(tomorrow.getTime()));

    const bad = calculateScheduledDateIST('not-a-date');
    assert.ok(bad instanceof Date && !isNaN(bad.getTime()));
  });

  await runTest('priorityService respects product.availability=0 and handles Invalid scheduledAt', async () => {
    const outOfStockRes = calculatePriorityAndReason(
      { scheduledAt: 'invalid-date' },
      { interest: 'Very Interested', createdAt: new Date().toISOString() },
      { totalPurchases: 0 },
      { name: 'Banarasi Silk', availability: 0, availableQuantity: 25 }
    );
    assert.equal(outOfStockRes.daysOverdue, 0);
    // score = 30 (Very Interested) + 15 (recent) = 45 => should NOT add +15 for stock when availability === 0
    assert.equal(outOfStockRes.score, 45);
    assert.equal(outOfStockRes.priority, 'Medium');
  });

  // ---------------------------------------------------------------------------
  // 2. MONGOOSE SCHEMA CONTRACTS
  // ---------------------------------------------------------------------------
  console.log('\n2. Mongoose Schema & Validation Contracts:');

  await runTest('Sale pre-validate converts blank/empty requestId to undefined for sparse unique index', async () => {
    const doc = new Sale({
      id: 'SALE-001',
      invoiceNumber: 'INV-000001',
      items: [{ productName: 'Kurti', quantity: 1, rate: 500, total: 500 }],
      subtotal: 500,
      totalAmount: 500,
      paymentMethod: 'Cash',
      requestId: '   ',
      shopId: 'SHOP-001'
    });
    await doc.validate();
    assert.equal(doc.requestId, undefined);
  });

  await runTest('Activity defaults customerId to system when omitted', async () => {
    const act = new Activity({ id: 'ACT-1', type: 'CAMPAIGN_CREATED', description: 'Created campaign', shopId: 'SHOP-001' });
    await act.validate();
    assert.equal(act.customerId, 'system');
  });

  await runTest('PrivacyAuditLog accepts newly audited actions (OFFER_PERMISSION_*, ACCOUNT_DELETED, PRIVACY_REQUEST_*)', async () => {
    for (const action of ['OFFER_PERMISSION_ENABLED', 'OFFER_PERMISSION_DISABLED', 'ACCOUNT_DELETED', 'PRIVACY_REQUEST_CREATED', 'PRIVACY_REQUEST_UPDATED']) {
      const log = new PrivacyAuditLog({ id: `PAL-${action}`, userId: 'USR-1', action });
      await log.validate();
    }
  });

  // ---------------------------------------------------------------------------
  // 3. EXPRESS APP MOUNT & HTTP INTEGRATION TESTS
  // ---------------------------------------------------------------------------
  console.log('\n3. Live Ephemeral HTTP Route, Security, RBAC & Logic Tests:');

  const app = express();
  app.use(cookieParser());
  app.use(express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    }
  }));
  app.use(securityHeadersMiddleware);
  app.use(compressionMiddleware);

  const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 2, message: 'Slow down test' });
  app.get('/api/test-rate-limit', limiter, (_req, res) => res.json({ ok: true }));
  app.get('/api/test-large-json', (_req, res) => {
    res.json({ items: Array.from({ length: 80 }, (_, i) => ({ id: i, text: 'QuickR payload compression check' })) });
  });

  app.use('/api/admin', adminRouter);
  app.use('/api/ai', aiRouter);
  app.use('/api/reengagement', reengagementRouter);
  app.use('/api/campaigns', campaignRouter);
  app.use('/api/whatsapp', whatsappRouter);
  app.use('/api/storage', storageRouter);
  app.use('/api/privacy', privacyRouter);

  {
    await runTest('securityHeadersMiddleware & compressionMiddleware gzip payloads >= 1024 bytes', async () => {
      const small = await httpRequest(app, 'GET', '/api/test-rate-limit');
      assert.equal(small.status, 200);
      assert.equal(small.headers['x-content-type-options'], 'nosniff');
      assert.equal(small.headers['x-frame-options'], 'DENY');
      assert.equal(small.headers['content-encoding'], undefined);

      const large = await httpRequest(app, 'GET', '/api/test-large-json', {
        headers: { 'accept-encoding': 'gzip' }
      });
      assert.equal(large.status, 200);
      assert.equal(large.headers['content-encoding'], 'gzip');
      assert.equal(large.json.items.length, 80);
    });

    await runTest('createRateLimiter returns HTTP 429 and Retry-After once limit exceeded', async () => {
      // Request #1 happened inside test above; #2 allowed, #3 blocked
      const res2 = await httpRequest(app, 'GET', '/api/test-rate-limit');
      assert.equal(res2.status, 200);
      const res3 = await httpRequest(app, 'GET', '/api/test-rate-limit');
      assert.equal(res3.status, 429);
      assert.ok(Number(res3.headers['retry-after']) >= 1);
      assert.equal(res3.json.success, false);
    });

    await runTest('requireAuth rejects unsigned alg=none JWT, disabled users, and suspended shops', async () => {
      const stubs = new StubTracker();
      try {
        const noneToken = makeUnsignedNoneToken({ id: 'USR-ADMIN', role: 'admin' });
        const rNone = await httpRequest(app, 'GET', '/api/ai/health', {
          headers: { authorization: `Bearer ${noneToken}` }
        });
        assert.equal(rNone.status, 401);

        const ownerToken = signToken({ id: 'USR-OWNER', shopId: 'SHOP-001', role: 'owner' });

        // Disabled user -> 403
        setupDefaultAuthStubs(stubs, {
          user: { id: 'USR-OWNER', name: 'Owner', email: 'o@s.com', shopId: 'SHOP-001', role: 'owner', status: 'disabled' }
        });
        const rDisabledUser = await httpRequest(app, 'GET', '/api/ai/health', {
          headers: { authorization: `Bearer ${ownerToken}` }
        });
        assert.equal(rDisabledUser.status, 403);

        // Suspended shop -> 403
        setupDefaultAuthStubs(stubs, {
          user: { id: 'USR-OWNER', name: 'Owner', email: 'o@s.com', shopId: 'SHOP-001', role: 'owner', status: 'active' },
          shop: { customId: 'SHOP-001', name: 'Silk Palace', status: 'active', subscriptionStatus: 'suspended' }
        });
        const rSuspended = await httpRequest(app, 'GET', '/api/ai/health', {
          headers: { authorization: `Bearer ${ownerToken}` }
        });
        assert.equal(rSuspended.status, 403);
      } finally {
        stubs.restoreAll();
      }
    });

    await runTest('RBAC: staff gets 403 on all sensitive routes; /api/ai/test-ollama & /api/admin enforce requireAdmin', async () => {
      const stubs = new StubTracker();
      try {
        setupDefaultAuthStubs(stubs, {
          user: { id: 'USR-STAFF', name: 'Staff', email: 'staff@s.com', shopId: 'SHOP-001', role: 'staff', status: 'active' }
        });
        const staffToken = signToken({ id: 'USR-STAFF', shopId: 'SHOP-001', role: 'staff' });
        const ownerToken = signToken({ id: 'USR-OWNER', shopId: 'SHOP-001', role: 'owner' });

        const staffDeniedPaths = [
          ['POST', '/api/ai/customer-intelligence'],
          ['POST', '/api/ai/sales-opportunity'],
          ['POST', '/api/ai/followup-priorities'],
          ['POST', '/api/ai/shop-insights'],
          ['POST', '/api/ai/trends'],
          ['GET', '/api/reengagement/summary'],
          ['GET', '/api/campaigns/dashboard-metrics'],
          ['POST', '/api/whatsapp/connect'],
          ['GET', '/api/storage/cleanup'],
          ['GET', '/api/privacy/activity-security']
        ];

        for (const [m, p] of staffDeniedPaths) {
          const r = await httpRequest(app, m, p, {
            headers: { authorization: `Bearer ${staffToken}` },
            body: m === 'POST' ? {} : undefined
          });
          assert.equal(r.status, 403, `Expected 403 for staff on ${m} ${p}, got ${r.status}`);
        }

        // Unauthenticated /api/ai/test-ollama -> 401
        const rOllamaUnauth = await httpRequest(app, 'POST', '/api/ai/test-ollama', { body: {} });
        assert.equal(rOllamaUnauth.status, 401);

        // Non-admin owner on /api/ai/test-ollama & /api/admin/shops -> 403
        setupDefaultAuthStubs(stubs, {
          user: { id: 'USR-OWNER', name: 'Owner', email: 'o@s.com', shopId: 'SHOP-001', role: 'owner', status: 'active' }
        });
        const rOllamaOwner = await httpRequest(app, 'POST', '/api/ai/test-ollama', {
          headers: { authorization: `Bearer ${ownerToken}` },
          body: {}
        });
        assert.equal(rOllamaOwner.status, 403);

        const rAdminOwner = await httpRequest(app, 'GET', '/api/admin/shops', {
          headers: { authorization: `Bearer ${ownerToken}` }
        });
        assert.equal(rAdminOwner.status, 403);
      } finally {
        stubs.restoreAll();
      }
    });

    await runTest('Admin router: blocks NoSQL $ne query injection, rejects OTP bypasses, and logs SHOP_UPDATED on rename', async () => {
      const stubs = new StubTracker();
      try {
        setupDefaultAuthStubs(stubs);
        const adminToken = signToken({ id: 'USR-ADMIN', role: 'admin' });

        let capturedUserFilter = null;
        stubs.stub(User, 'find', (filter) => {
          capturedUserFilter = filter;
          return makeQuery([]);
        });
        stubs.stub(Shop, 'find', () => makeQuery([]));

        const rUsers = await httpRequest(app, 'GET', '/api/admin/users?shopId[$ne]=x&role[$gt]=a', {
          headers: { authorization: `Bearer ${adminToken}` }
        });
        assert.equal(rUsers.status, 200, rUsers.text);
        assert.equal(capturedUserFilter.shopId, undefined);
        assert.equal(capturedUserFilter.role, undefined);

        // Reject missing/fake TEST_BYPASS OTP token even with x-bypass-otp header
        const rBypass = await httpRequest(app, 'POST', '/api/admin/shops', {
          headers: { authorization: `Bearer ${adminToken}`, 'x-bypass-otp': 'true' },
          body: {
            shopName: 'Test Shop',
            ownerName: 'Owner',
            ownerEmail: 'newowner@example.com',
            ownerPhone: '9876543210',
            password: 'password123',
            otpVerificationToken: 'TEST_BYPASS'
          }
        });
        assert.equal(rBypass.status, 400);

        // Reject OTP JWT issued for wrong purpose
        const wrongPurposeOtp = signToken({ verified: true, purpose: 'login' });
        const rWrongOtp = await httpRequest(app, 'POST', '/api/admin/shops', {
          headers: { authorization: `Bearer ${adminToken}` },
          body: {
            shopName: 'Test Shop',
            ownerName: 'Owner',
            ownerEmail: 'newowner@example.com',
            password: 'password123',
            otpVerificationToken: wrongPurposeOtp
          }
        });
        assert.equal(rWrongOtp.status, 400);

        // PUT /api/admin/shops/:shopId logs SHOP_UPDATED on name change
        const createdActivities = [];
        const mockShopDoc = {
          customId: 'SHOP-001',
          name: 'Old Name',
          status: 'active',
          phone: '',
          address: '',
          async save() { return this; }
        };
        stubs.stub(Shop, 'findOne', () => makeQuery(mockShopDoc));
        stubs.stub(Activity, 'create', async (doc) => {
          createdActivities.push(doc);
          return doc;
        });

        const rPut = await httpRequest(app, 'PUT', '/api/admin/shops/SHOP-001', {
          headers: { authorization: `Bearer ${adminToken}` },
          body: { name: 'New Silks' }
        });
        assert.equal(rPut.status, 200);
        assert.equal(rPut.json.name, 'New Silks');
        assert.ok(createdActivities.some((a) => a.type === 'SHOP_UPDATED'));
      } finally {
        stubs.restoreAll();
      }
    });

    await runTest('Reengagement enforces fail-closed marketing consent per shopId', async () => {
      const stubs = new StubTracker();
      try {
        setupDefaultAuthStubs(stubs);
        const ownerToken = signToken({ id: 'USR-OWNER', shopId: 'SHOP-001', role: 'owner' });

        const oldDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
        stubs.stub(Customer, 'find', () => makeQuery([
          { id: 'C-ACTIVE', name: 'Opted In', phone: '9876500001', shopId: 'SHOP-001', createdAt: oldDate },
          { id: 'C-NO-CONSENT', name: 'No Record', phone: '9876500002', shopId: 'SHOP-001', createdAt: oldDate },
          { id: 'C-WITHDRAWN', name: 'Withdrawn', phone: '9876500003', shopId: 'SHOP-001', createdAt: oldDate }
        ]));
        stubs.stub(ConsentRecord, 'find', () => makeQuery([
          { userId: 'C-ACTIVE', shopId: 'SHOP-001', purpose: 'marketing', status: 'active' },
          { userId: 'C-WITHDRAWN', shopId: 'SHOP-001', purpose: 'marketing', status: 'withdrawn' }
        ]));
        stubs.stub(Sale, 'find', () => makeQuery([]));
        stubs.stub(Sale, 'aggregate', async () => ([
          { _id: 'C-ACTIVE', lastPurchaseDate: oldDate, totalSpent: 3000, purchaseCount: 2 },
          { _id: 'C-NO-CONSENT', lastPurchaseDate: oldDate, totalSpent: 3000, purchaseCount: 2 },
          { _id: 'C-WITHDRAWN', lastPurchaseDate: oldDate, totalSpent: 3000, purchaseCount: 2 }
        ]));
        stubs.stub(Enquiry, 'find', () => makeQuery([]));
        stubs.stub(FollowUp, 'find', () => makeQuery([]));
        stubs.stub(CampaignRecipient, 'find', () => makeQuery([]));
        stubs.stub(Product, 'find', () => makeQuery([]));

        const res = await httpRequest(app, 'GET', '/api/reengagement/customers', {
          headers: { authorization: `Bearer ${ownerToken}` }
        });
        assert.equal(res.status, 200, res.text);
        assert.equal(res.json.totalPotential, 3, res.text);
        assert.equal(res.json.whatsappEligibleCount, 1, res.text);
        assert.equal(res.json.notEligibleCount, 2, res.text);
        const eligibleList = res.json.customers.filter((c) => c.whatsappEligible);
        assert.equal(eligibleList.length, 1, res.text);
        assert.equal(eligibleList[0].id, 'C-ACTIVE', res.text);
      } finally {
        stubs.restoreAll();
      }
    });

    await runTest('Campaigns: product_buyers fails closed on 0 sales, analytics counts DELIVERED/READ, export escapes formulas, recipients escapes regex', async () => {
      const stubs = new StubTracker();
      try {
        setupDefaultAuthStubs(stubs);
        const ownerToken = signToken({ id: 'USR-OWNER', shopId: 'SHOP-001', role: 'owner' });

        // 1. targeting-customers?filterType=product_buyers with no buyers returns 0 customers
        let capturedSaleFilter = null;
        stubs.stub(Sale, 'find', (filter) => {
          capturedSaleFilter = filter;
          return makeQuery([]);
        });
        stubs.stub(Customer, 'find', () => makeQuery([
          { id: 'C-1', name: 'Asha', phone: '9876500001', shopId: 'SHOP-001', totalSpent: 5000 }
        ]));
        stubs.stub(ConsentRecord, 'find', () => makeQuery([
          { userId: 'C-1', shopId: 'SHOP-001', purpose: 'marketing', status: 'active' }
        ]));
        stubs.stub(Enquiry, 'find', () => makeQuery([]));

        const rTarget = await httpRequest(app, 'GET', '/api/campaigns/targeting-customers?filterType=product_buyers&productId=PROD-NONE', {
          headers: { authorization: `Bearer ${ownerToken}` }
        });
        assert.equal(rTarget.status, 200, rTarget.text);
        assert.equal(capturedSaleFilter['items.productId'], 'PROD-NONE');
        assert.ok(Array.isArray(rTarget.json?.eligibleCustomers), rTarget.text);
        assert.equal(rTarget.json.eligibleCustomers.length, 0);

        // 2. analytics counts DELIVERED & READ in sentCustomers and analytics/summary counts apiSentCustomers accurately
        const campaignDoc = {
          id: 'CMP-1',
          shopId: 'SHOP-001',
          title: 'Festive Silk Sale',
          name: 'Festive Silk Sale',
          discountType: 'Percentage',
          discountValue: 10,
          status: 'COMPLETED',
          type: 'OFFER',
          totalCustomers: 3,
          sentCount: 3,
          failedCount: 0,
          createdAt: new Date()
        };
        stubs.stub(Campaign, 'findOne', () => makeQuery(campaignDoc));
        stubs.stub(Campaign, 'find', () => makeQuery([campaignDoc]));
        stubs.stub(CampaignRecipient, 'find', () => makeQuery([
          { id: 'CR-1', campaignId: 'CMP-1', customerId: 'C-1', customerName: 'Asha', customerPhone: '9876500001', status: 'DELIVERED', costEstimated: 0.78 },
          { id: 'CR-2', campaignId: 'CMP-1', customerId: 'C-2', customerName: 'Bala', customerPhone: '9876500002', status: 'READ', costEstimated: 0.78 },
          { id: 'CR-3', campaignId: 'CMP-1', customerId: 'C-3', customerName: '=CMD|"/C calc"!A0', customerPhone: '+919876500003', status: 'MANUAL_SENT', costEstimated: 0 }
        ]));
        stubs.stub(CampaignRecipient, 'aggregate', async () => [{ _id: 'CMP-1', count: 3 }]);
        stubs.stub(CampaignResponse, 'find', () => makeQuery([]));
        stubs.stub(CampaignResponse, 'aggregate', async () => []);
        stubs.stub(Sale, 'aggregate', async () => [{ _id: 'CMP-1', count: 1, revenue: 1200, salesCount: 1 }]);

        const rAnalytics = await httpRequest(app, 'GET', '/api/campaigns/CMP-1/analytics', {
          headers: { authorization: `Bearer ${ownerToken}` }
        });
        assert.equal(rAnalytics.status, 200, rAnalytics.text);
        assert.equal(rAnalytics.json.analytics.sentCustomers, 3, rAnalytics.text);
        assert.equal(rAnalytics.json.analytics.manualSentCustomers, 1, rAnalytics.text);
        assert.equal(rAnalytics.json.analytics.apiSentCustomers, 2, rAnalytics.text);
        assert.equal(rAnalytics.json.analytics.deliveredCustomers, 2, rAnalytics.text);
        assert.equal(rAnalytics.json.analytics.readCustomers, 1, rAnalytics.text);

        const rSummary = await httpRequest(app, 'GET', '/api/campaigns/analytics/summary', {
          headers: { authorization: `Bearer ${ownerToken}` }
        });
        assert.equal(rSummary.status, 200, rSummary.text);
        assert.equal(rSummary.json.summaries.length, 1, rSummary.text);
        assert.equal(rSummary.json.summaries[0].sentCustomers, 3, rSummary.text);

        // 3. export CSV neutralizes spreadsheet formulas
        const rExport = await httpRequest(app, 'GET', '/api/campaigns/CMP-1/export', {
          headers: { authorization: `Bearer ${ownerToken}` }
        });
        assert.equal(rExport.status, 200);
        assert.ok(rExport.text.includes('\'=CMD'), 'Expected formula cell to be prefixed with apostrophe');

        // 4. recipients escapes regex characters & clamps limit
        let capturedRecFilter = null;
        let capturedLimit = null;
        stubs.stub(CampaignRecipient, 'countDocuments', () => makeQuery(1));
        stubs.stub(CampaignRecipient, 'find', (f) => {
          capturedRecFilter = f;
          const q = makeQuery([]);
          const origLimit = q.limit;
          q.limit = (n) => {
            capturedLimit = n;
            return origLimit.call(q, n);
          };
          return q;
        });

        const rRecs = await httpRequest(app, 'GET', '/api/campaigns/CMP-1/recipients?search=a%2Bb(c)&limit=9999', {
          headers: { authorization: `Bearer ${ownerToken}` }
        });
        assert.equal(rRecs.status, 200, rRecs.text);
        assert.ok(capturedRecFilter && capturedRecFilter.$or, `recFilter=${JSON.stringify(capturedRecFilter)}, body=${rRecs.text}`);
        assert.equal(capturedRecFilter.$or[0].customerName.$regex, 'a\\+b\\(c\\)');
        assert.ok(capturedLimit !== null && capturedLimit === 1000, `Expected clamped limit 1000 for limit=9999, got ${capturedLimit}`);
      } finally {
        stubs.restoreAll();
      }
    });

    await runTest('WhatsApp webhook: fails closed without secrets, validates HMAC timing-safely, enforces monotonic statuses & scoped STOP opt-out', async () => {
      const stubs = new StubTracker();
      const prevNodeEnv = process.env.NODE_ENV;
      const prevVerify = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
      const prevSecret = process.env.META_APP_SECRET;
      try {
        // 1. GET /webhook rejects when verify token unset
        delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
        const rGetNoCfg = await httpRequest(app, 'GET', '/api/whatsapp/webhook?hub.mode=subscribe&hub.challenge=123&hub.verify_token=');
        assert.equal(rGetNoCfg.status, 403);

        // 2. GET /webhook accepts exact verify token
        process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'audit_verify_token_123';
        const rGetOk = await httpRequest(app, 'GET', '/api/whatsapp/webhook?hub.mode=subscribe&hub.challenge=CHALLENGE_OK&hub.verify_token=audit_verify_token_123');
        assert.equal(rGetOk.status, 200);
        assert.equal(rGetOk.text, 'CHALLENGE_OK');

        // 3. POST /webhook rejects 503 in production when META_APP_SECRET is unset
        process.env.NODE_ENV = 'production';
        delete process.env.META_APP_SECRET;
        const rPostNoSecret = await httpRequest(app, 'POST', '/api/whatsapp/webhook', {
          body: { object: 'whatsapp_business_account', entry: [] }
        });
        assert.equal(rPostNoSecret.status, 503);

        // 4. POST /webhook rejects multi-byte UTF-8 signature safely without RangeError (401)
        process.env.META_APP_SECRET = 'audit_meta_app_secret_123';
        const rBadSig = await httpRequest(app, 'POST', '/api/whatsapp/webhook', {
          headers: { 'x-hub-signature-256': 'sha256=ééééinvalid' },
          body: { object: 'whatsapp_business_account', entry: [] }
        });
        assert.equal(rBadSig.status, 401);

        // 5. Valid signed webhook updates status monotonically (DELIVERED -> does not regress to SENT) + STOP opt-out scoped by phoneNumberId
        const recipientDoc = {
          id: 'CR-10',
          campaignId: 'CMP-10',
          shopId: 'SHOP-001',
          providerMessageId: 'wamid.test10',
          status: 'DELIVERED',
          async save() { return this; }
        };
        const skippedUpdates = [];
        const withdrawnConsentUpdates = [];

        stubs.stub(Message, 'findOne', () => makeQuery(null));
        stubs.stub(CampaignRecipient, 'findOne', () => makeQuery(recipientDoc));
        stubs.stub(CampaignRecipient, 'find', () => makeQuery([{ campaignId: 'CMP-10' }]));
        stubs.stub(CampaignRecipient, 'updateMany', async (filter, update) => {
          skippedUpdates.push({ filter, update });
          return { modifiedCount: 1 };
        });
        stubs.stub(CampaignRecipient, 'aggregate', async () => ([
          { _id: 'DELIVERED', count: 1, totalCost: 0.78 }
        ]));
        stubs.stub(Campaign, 'findOne', () => makeQuery({ id: 'CMP-10', shopId: 'SHOP-001', totalCustomers: 1, async save() { return this; } }));
        stubs.stub(Campaign, 'updateOne', async () => ({ modifiedCount: 1 }));
        stubs.stub(WhatsAppConnection, 'find', () => makeQuery([{ shopId: 'SHOP-001' }]));
        let capturedCustFilter = null;
        stubs.stub(Customer, 'find', (filter) => {
          capturedCustFilter = filter;
          return makeQuery([{ id: 'CUST-1', shopId: 'SHOP-001', phone: '+919876543210' }]);
        });
        stubs.stub(ConsentRecord, 'updateMany', async (filter, update) => {
          withdrawnConsentUpdates.push({ filter, update });
          return { modifiedCount: 1 };
        });

        const payloadObj = {
          object: 'whatsapp_business_account',
          entry: [{
            changes: [{
              value: {
                metadata: { phone_number_id: 'PNID-SHOP1' },
                statuses: [{ id: 'wamid.test10', status: 'sent', timestamp: '1700000000' }],
                messages: [{ from: '919876543210', text: { body: 'STOP' } }]
              }
            }]
          }]
        };
        const rawPayload = Buffer.from(JSON.stringify(payloadObj));
        const validSig = 'sha256=' + crypto.createHmac('sha256', process.env.META_APP_SECRET).update(rawPayload).digest('hex');

        const rWebhookOk = await httpRequest(app, 'POST', '/api/whatsapp/webhook', {
          headers: { 'content-type': 'application/json', 'x-hub-signature-256': validSig },
          rawBody: rawPayload
        });
        assert.equal(rWebhookOk.status, 200);
        // Monotonic guard prevented DELIVERED -> SENT regression
        assert.equal(recipientDoc.status, 'DELIVERED');
        // STOP customer query scoped to matched phoneNumberId shop
        assert.deepEqual(capturedCustFilter.shopId, { $in: ['SHOP-001'] });
        assert.equal(withdrawnConsentUpdates.length, 1);
        assert.equal(withdrawnConsentUpdates[0].update.$set.status, 'withdrawn');
        assert.equal(skippedUpdates[0].update.$set.status, 'SKIPPED');
      } finally {
        process.env.NODE_ENV = prevNodeEnv;
        process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = prevVerify;
        process.env.META_APP_SECRET = prevSecret;
        stubs.restoreAll();
      }
    });

    await runTest('Storage GET /cleanup is read-only; Privacy permission handles "false" safely and /my-data returns 404 if user missing', async () => {
      const stubs = new StubTracker();
      try {
        setupDefaultAuthStubs(stubs);
        const ownerToken = signToken({ id: 'USR-OWNER', shopId: 'SHOP-001', role: 'owner' });

        // 1. Storage GET /cleanup makes 0 DB mutations
        let storageWrites = 0;
        stubs.stub(StorageCleanupSetting, 'findOne', () => makeQuery({ shopId: 'SHOP-001', status: 'NONE' }));
        stubs.stub(StorageCleanupSetting, 'create', async () => { storageWrites++; return {}; });
        stubs.stub(StorageCleanupSetting, 'findOneAndUpdate', async () => { storageWrites++; return {}; });
        stubs.stub(StorageCleanupSetting, 'updateOne', async () => { storageWrites++; return {}; });
        stubs.stub(FollowUp, 'countDocuments', () => makeQuery(0));
        stubs.stub(Enquiry, 'countDocuments', () => makeQuery(0));
        stubs.stub(Message, 'countDocuments', () => makeQuery(0));
        stubs.stub(Activity, 'countDocuments', () => makeQuery(0));

        const rStorage = await httpRequest(app, 'GET', '/api/storage/cleanup', {
          headers: { authorization: `Bearer ${ownerToken}` }
        });
        assert.equal(rStorage.status, 200);
        assert.equal(storageWrites, 0);

        // 2. Privacy customer permission string "false" => withdrawn and preserves id via $setOnInsert
        let capturedConsentUpdate = null;
        stubs.stub(Customer, 'findOne', () => makeQuery({ id: 'CUST-99', shopId: 'SHOP-001', name: 'Meera' }));
        stubs.stub(ConsentRecord, 'findOneAndUpdate', async (_filter, update) => {
          capturedConsentUpdate = update;
          return { id: 'CR-PRESERVED', status: update.$set.status };
        });
        stubs.stub(PrivacyAuditLog, 'create', async (doc) => doc);

        const rPerm = await httpRequest(app, 'POST', '/api/privacy/customers/CUST-99/permission', {
          headers: { authorization: `Bearer ${ownerToken}` },
          body: { granted: 'false' }
        });
        assert.equal(rPerm.status, 200, rPerm.text);
        assert.equal(capturedConsentUpdate.$set.status, 'withdrawn');
        assert.equal(capturedConsentUpdate.$set.id, undefined);
        assert.ok(typeof capturedConsentUpdate.$setOnInsert?.id === 'string' && capturedConsentUpdate.$setOnInsert.id.length > 0, JSON.stringify(capturedConsentUpdate));

        // 3. Privacy /my-data returns 404 cleanly if User deleted after auth lookup
        let userLookupCount = 0;
        stubs.stub(User, 'findOne', () => {
          userLookupCount++;
          if (userLookupCount === 1) {
            return makeQuery({ id: 'USR-OWNER', name: 'Owner', email: 'o@s.com', shopId: 'SHOP-001', role: 'owner', status: 'active' });
          }
          return makeQuery(null);
        });
        stubs.stub(ConsentRecord, 'find', () => makeQuery([]));
        stubs.stub(PrivacyRequest, 'find', () => makeQuery([]));

        const rMyData = await httpRequest(app, 'GET', '/api/privacy/my-data', {
          headers: { authorization: `Bearer ${ownerToken}` }
        });
        assert.equal(rMyData.status, 404);
      } finally {
        stubs.restoreAll();
      }
    });

    await runTest('Privacy delete-account clears auth cookie with HttpOnly, Secure, and SameSite=None in production', async () => {
      const stubs = new StubTracker();
      const prevEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        const ownerUser = {
          id: 'USR-OWNER',
          name: 'Owner',
          email: 'owner@shop.test',
          shopId: 'SHOP-001',
          role: 'owner',
          status: 'active',
          async save() { return this; }
        };
        stubs.stub(User, 'findOne', () => makeQuery(ownerUser));
        stubs.stub(Shop, 'findOne', () => makeQuery({ customId: 'SHOP-001', name: 'Silk Palace', status: 'active', subscriptionStatus: 'active' }));
        stubs.stub(PrivacyAuditLog, 'create', async (doc) => doc);

        const ownerToken = signToken({ id: 'USR-OWNER', shopId: 'SHOP-001', role: 'owner' });
        const rDel = await httpRequest(app, 'POST', '/api/privacy/delete-account', {
          headers: { authorization: `Bearer ${ownerToken}` },
          body: { confirmationText: 'DELETE' }
        });
        assert.equal(rDel.status, 200, rDel.text);
        const setCookie = (rDel.headers['set-cookie'] || '').toLowerCase();
        assert.ok(setCookie.includes('token=;'), `Expected cleared token cookie, got: ${setCookie}`);
        assert.ok(setCookie.includes('httponly'), `Expected HttpOnly flag, got: ${setCookie}`);
        assert.ok(setCookie.includes('secure'), `Expected Secure flag, got: ${setCookie}`);
        assert.ok(setCookie.includes('samesite=none'), `Expected SameSite=None flag, got: ${setCookie}`);
        assert.equal(ownerUser.status, 'disabled');
      } finally {
        process.env.NODE_ENV = prevEnv;
        stubs.restoreAll();
      }
    });

    await runTest('InvoiceCounter & Sale unique indexes allocate sequentially from historical max and enforce uniqueness', async () => {
      assert.equal(extractInvoiceNumericValue('INV-000042'), 42);
      assert.equal(formatInvoiceNumber(7), 'INV-000007');
      assert.equal(formatInvoiceNumber(1234567), 'INV-1234567');

      const saleIndexes = Sale.schema.indexes();
      const invIdx = saleIndexes.find(([keys]) => keys.shopId === 1 && keys.invoiceNumber === 1 && Object.keys(keys).length === 2);
      const reqIdx = saleIndexes.find(([keys]) => keys.shopId === 1 && keys.requestId === 1 && Object.keys(keys).length === 2);
      assert.ok(invIdx && invIdx[1]?.unique === true, 'Expected unique compound index on { shopId: 1, invoiceNumber: 1 }');
      assert.ok(reqIdx && reqIdx[1]?.unique === true && reqIdx[1]?.sparse === true, 'Expected sparse unique index on { shopId: 1, requestId: 1 }');

      const stubs = new StubTracker();
      try {
        let counterCalls = 0;
        let seededSeq = null;
        stubs.stub(InvoiceCounter, 'findOneAndUpdate', async () => {
          counterCalls++;
          if (counterCalls === 1) return null; // First call triggers safe historical max seeding
          return { shopId: 'SHOP-HIST', seq: seededSeq + 1 };
        });
        stubs.stub(Sale, 'find', () => makeQuery([
          { invoiceNumber: 'INV-000001' },
          { invoiceNumber: 'INV-000012' }
        ]));
        stubs.stub(InvoiceCounter, 'updateOne', async (_filter, update) => {
          seededSeq = update.$setOnInsert.seq;
          assert.equal(seededSeq, 12, 'Must seed from max INV number (12), never count (2)');
          const dupErr = new Error('E11000 concurrent init');
          dupErr.code = 11000;
          throw dupErr;
        });

        const inv = await allocateNextInvoiceNumber('SHOP-HIST');
        assert.equal(inv, 'INV-000013');
      } finally {
        stubs.restoreAll();
      }
    });

    await runTest('Real server.js app: trust proxy, CORS preflight/strict check, production Set-Cookie attributes, and sale idempotency recovery', async () => {
      assert.equal(serverApp.get('trust proxy'), 1);

      const stubs = new StubTracker();
      const prevEnv = process.env.NODE_ENV;
      const prevCorsStrict = process.env.CORS_STRICT;
      try {
        // 1. OPTIONS preflight & CORS_STRICT enforcement
        process.env.CORS_STRICT = 'true';
        const rDeniedCors = await httpRequest(serverApp, 'OPTIONS', '/api/auth/login', {
          headers: { origin: 'https://unlisted-preview.vercel.app' }
        });
        assert.equal(rDeniedCors.status, 403);

        process.env.CORS_STRICT = 'false';
        const rPreflight = await httpRequest(serverApp, 'OPTIONS', '/api/auth/login', {
          headers: {
            origin: 'https://quickr-frontend.vercel.app',
            'access-control-request-method': 'POST'
          }
        });
        assert.equal(rPreflight.status, 204);
        assert.equal(rPreflight.headers['access-control-allow-origin'], 'https://quickr-frontend.vercel.app');
        assert.equal(rPreflight.headers['access-control-allow-credentials'], 'true');

        // 2. Production login Set-Cookie inspection (HttpOnly, Secure, SameSite=None, no Domain)
        process.env.NODE_ENV = 'production';
        const passHash = await bcrypt.hash('secret123', 4);
        stubs.stub(User, 'findOne', () => makeQuery({
          id: 'USR-LOGIN',
          name: 'Shop Owner',
          email: 'owner@quickr.test',
          passwordHash: passHash,
          shopId: 'SHOP-001',
          role: 'owner',
          status: 'active'
        }));
        stubs.stub(Shop, 'findOne', () => makeQuery({ customId: 'SHOP-001', name: 'Silk Palace', status: 'active', subscriptionStatus: 'active' }));
        stubs.stub(PrivacyAuditLog, 'create', async (doc) => doc);

        const rLogin = await httpRequest(serverApp, 'POST', '/api/auth/login', {
          headers: { origin: 'https://quickr-frontend.vercel.app' },
          body: { email: 'owner@quickr.test', password: 'secret123' }
        });
        assert.equal(rLogin.status, 200, rLogin.text);
        const loginCookie = String(rLogin.headers['set-cookie'] || '');
        const lowerCookie = loginCookie.toLowerCase();
        assert.ok(lowerCookie.includes('token='), loginCookie);
        assert.ok(lowerCookie.includes('httponly'), loginCookie);
        assert.ok(lowerCookie.includes('secure'), loginCookie);
        assert.ok(lowerCookie.includes('samesite=none'), loginCookie);
        assert.ok(!lowerCookie.includes('domain='), 'Expected host-only cookie with no Domain attribute');

        // 3. GET /api/sales/status/:requestId staff isolation & lookup
        const staffToken = signToken({ id: 'USR-STAFF-1', shopId: 'SHOP-001', role: 'staff' });
        const ownerToken = signToken({ id: 'USR-LOGIN', shopId: 'SHOP-001', role: 'owner' });

        stubs.stub(User, 'findOne', (q = {}) => {
          if (q.id === 'USR-STAFF-1') {
            return makeQuery({ id: 'USR-STAFF-1', name: 'Staff', email: 'st@q.t', shopId: 'SHOP-001', role: 'staff', status: 'active' });
          }
          return makeQuery({ id: 'USR-LOGIN', name: 'Owner', email: 'o@q.t', shopId: 'SHOP-001', role: 'owner', status: 'active' });
        });

        let capturedStatusQuery = null;
        stubs.stub(Sale, 'findOne', (q) => {
          capturedStatusQuery = q;
          return makeQuery(q.requestId === 'REQ-FOUND' ? { id: 'SALE-99', invoiceNumber: 'INV-000099', totalAmount: 500 } : null);
        });

        const rStatusFound = await httpRequest(serverApp, 'GET', '/api/sales/status/REQ-FOUND', {
          headers: { authorization: `Bearer ${staffToken}` }
        });
        assert.equal(rStatusFound.status, 200);
        assert.equal(rStatusFound.json.found, true);
        assert.equal(capturedStatusQuery['createdBy.userId'], 'USR-STAFF-1');

        const rStatusMiss = await httpRequest(serverApp, 'GET', '/api/sales/status/REQ-MISS', {
          headers: { authorization: `Bearer ${ownerToken}` }
        });
        assert.equal(rStatusMiss.status, 200);
        assert.equal(rStatusMiss.json.found, false);

        // 4. POST /api/sales upfront idempotency check returns duplicate: true without stock decrement
        let productUpdates = [];
        stubs.stub(Product, 'updateOne', async (f, u) => {
          productUpdates.push({ f, u });
          return { matchedCount: 1 };
        });

        const rUpfrontDup = await httpRequest(serverApp, 'POST', '/api/sales', {
          headers: { authorization: `Bearer ${ownerToken}` },
          body: {
            items: [{ productName: 'Kurti', quantity: 1, rate: 500, total: 500 }],
            totalAmount: 500,
            paymentMethod: 'Cash',
            requestId: 'REQ-FOUND'
          }
        });
        assert.equal(rUpfrontDup.status, 200, rUpfrontDup.text);
        assert.equal(rUpfrontDup.json.duplicate, true);
        assert.equal(rUpfrontDup.json.sale.invoiceNumber, 'INV-000099');
        assert.equal(productUpdates.length, 0);

        // 5. POST /api/sales E11000 race condition rolls back decremented stock and returns committed sale
        let findCalls = 0;
        const committedRaceSale = { id: 'SALE-RACE-1', invoiceNumber: 'INV-000105', requestId: 'REQ-RACE', totalAmount: 500 };
        stubs.stub(Sale, 'findOne', () => {
          findCalls++;
          // Call 1 (upfront idempotency): miss; Call 2 (after E11000 save): hit
          return makeQuery(findCalls === 1 ? null : committedRaceSale);
        });
        stubs.stub(Product, 'find', () => makeQuery([
          { id: 'PROD-RACE', name: 'Silk Saree', category: 'Sarees', sellingPrice: 500, availability: 10, measurementType: 'piece', shopId: 'SHOP-001' }
        ]));
        stubs.stub(InvoiceCounter, 'findOneAndUpdate', async () => ({ shopId: 'SHOP-001', seq: 105 }));

        const origSave = Sale.prototype.save;
        stubs.stub(Sale.prototype, 'save', async () => {
          const e = new Error('E11000 duplicate key error index: shopId_1_requestId_1');
          e.code = 11000;
          e.keyPattern = { shopId: 1, requestId: 1 };
          throw e;
        });

        productUpdates = [];
        try {
          const rRace = await httpRequest(serverApp, 'POST', '/api/sales', {
            headers: { authorization: `Bearer ${ownerToken}` },
            body: {
              items: [{ productId: 'PROD-RACE', productName: 'Silk Saree', quantity: 2, rate: 500, total: 1000 }],
              totalAmount: 1000,
              paymentMethod: 'UPI',
              requestId: 'REQ-RACE'
            }
          });
          assert.equal(rRace.status, 200, rRace.text);
          assert.equal(rRace.json.duplicate, true);
          assert.equal(rRace.json.sale.id, 'SALE-RACE-1');
          // Verify stock decremented (-2) then rolled back (+2)
          assert.equal(productUpdates.length, 2);
          assert.equal(productUpdates[0].u.$inc.availability, -2);
          assert.equal(productUpdates[1].u.$inc.availability, 2);
        } finally {
          Sale.prototype.save = origSave;
        }
      } finally {
        process.env.NODE_ENV = prevEnv;
        process.env.CORS_STRICT = prevCorsStrict;
        stubs.restoreAll();
      }
    });
  }

  console.log(`\n=== SUMMARY: ${passed} PASSED, ${failed} FAILED (Total ${passed + failed}) ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal suite error:', err);
  process.exit(1);
});
