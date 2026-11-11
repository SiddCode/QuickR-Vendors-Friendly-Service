/**
 * Phase 3 Automated Billing, Atomic Invoice Sequence & Idempotency Concurrency Suite
 *
 * Requires an isolated live MongoDB instance (replica set or standalone).
 * Never runs destructive operations against real shop records — isolates all test
 * documents under unique ephemeral shop IDs in an isolated database.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { Duplex } from 'node:stream';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

process.env.QUICKR_TEST_IMPORT = 'true';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'quickr-concurrency-test-secret-key-min-32-chars';

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  process.env.MONGODB_URI ||
  'mongodb://127.0.0.1:27017/quickr_billing_concurrency_test';

const { app } = await import('../server.js');
const { getJwtSecret } = await import('../config/jwt.js');
const { Shop } = await import('../models/Shop.js');
const { User } = await import('../models/User.js');
const { Product } = await import('../models/Product.js');
const { Sale } = await import('../models/Sale.js');
const { Activity } = await import('../models/Activity.js');
const { InvoiceCounter } = await import('../models/InvoiceCounter.js');
const {
  allocateNextInvoiceNumber,
  detectDuplicateInvoiceNumbers
} = await import('../services/invoiceCounterService.js');

async function dispatch(method, path, { headers = {}, body = undefined } = {}) {
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  const buf = body !== undefined ? Buffer.from(JSON.stringify(body)) : undefined;
  if (buf) {
    if (!lower['content-type']) lower['content-type'] = 'application/json';
    lower['content-length'] = String(buf.length);
  }

  return new Promise((resolve, reject) => {
    const reqSock = new Duplex({ allowHalfOpen: true, autoDestroy: false, read() {}, write(_c, _e, cb) { cb(); } });
    const resSock = new Duplex({ allowHalfOpen: true, autoDestroy: false, read() {}, write(_c, _e, cb) { cb(); } });
    const req = new http.IncomingMessage(reqSock);
    req.method = method;
    req.url = path;
    req.httpVersion = '1.1';
    req.httpVersionMajor = 1;
    req.httpVersionMinor = 1;
    req.headers = lower;
    setImmediate(() => {
      if (buf) req.push(buf);
      req.push(null);
    });

    const res = new http.ServerResponse(req);
    res.assignSocket(resSock);
    const chunks = [];
    const origWrite = res.write.bind(res);
    const origEnd = res.end.bind(res);
    res.write = (c, enc, cb) => {
      if (c) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c, typeof enc === 'string' ? enc : 'utf8'));
      return origWrite(c, enc, cb);
    };
    res.end = (c, enc, cb) => {
      if (c && typeof c !== 'function') chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c, typeof enc === 'string' ? enc : 'utf8'));
      return origEnd(c, enc, cb);
    };
    res.on('error', reject);
    res.on('finish', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      let json = null;
      try { json = JSON.parse(text); } catch { /* ignore */ }
      resolve({ status: res.statusCode, json, text });
    });
    app.handle(req, res, (err) => { if (err) reject(err); });
  });
}

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    failed++;
    console.error(`  [FAIL] ${name}: ${err.stack || err.message}`);
  }
}

async function main() {
  console.log('\n=== QuickR Phase 3 Isolated MongoDB Concurrency & Idempotency Tests ===\n');

  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 5000 });
  await Promise.all([
    Shop.syncIndexes(),
    User.syncIndexes(),
    Product.syncIndexes(),
    Sale.syncIndexes(),
    InvoiceCounter.syncIndexes()
  ]);

  const ts = Date.now();
  const shopA = `CONC-SHOP-A-${ts}`;
  const shopB = `CONC-SHOP-B-${ts}`;
  const shopHist = `CONC-SHOP-HIST-${ts}`;
  const testShops = [shopA, shopB, shopHist];

  const userAId = `USR-A-${ts}`;
  const userBId = `USR-B-${ts}`;
  const tokenA = jwt.sign({ id: userAId, shopId: shopA, role: 'owner' }, getJwtSecret(), { algorithm: 'HS256', expiresIn: '1h' });
  const tokenB = jwt.sign({ id: userBId, shopId: shopB, role: 'owner' }, getJwtSecret(), { algorithm: 'HS256', expiresIn: '1h' });

  try {
    await Shop.create([
      { customId: shopA, name: 'Concurrency Shop A', status: 'active' },
      { customId: shopB, name: 'Concurrency Shop B', status: 'active' },
      { customId: shopHist, name: 'Historical Gap Shop', status: 'active' }
    ]);
    await User.create([
      { id: userAId, name: 'Owner A', email: `a_${ts}@test.local`, passwordHash: 'hash', shopId: shopA, role: 'owner', status: 'active' },
      { id: userBId, name: 'Owner B', email: `b_${ts}@test.local`, passwordHash: 'hash', shopId: shopB, role: 'owner', status: 'active' }
    ]);

    const prodAId = `PROD-A-${ts}`;
    const prodLenId = `PROD-LEN-${ts}`;
    const prodBId = `PROD-B-${ts}`;
    await Product.create([
      { id: prodAId, name: 'Silk Kurti', category: 'Kurtis', sellingPrice: 1000, availability: 50, measurementType: 'piece', shopId: shopA },
      { id: prodLenId, name: 'Cotton Yardage', category: 'Fabrics', sellingPrice: 200, availability: 20, measurementType: 'length', shopId: shopA },
      { id: prodBId, name: 'Linen Shirt', category: 'Shirts', sellingPrice: 1500, availability: 30, measurementType: 'piece', shopId: shopB }
    ]);

    // 1. 20 simultaneous sales for Shop A
    await test('20 simultaneous POST /api/sales for one shop create 20 unique invoices and deduct stock exactly', async () => {
      const requests = Array.from({ length: 20 }, (_, idx) =>
        dispatch('POST', '/api/sales', {
          headers: { authorization: `Bearer ${tokenA}` },
          body: {
            items: [{ productId: prodAId, productName: 'Silk Kurti', quantity: 1, rate: 1000, total: 1000 }],
            subtotal: 1000,
            totalAmount: 1000,
            paymentMethod: 'Cash',
            requestId: `CONC-20-${ts}-${idx}`
          }
        })
      );

      const responses = await Promise.all(requests);
      for (const r of responses) {
        assert.equal(r.status, 201, r.text);
      }
      const invoiceNums = responses.map((r) => r.json.sale.invoiceNumber);
      assert.equal(new Set(invoiceNums).size, 20, `Duplicate invoice numbers: ${invoiceNums}`);

      const dbSales = await Sale.find({ shopId: shopA }).lean();
      assert.equal(dbSales.length, 20);
      const updatedProd = await Product.findOne({ id: prodAId, shopId: shopA }).lean();
      assert.equal(updatedProd.availability, 30);
    });

    // 2. Concurrent multi-shop isolation
    await test('Concurrent sales across Shop A and Shop B maintain independent per-shop invoice sequences', async () => {
      const batchA = Array.from({ length: 5 }, (_, idx) =>
        dispatch('POST', '/api/sales', {
          headers: { authorization: `Bearer ${tokenA}` },
          body: {
            items: [{ productId: prodAId, productName: 'Silk Kurti', quantity: 1, rate: 1000, total: 1000 }],
            subtotal: 1000,
            totalAmount: 1000,
            paymentMethod: 'UPI',
            requestId: `MULTI-A-${ts}-${idx}`
          }
        })
      );
      const batchB = Array.from({ length: 5 }, (_, idx) =>
        dispatch('POST', '/api/sales', {
          headers: { authorization: `Bearer ${tokenB}` },
          body: {
            items: [{ productId: prodBId, productName: 'Linen Shirt', quantity: 1, rate: 1500, total: 1500 }],
            subtotal: 1500,
            totalAmount: 1500,
            paymentMethod: 'Card',
            requestId: `MULTI-B-${ts}-${idx}`
          }
        })
      );

      const resAll = await Promise.all([...batchA, ...batchB]);
      for (const r of resAll) assert.equal(r.status, 201, r.text);

      const shopBNums = resAll.slice(5).map((r) => r.json.sale.invoiceNumber).sort();
      assert.deepEqual(shopBNums, ['INV-000001', 'INV-000002', 'INV-000003', 'INV-000004', 'INV-000005']);
      const shopASalesCount = await Sale.countDocuments({ shopId: shopA });
      assert.equal(shopASalesCount, 25);
    });

    // 3. Historical gapped shop initialization without countDocuments fallback
    await test('Unmigrated shop with gapped historical sales initializes from max INV number (not count)', async () => {
      await Sale.create([
        { id: `H-1-${ts}`, invoiceNumber: 'INV-000001', items: [{ productName: 'A', quantity: 1, rate: 100, total: 100 }], subtotal: 100, totalAmount: 100, paymentMethod: 'Cash', shopId: shopHist },
        { id: `H-2-${ts}`, invoiceNumber: 'INV-000005', items: [{ productName: 'B', quantity: 1, rate: 100, total: 100 }], subtotal: 100, totalAmount: 100, paymentMethod: 'Cash', shopId: shopHist },
        { id: `H-3-${ts}`, invoiceNumber: 'INV-000012', items: [{ productName: 'C', quantity: 1, rate: 100, total: 100 }], subtotal: 100, totalAmount: 100, paymentMethod: 'Cash', shopId: shopHist }
      ]);
      const nextInv = await allocateNextInvoiceNumber(shopHist);
      assert.equal(nextInv, 'INV-000013');
    });

    // 4. MongoDB unique compound index { shopId: 1, invoiceNumber: 1 } rejects duplicates
    await test('Unique compound index on { shopId, invoiceNumber } rejects duplicate invoiceNumber inserts', async () => {
      await assert.rejects(
        () =>
          Sale.create({
            id: `DUP-INV-${ts}`,
            invoiceNumber: 'INV-000001',
            items: [{ productName: 'Dup', quantity: 1, rate: 100, total: 100 }],
            subtotal: 100,
            totalAmount: 100,
            paymentMethod: 'Cash',
            shopId: shopA
          }),
        (err) => err?.code === 11000
      );
      const dups = await detectDuplicateInvoiceNumbers(shopA);
      assert.equal(dups.length, 0);
    });

    // 5. Same requestId submitted sequentially & concurrently -> idempotent, single stock deduction
    await test('Same requestId submitted concurrently (5x) & sequentially commits 1 sale and deducts stock once', async () => {
      const beforeProd = await Product.findOne({ id: prodAId, shopId: shopA }).lean();
      const sameReqId = `IDEMP-CONC-${ts}`;

      const conc = await Promise.all(
        Array.from({ length: 5 }, () =>
          dispatch('POST', '/api/sales', {
            headers: { authorization: `Bearer ${tokenA}` },
            body: {
              items: [{ productId: prodAId, productName: 'Silk Kurti', quantity: 2, rate: 1000, total: 2000 }],
              subtotal: 2000,
              totalAmount: 2000,
              paymentMethod: 'Cash',
              requestId: sameReqId
            }
          })
        )
      );

      for (const r of conc) {
        assert.ok([200, 201].includes(r.status), r.text);
        assert.ok(r.json?.sale?.id, r.text);
      }
      const uniqueSaleIds = new Set(conc.map((r) => r.json.sale.id));
      assert.equal(uniqueSaleIds.size, 1);

      // Subsequent sequential retry
      const retry = await dispatch('POST', '/api/sales', {
        headers: { authorization: `Bearer ${tokenA}` },
        body: {
          items: [{ productId: prodAId, productName: 'Silk Kurti', quantity: 2, rate: 1000, total: 2000 }],
          subtotal: 2000,
          totalAmount: 2000,
          paymentMethod: 'Cash',
          requestId: sameReqId
        }
      });
      assert.equal(retry.status, 200);
      assert.equal(retry.json.duplicate, true);
      assert.equal(retry.json.sale.id, [...uniqueSaleIds][0]);

      // Status lookup endpoint verification
      const statusCheck = await dispatch('GET', `/api/sales/status/${encodeURIComponent(sameReqId)}`, {
        headers: { authorization: `Bearer ${tokenA}` }
      });
      assert.equal(statusCheck.status, 200);
      assert.equal(statusCheck.json.found, true);
      assert.equal(statusCheck.json.sale.id, [...uniqueSaleIds][0]);

      const afterProd = await Product.findOne({ id: prodAId, shopId: shopA }).lean();
      assert.equal(afterProd.availability, beforeProd.availability - 2);
    });

    // 6. Insufficient stock prevents sale & leaves stock intact
    await test('Insufficient stock rejects sale cleanly without deducting stock', async () => {
      const before = await Product.findOne({ id: prodAId, shopId: shopA }).lean();
      const res = await dispatch('POST', '/api/sales', {
        headers: { authorization: `Bearer ${tokenA}` },
        body: {
          items: [{ productId: prodAId, productName: 'Silk Kurti', quantity: before.availability + 5, rate: 1000, total: 1000 }],
          subtotal: 1000,
          totalAmount: 1000,
          paymentMethod: 'Cash',
          requestId: `INSUFF-${ts}`
        }
      });
      assert.equal(res.status, 400);
      const after = await Product.findOne({ id: prodAId, shopId: shopA }).lean();
      assert.equal(after.availability, before.availability);
    });

    // 7. DB save failure triggers compensating stock rollback and allows harmless sequence gap
    await test('Simulated DB save failure rolls back stock cleanly; subsequent checkout succeeds with next seq', async () => {
      const before = await Product.findOne({ id: prodLenId, shopId: shopA }).lean();
      const origSave = Sale.prototype.save;
      let triggered = false;
      Sale.prototype.save = async function (...args) {
        if (!triggered) {
          triggered = true;
          throw new Error('SIMULATED_DB_WRITE_FAILURE');
        }
        return origSave.apply(this, args);
      };

      try {
        const failRes = await dispatch('POST', '/api/sales', {
          headers: { authorization: `Bearer ${tokenA}` },
          body: {
            items: [{ productId: prodLenId, productName: 'Cotton Yardage', measurementType: 'length', sellingUnit: 'cm', quantity: 75, rate: 200, total: 150 }],
            subtotal: 150,
            totalAmount: 150,
            paymentMethod: 'Cash',
            requestId: `FAIL-SAVE-${ts}`
          }
        });
        assert.equal(failRes.status, 500);
      } finally {
        Sale.prototype.save = origSave;
      }

      const afterRollback = await Product.findOne({ id: prodLenId, shopId: shopA }).lean();
      assert.equal(afterRollback.availability, before.availability);

      // Next valid checkout succeeds cleanly (harmless gap left from aborted save)
      const okRes = await dispatch('POST', '/api/sales', {
        headers: { authorization: `Bearer ${tokenA}` },
        body: {
          items: [{ productId: prodLenId, productName: 'Cotton Yardage', measurementType: 'length', sellingUnit: 'cm', quantity: 75, rate: 200, total: 150 }],
          subtotal: 150,
          totalAmount: 150,
          paymentMethod: 'Cash',
          requestId: `RETRY-AFTER-DB-${ts}`
        }
      });
      assert.equal(okRes.status, 201, okRes.text);
      const afterOk = await Product.findOne({ id: prodLenId, shopId: shopA }).lean();
      assert.equal(afterOk.availability, before.availability - 0.75);

      // Sale deletion restores exact baseQuantity (0.75m) once
      const delRes = await dispatch('DELETE', '/api/sales', {
        headers: { authorization: `Bearer ${tokenA}` },
        body: { ids: [okRes.json.sale.id] }
      });
      assert.equal(delRes.status, 200);
      const afterDel = await Product.findOne({ id: prodLenId, shopId: shopA }).lean();
      assert.equal(afterDel.availability, before.availability);
    });
  } finally {
    await Promise.all([
      Sale.deleteMany({ shopId: { $in: testShops } }),
      Product.deleteMany({ shopId: { $in: testShops } }),
      User.deleteMany({ shopId: { $in: testShops } }),
      Shop.deleteMany({ customId: { $in: testShops } }),
      InvoiceCounter.deleteMany({ shopId: { $in: testShops } }),
      Activity.deleteMany({ shopId: { $in: testShops } })
    ]).catch(() => {});
    await mongoose.disconnect().catch(() => {});
  }

  console.log(`\n=== CONCURRENCY SUITE SUMMARY: ${passed} PASSED, ${failed} FAILED ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal concurrency test failure:', err);
  process.exit(1);
});
