/**
 * Automated Invoice Counter Migration Safety Suite (Mocked DB Operations)
 *
 * Tests all 12 safety requirements for migrateInvoiceCounters.js and
 * invoiceCounterService.js without connecting to or modifying any real MongoDB.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.QUICKR_TEST_IMPORT = 'true';

const {
  runInvoiceCounterMigration,
  executeMigrationCli,
  parseMigrationArgs,
  sanitizeSensitiveText
} = await import('./migrateInvoiceCounters.js');
const { connectDB } = await import('../config/database.js');
const {
  sanitizeMongoErrorText,
  parseMongoUriInfo,
  assertSafeTestDatabaseConfig,
  assertSafeConnectedTestTarget,
  inspectEnvFileForProductionOverrides
} = await import('../utils/mongoSafety.js');
const { InvoiceCounter } = await import('../models/InvoiceCounter.js');
const { Sale } = await import('../models/Sale.js');
const {
  analyzeShopInvoiceHistory,
  detectDuplicateInvoiceNumbers,
  ensureInvoiceCounterInitialized,
  allocateNextInvoiceNumber,
  getMaxHistoricalInvoiceSeq,
  extractInvoiceNumericValue,
  formatInvoiceNumber
} = await import('../services/invoiceCounterService.js');

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

const silentLogger = {
  logs: [],
  errors: [],
  log(msg) { this.logs.push(String(msg)); },
  error(msg) { this.errors.push(String(msg)); }
};

function makeQuery(val) {
  return {
    select() { return this; },
    lean() { return Promise.resolve(val); },
    then(res, rej) { return Promise.resolve(val).then(res, rej); },
    catch(rej) { return Promise.resolve(val).catch(rej); }
  };
}

/**
 * In-memory stateful database double tracking every read, counter mutation,
 * index drop/create, and asserting zero Sale writes/deletes.
 */
function createMockMigrationEnv({
  shops = [],
  sales = [],
  initialCounters = {},
  initialIndexes = [{ name: 'shopId_1_invoiceNumber_1', key: { shopId: 1, invoiceNumber: 1 }, unique: false }]
} = {}) {
  const counters = new Map(Object.entries(initialCounters).map(([k, v]) => [k, { shopId: k, seq: v }]));
  let indexes = initialIndexes.map((i) => ({ ...i, key: { ...i.key } }));

  const trace = {
    counterIndexCreates: 0,
    counterWrites: [],
    drops: [],
    creates: [],
    saleMutated: false
  };

  const guardNoSaleMutation = () => {
    trace.saleMutated = true;
    throw new Error('SAFETY VIOLATION: migration attempted to modify historical Sale documents');
  };

  const mockShop = {
    find: () => makeQuery(shops.map((customId) => ({ customId, name: customId })))
  };

  const mockSale = {
    distinct: async (field) => {
      assert.equal(field, 'shopId');
      return [...new Set(sales.map((s) => s.shopId))];
    },
    find: (filter = {}) => {
      const list = filter.shopId ? sales.filter((s) => s.shopId === filter.shopId) : sales;
      return makeQuery(list);
    },
    aggregate: async (pipeline) => {
      // Simulate detectDuplicateInvoiceNumbers pipeline faithfully
      const groups = new Map();
      for (const s of sales) {
        const k = `${s.shopId}::${String(s.invoiceNumber)}`;
        if (!groups.has(k)) {
          groups.set(k, { _id: { shopId: s.shopId, invoiceNumber: s.invoiceNumber }, count: 0, saleIds: [] });
        }
        const g = groups.get(k);
        g.count += 1;
        g.saleIds.push(s.id);
      }
      assert.ok(pipeline.some((st) => st.$group?._id?.shopId === '$shopId' && st.$group?._id?.invoiceNumber === '$invoiceNumber'));
      return [...groups.values()].filter((g) => g.count > 1);
    },
    collection: {
      indexes: async () => indexes.map((i) => ({ ...i, key: { ...i.key } })),
      dropIndex: async (name) => {
        trace.drops.push(name);
        indexes = indexes.filter((i) => i.name !== name);
      },
      createIndex: async (keySpec, opts) => {
        trace.creates.push({ keySpec, opts });
        indexes.push({ name: opts?.name || 'idx', key: { ...keySpec }, unique: Boolean(opts?.unique) });
      }
    },
    deleteOne: guardNoSaleMutation,
    deleteMany: guardNoSaleMutation,
    updateOne: guardNoSaleMutation,
    updateMany: guardNoSaleMutation,
    findOneAndUpdate: guardNoSaleMutation,
    findOneAndDelete: guardNoSaleMutation,
    bulkWrite: guardNoSaleMutation
  };

  const mockInvoiceCounter = {
    createIndexes: async () => {
      trace.counterIndexCreates++;
    },
    findOne: ({ shopId }) => makeQuery(counters.get(shopId) ? { ...counters.get(shopId) } : null),
    findOneAndUpdate: async ({ shopId }, update, opts = {}) => {
      trace.counterWrites.push({ shopId, update, opts });
      let doc = counters.get(shopId);
      if (!doc && opts.upsert) {
        doc = { shopId, seq: 0 };
        counters.set(shopId, doc);
      }
      if (!doc) return null;
      if (update?.$max?.seq !== undefined) {
        doc.seq = Math.max(doc.seq, update.$max.seq);
      }
      if (update?.$inc?.seq !== undefined) {
        doc.seq += update.$inc.seq;
      }
      return { ...doc };
    },
    updateOne: async ({ shopId }, update, opts = {}) => {
      trace.counterWrites.push({ shopId, update, opts });
      if (!counters.has(shopId) && opts.upsert && update?.$setOnInsert) {
        counters.set(shopId, { shopId, seq: update.$setOnInsert.seq ?? 0 });
      }
      return { acknowledged: true };
    }
  };

  // Inject mocked models safely around service calls
  const stubbedAnalyze = async (shopId) => {
    const orig = Sale.find;
    Sale.find = mockSale.find;
    try {
      return await analyzeShopInvoiceHistory(shopId);
    } finally {
      Sale.find = orig;
    }
  };

  const stubbedDetectDups = async (shopId = null) => {
    const orig = Sale.aggregate;
    Sale.aggregate = mockSale.aggregate;
    try {
      return await detectDuplicateInvoiceNumbers(shopId);
    } finally {
      Sale.aggregate = orig;
    }
  };

  const stubbedEnsureCounter = async (shopId, extraOpts = {}) => {
    const origFind = Sale.find;
    const origUpdate = InvoiceCounter.findOneAndUpdate;
    Sale.find = mockSale.find;
    InvoiceCounter.findOneAndUpdate = mockInvoiceCounter.findOneAndUpdate;
    try {
      return await ensureInvoiceCounterInitialized(shopId, extraOpts);
    } finally {
      Sale.find = origFind;
      InvoiceCounter.findOneAndUpdate = origUpdate;
    }
  };

  return {
    counters,
    getIndexes: () => indexes,
    trace,
    models: { Shop: mockShop, Sale: mockSale, InvoiceCounter: mockInvoiceCounter },
    services: {
      analyzeShopInvoiceHistory: stubbedAnalyze,
      detectDuplicateInvoiceNumbers: stubbedDetectDups,
      ensureInvoiceCounterInitialized: stubbedEnsureCounter
    }
  };
}

async function main() {
  console.log('\n=== QuickR Invoice Counter Migration Safety Test Suite ===\n');

  await test('1. --dry-run performs ZERO database writes, counter mutations, index changes, or sale edits', async () => {
    const env = createMockMigrationEnv({
      shops: ['SHOP-A', 'SHOP-EMPTY'],
      sales: [
        { id: 'S-1', shopId: 'SHOP-A', invoiceNumber: 'INV-000001' },
        { id: 'S-2', shopId: 'SHOP-A', invoiceNumber: 'INV-000012' }
      ]
    });

    const logger = { ...silentLogger, logs: [], errors: [] };
    const { exitCode, summary } = await runInvoiceCounterMigration({
      isDryRun: true,
      logger,
      models: env.models,
      services: env.services
    });

    assert.equal(exitCode, 0);
    assert.equal(summary.indexAction, 'WOULD_REPLACE_LEGACY_NON_UNIQUE');
    assert.equal(env.trace.counterIndexCreates, 0);
    assert.equal(env.trace.counterWrites.length, 0);
    assert.equal(env.trace.drops.length, 0);
    assert.equal(env.trace.creates.length, 0);
    assert.equal(env.counters.size, 0);
    assert.equal(env.trace.saleMutated, false);
  });

  await test('2. Duplicate detection groups by (shopId, invoiceNumber): same INV across different shops allowed; duplicate within same shop blocks before index drop', async () => {
    // Different shops sharing INV-000001 is VALID
    const crossShopEnv = createMockMigrationEnv({
      shops: ['SHOP-A', 'SHOP-B'],
      sales: [
        { id: 'S-1', shopId: 'SHOP-A', invoiceNumber: 'INV-000001' },
        { id: 'S-2', shopId: 'SHOP-B', invoiceNumber: 'INV-000001' }
      ]
    });
    const okRes = await runInvoiceCounterMigration({
      isDryRun: false,
      logger: { log() {}, error() {} },
      models: crossShopEnv.models,
      services: crossShopEnv.services
    });
    assert.equal(okRes.exitCode, 0);
    assert.equal(okRes.summary.duplicateGroups.length, 0);

    // Same shop sharing INV-000005 MUST abort before counter writes or dropIndex
    const dupEnv = createMockMigrationEnv({
      shops: ['SHOP-A'],
      sales: [
        { id: 'S-1', shopId: 'SHOP-A', invoiceNumber: 'INV-000005' },
        { id: 'S-2', shopId: 'SHOP-A', invoiceNumber: 'INV-000005' }
      ]
    });
    const errors = [];
    const badRes = await runInvoiceCounterMigration({
      isDryRun: false,
      logger: { log() {}, error: (m) => errors.push(String(m)) },
      models: dupEnv.models,
      services: dupEnv.services
    });
    assert.equal(badRes.exitCode, 2);
    assert.equal(badRes.summary.duplicateGroups.length, 1);
    assert.deepEqual(badRes.summary.duplicateGroups[0].saleIds, ['S-1', 'S-2']);
    assert.equal(dupEnv.trace.drops.length, 0);
    assert.equal(dupEnv.trace.counterWrites.length, 0);
    assert.equal(dupEnv.trace.saleMutated, false);
    assert.ok(errors.some((e) => e.includes('No historical sales were deleted or renumbered')));
  });

  await test('3. Historical extraction parses canonical gapped & >6-digit INV sequences accurately', async () => {
    assert.equal(extractInvoiceNumericValue('INV-000001'), 1);
    assert.equal(extractInvoiceNumericValue('INV-1000005'), 1000005);
    assert.equal(formatInvoiceNumber(1), 'INV-000001');
    assert.equal(formatInvoiceNumber(1000005), 'INV-1000005');

    const origFind = Sale.find;
    Sale.find = () => makeQuery([
      { id: '1', invoiceNumber: 'INV-000002' },
      { id: '2', invoiceNumber: 'INV-000099' },
      { id: '3', invoiceNumber: 'INV-1000001' }
    ]);
    try {
      const max = await getMaxHistoricalInvoiceSeq('SHOP-GAP');
      assert.equal(max, 1000001);
    } finally {
      Sale.find = origFind;
    }
  });

  await test('4. Missing, null, whitespace-padded, malformed, zero, or overflowing invoice numbers refuse silent fallback and abort migration', async () => {
    const badCases = [
      { id: 'M-1', shopId: 'SHOP-BAD', invoiceNumber: null },
      { id: 'M-2', shopId: 'SHOP-BAD', invoiceNumber: '' },
      { id: 'M-3', shopId: 'SHOP-BAD', invoiceNumber: ' INV-000010 ' },
      { id: 'M-4', shopId: 'SHOP-BAD', invoiceNumber: 'INV-ABC' },
      { id: 'M-5', shopId: 'SHOP-BAD', invoiceNumber: 'INV-000000' },
      { id: 'M-6', shopId: 'SHOP-BAD', invoiceNumber: 'INV-99999999999999999999' },
      { id: 'M-7', shopId: 'SHOP-BAD', invoiceNumber: 'BILL-001' }
    ];

    const origFind = Sale.find;
    Sale.find = () => makeQuery(badCases);
    try {
      await assert.rejects(() => getMaxHistoricalInvoiceSeq('SHOP-BAD'), /missing or malformed/i);
    } finally {
      Sale.find = origFind;
    }

    const env = createMockMigrationEnv({
      shops: ['SHOP-BAD'],
      sales: [{ id: 'V-1', shopId: 'SHOP-BAD', invoiceNumber: 'INV-000001' }, ...badCases]
    });
    const res = await runInvoiceCounterMigration({
      isDryRun: false,
      logger: { log() {}, error() {} },
      models: env.models,
      services: env.services
    });
    assert.equal(res.exitCode, 2);
    assert.equal(res.summary.malformedShops[0].malformed.length, badCases.length);
    assert.equal(env.trace.counterWrites.length, 0);
    assert.equal(env.trace.drops.length, 0);
  });

  await test('5. $max initialization never decreases existing higher counters and handles 0-sale shops safely', async () => {
    const env = createMockMigrationEnv({
      shops: ['SHOP-HIGHER', 'SHOP-ZERO'],
      sales: [{ id: 'S-1', shopId: 'SHOP-HIGHER', invoiceNumber: 'INV-000010' }],
      initialCounters: { 'SHOP-HIGHER': 42, 'SHOP-ZERO': 7 }
    });

    const res = await runInvoiceCounterMigration({
      isDryRun: false,
      logger: { log() {}, error() {} },
      models: env.models,
      services: env.services
    });

    assert.equal(res.exitCode, 0);
    assert.equal(env.counters.get('SHOP-HIGHER').seq, 42);
    assert.equal(env.counters.get('SHOP-ZERO').seq, 7);

    // Brand-new shop with 0 sales and no pre-existing counter starts cleanly at seq=0 -> first sale INV-000001
    const freshEnv = createMockMigrationEnv({ shops: ['SHOP-NEW-EMPTY'], sales: [] });
    const freshRes = await runInvoiceCounterMigration({
      isDryRun: false,
      logger: { log() {}, error() {} },
      models: freshEnv.models,
      services: freshEnv.services
    });
    assert.equal(freshRes.exitCode, 0);
    assert.equal(freshEnv.counters.get('SHOP-NEW-EMPTY').seq, 0);
  });

  await test('6. Concurrent runtime counter initialization allocates distinct consecutive sequences under E11000 upsert race', async () => {
    const origFindOneAndUpdate = InvoiceCounter.findOneAndUpdate;
    const origUpdateOne = InvoiceCounter.updateOne;
    const origSaleFind = Sale.find;

    const store = new Map();
    let initialMisses = 0;

    InvoiceCounter.findOneAndUpdate = async ({ shopId }, update) => {
      if (!store.has(shopId) && initialMisses < 2) {
        initialMisses++;
        return null;
      }
      const doc = store.get(shopId);
      if (update?.$inc?.seq) doc.seq += update.$inc.seq;
      return { ...doc };
    };
    InvoiceCounter.updateOne = async ({ shopId }, update) => {
      if (!store.has(shopId)) {
        store.set(shopId, { shopId, seq: update.$setOnInsert.seq });
        return { upsertedCount: 1 };
      }
      const err = new Error('E11000 duplicate key on shopId');
      err.code = 11000;
      throw err;
    };
    Sale.find = () => makeQuery([{ id: 'S1', invoiceNumber: 'INV-000012' }]);

    try {
      const [inv1, inv2] = await Promise.all([
        allocateNextInvoiceNumber('SHOP-RACE'),
        allocateNextInvoiceNumber('SHOP-RACE')
      ]);
      assert.deepEqual([inv1, inv2].sort(), ['INV-000013', 'INV-000014']);
    } finally {
      InvoiceCounter.findOneAndUpdate = origFindOneAndUpdate;
      InvoiceCounter.updateOne = origUpdateOne;
      Sale.find = origSaleFind;
    }
  });

  await test('7. Rejects wrong index key order, replaces legacy non-unique index cleanly, is idempotent on rerun, and resumes partial failures', async () => {
    // A. Conflicting wrong key order { invoiceNumber: 1, shopId: 1 } aborts safely without dropping
    const badOrderEnv = createMockMigrationEnv({
      shops: ['SHOP-A'],
      sales: [],
      initialIndexes: [{ name: 'shopId_1_invoiceNumber_1', key: { invoiceNumber: 1, shopId: 1 }, unique: false }]
    });
    const badOrderRes = await runInvoiceCounterMigration({
      isDryRun: false,
      logger: { log() {}, error() {} },
      models: badOrderEnv.models,
      services: badOrderEnv.services
    });
    assert.equal(badOrderRes.exitCode, 2);
    assert.equal(badOrderRes.summary.indexAction, 'CONFLICTING_SPEC');
    assert.equal(badOrderEnv.trace.drops.length, 0);

    // B. Full apply -> simulate live billing advancing counter -> idempotent rerun -> resume after missing index
    const env = createMockMigrationEnv({
      shops: ['SHOP-A'],
      sales: [{ id: 'S-1', shopId: 'SHOP-A', invoiceNumber: 'INV-000005' }]
    });

    const first = await runInvoiceCounterMigration({
      isDryRun: false,
      logger: { log() {}, error() {} },
      models: env.models,
      services: env.services
    });
    assert.equal(first.exitCode, 0);
    assert.equal(first.summary.indexAction, 'REPLACED_LEGACY_WITH_UNIQUE');
    assert.deepEqual(env.trace.drops, ['shopId_1_invoiceNumber_1']);
    assert.deepEqual(Object.keys(env.trace.creates[0].keySpec), ['shopId', 'invoiceNumber']);
    assert.equal(env.trace.creates[0].opts.unique, true);
    assert.equal(env.counters.get('SHOP-A').seq, 5);

    // Simulate live sales advancing counter to 8
    env.counters.get('SHOP-A').seq = 8;

    // Rerun is strictly idempotent
    const second = await runInvoiceCounterMigration({
      isDryRun: false,
      logger: { log() {}, error() {} },
      models: env.models,
      services: env.services
    });
    assert.equal(second.exitCode, 0);
    assert.equal(second.summary.indexAction, 'ALREADY_UNIQUE');
    assert.equal(env.counters.get('SHOP-A').seq, 8);
    assert.equal(env.trace.drops.length, 1); // no additional drop
    assert.equal(env.trace.creates.length, 1); // no additional create

    // Resume scenario: crash right after dropIndex before createIndex (no index currently present, counter already at 8)
    const resumeEnv = createMockMigrationEnv({
      shops: ['SHOP-A'],
      sales: [{ id: 'S-1', shopId: 'SHOP-A', invoiceNumber: 'INV-000005' }],
      initialCounters: { 'SHOP-A': 8 },
      initialIndexes: []
    });
    const resumed = await runInvoiceCounterMigration({
      isDryRun: false,
      logger: { log() {}, error() {} },
      models: resumeEnv.models,
      services: resumeEnv.services
    });
    assert.equal(resumed.exitCode, 0);
    assert.equal(resumed.summary.indexAction, 'CREATED_UNIQUE');
    assert.equal(resumeEnv.counters.get('SHOP-A').seq, 8);
    assert.equal(resumeEnv.getIndexes()[0].unique, true);
  });

  // ---------------------------------------------------------------------------
  // ENV GUARD, TARGET CONFIRMATION, REDACTION & CLEANUP TESTS
  // ---------------------------------------------------------------------------
  console.log('\n  --- CLI Environment, Port, Allowlist & Target Confirmation Guard Tests ---');

  await test('8. Rejects missing QUICKR_MIGRATION_MONGODB_URI even if MONGODB_URI exists and rejects implicit backend/.env', async () => {
    let connectCalled = 0;
    const logs = [];
    const env = { MONGODB_URI: 'mongodb://127.0.0.1:27017/quickr', NODE_ENV: 'staging' };
    const res = await executeMigrationCli({
      argv: ['--environment=staging', '--dry-run', '--confirm-db=quickr_staging', '--confirm-host=127.0.0.1', '--confirm-port=27018'],
      env,
      logger: { log: (m) => logs.push(m), error: (m) => logs.push(m) },
      connectFn: async () => { connectCalled++; return null; },
      disconnectFn: async () => {}
    });
    assert.equal(res.exitCode, 1);
    assert.equal(connectCalled, 0);
    assert.ok(logs.some((l) => l.includes('QUICKR_MIGRATION_MONGODB_URI must be explicitly set')));
  });

  await test('9. Rejects empty/whitespace QUICKR_MIGRATION_MONGODB_URI without localhost fallback', async () => {
    let connectCalled = 0;
    const env = { QUICKR_MIGRATION_MONGODB_URI: '   \t  ', MONGODB_URI: 'mongodb://127.0.0.1:27017/quickr' };
    const res = await executeMigrationCli({
      argv: ['--environment=staging', '--dry-run', '--confirm-db=quickr_staging', '--confirm-host=127.0.0.1', '--confirm-port=27018'],
      env,
      logger: { log() {}, error() {} },
      connectFn: async () => { connectCalled++; return null; },
      disconnectFn: async () => {}
    });
    assert.equal(res.exitCode, 1);
    assert.equal(connectCalled, 0);
    assert.equal(env.MONGODB_URI, 'mongodb://127.0.0.1:27017/quickr');
  });

  await test('10. Rejects missing explicit --env-file cleanly and never loads default .env automatically', async () => {
    let loadedPath = null;
    const res = await executeMigrationCli({
      argv: ['--environment=staging', '--dry-run', '--confirm-db=quickr_staging', '--confirm-host=127.0.0.1', '--confirm-port=27018'],
      env: {}, // No QUICKR_MIGRATION_MONGODB_URI
      logger: { log() {}, error() {} },
      loadEnvFn: (p) => { loadedPath = p; },
      connectFn: async () => { throw new Error('Should not connect'); },
      disconnectFn: async () => {}
    });
    assert.equal(res.exitCode, 1);
    assert.equal(loadedPath, null);

    const resMissingFile = await executeMigrationCli({
      argv: ['--env-file=/nonexistent/migration.env', '--environment=staging', '--dry-run', '--confirm-db=quickr_staging', '--confirm-host=127.0.0.1', '--confirm-port=27018'],
      env: {},
      logger: { log() {}, error() {} }
    });
    assert.equal(resMissingFile.exitCode, 1);
  });

  await test('11. Missing --confirm-db rejects before any connection attempt', async () => {
    let connectCalled = 0;
    const logs = [];
    const env = { QUICKR_MIGRATION_MONGODB_URI: 'mongodb://stage:pass@127.0.0.1:27018/quickr_staging' };
    const resDry = await executeMigrationCli({
      argv: ['--environment=staging', '--dry-run', '--confirm-host=127.0.0.1', '--confirm-port=27018'],
      env,
      logger: { log() {}, error: (m) => logs.push(m) },
      connectFn: async () => { connectCalled++; return null; },
      disconnectFn: async () => {}
    });
    assert.equal(resDry.exitCode, 1);
    assert.equal(connectCalled, 0);
    assert.ok(logs.some((l) => l.includes('--confirm-db')));
  });

  await test('12. Post-connect --confirm-db mismatch aborts BEFORE migration queries, disconnects cleanly, and restores env.MONGODB_URI', async () => {
    let migrated = false;
    let disconnected = false;
    const logs = [];
    const env = {
      QUICKR_MIGRATION_MONGODB_URI: 'mongodb+srv://adminuser:supersecret@cluster0.prod.mongodb.net/SGS',
      QUICKR_PRODUCTION_MONGO_HOSTS: 'cluster0.prod.mongodb.net',
      MONGODB_URI: 'mongodb://old-app-uri/dev',
      NODE_ENV: 'production'
    };
    const res = await executeMigrationCli({
      argv: ['--environment=production', '--dry-run', '--confirm-db=SGS', '--confirm-host=cluster0.prod.mongodb.net', '--confirm-port=27017'],
      env,
      logger: { log: (m) => logs.push(m), error: (m) => logs.push(m) },
      setMongooseFlagsFn: () => {},
      // Mock connection unexpectedly returns wrong database name despite matching URI
      connectFn: async () => ({
        connection: { host: 'cluster0.prod.mongodb.net', port: 27017, name: 'other_actual_db' }
      }),
      disconnectFn: async () => { disconnected = true; },
      migrateFn: async () => { migrated = true; return { exitCode: 0 }; }
    });
    assert.equal(res.exitCode, 1);
    assert.equal(migrated, false);
    assert.equal(disconnected, true);
    assert.equal(env.MONGODB_URI, 'mongodb://old-app-uri/dev');
    assert.ok(logs.some((l) => l.includes('Database confirmation mismatch')));
  });

  await test('13. Missing --confirm-host rejects before connecting', async () => {
    let connectCalled = 0;
    const logs = [];
    const res = await executeMigrationCli({
      argv: ['--environment=staging', '--dry-run', '--confirm-db=quickr_staging', '--confirm-port=27018'],
      env: { QUICKR_MIGRATION_MONGODB_URI: 'mongodb://stage:pass@127.0.0.1:27018/quickr_staging' },
      logger: { log() {}, error: (m) => logs.push(m) },
      connectFn: async () => { connectCalled++; return null; },
      disconnectFn: async () => {}
    });
    assert.equal(res.exitCode, 1);
    assert.equal(connectCalled, 0);
    assert.ok(logs.some((l) => l.includes('--confirm-host')));
  });

  await test('14. Wrong or substring --confirm-host rejects strictly (no substring matching) and disconnects cleanly', async () => {
    let disconnected = 0;
    let migrated = false;
    const logs = [];
    const res = await executeMigrationCli({
      argv: ['--environment=production', '--dry-run', '--confirm-db=SGS', '--confirm-host=cluster0', '--confirm-port=27017'], // Substring of cluster0.prod.mongodb.net
      env: {
        QUICKR_MIGRATION_MONGODB_URI: 'mongodb+srv://u:p@cluster0.prod.mongodb.net/SGS',
        QUICKR_PRODUCTION_MONGO_HOSTS: 'cluster0.prod.mongodb.net,cluster0'
      },
      logger: { log: (m) => logs.push(m), error: (m) => logs.push(m) },
      setMongooseFlagsFn: () => {},
      connectFn: async () => ({
        connection: {
          host: 'ac-shard-00-00.prod.mongodb.net',
          port: 27017,
          name: 'SGS',
          client: { s: { options: { srvHost: 'cluster0.prod.mongodb.net', hosts: [{ host: 'ac-shard-00-00.prod.mongodb.net', port: 27017 }] } } }
        }
      }),
      disconnectFn: async () => { disconnected++; },
      migrateFn: async () => { migrated = true; return { exitCode: 0 }; }
    });
    assert.equal(res.exitCode, 1);
    assert.equal(migrated, false);
    assert.equal(disconnected, 1);
    assert.ok(logs.some((l) => l.includes('Host confirmation mismatch')));

    // Explicitly verify post-connect substring rejection directly
    let postDisconnected = 0;
    const logsPost = [];
    const resPost = await executeMigrationCli({
      argv: ['--environment=production', '--dry-run', '--confirm-db=SGS', '--confirm-host=cluster0', '--confirm-port=27017'],
      env: {
        QUICKR_MIGRATION_MONGODB_URI: 'mongodb+srv://u:p@cluster0/SGS',
        QUICKR_PRODUCTION_MONGO_HOSTS: 'cluster0'
      },
      logger: { log: (m) => logsPost.push(m), error: (m) => logsPost.push(m) },
      setMongooseFlagsFn: () => {},
      connectFn: async () => ({
        connection: {
          host: 'ac-shard-00-00.prod.mongodb.net',
          port: 27017,
          name: 'SGS',
          client: { s: { options: { srvHost: 'cluster0.prod.mongodb.net' } } }
        }
      }),
      disconnectFn: async () => { postDisconnected++; },
      migrateFn: async () => ({ exitCode: 0 })
    });
    assert.equal(resPost.exitCode, 1);
    assert.equal(postDisconnected, 1);
    assert.ok(logsPost.some((l) => l.includes('Host confirmation mismatch')));
  });

  await test('15. Production APPLY requires --confirm-production (even when NODE_ENV unset) while production DRY-RUN works with allowlist', async () => {
    let connectCalled = 0;
    const logs = [];
    const resNoConfirm = await executeMigrationCli({
      argv: ['--environment=production', '--confirm-db=SGS', '--confirm-host=cluster0.prod.mongodb.net', '--confirm-port=27017'],
      env: {
        QUICKR_MIGRATION_MONGODB_URI: 'mongodb+srv://u:p@cluster0.prod.mongodb.net/SGS',
        QUICKR_PRODUCTION_MONGO_HOSTS: 'cluster0.prod.mongodb.net'
      },
      logger: { log: (m) => logs.push(m), error: (m) => logs.push(m) },
      connectFn: async () => { connectCalled++; return null; },
      disconnectFn: async () => {}
    });
    assert.equal(resNoConfirm.exitCode, 1);
    assert.equal(connectCalled, 0);
    assert.ok(logs.some((l) => l.includes('--confirm-production')));

    let dryMigrated = false;
    const resProdDry = await executeMigrationCli({
      argv: ['--environment=production', '--dry-run', '--confirm-db=SGS', '--confirm-host=cluster0.prod.mongodb.net', '--confirm-port=27017'],
      env: {
        QUICKR_MIGRATION_MONGODB_URI: 'mongodb+srv://u:p@cluster0.prod.mongodb.net/SGS',
        QUICKR_PRODUCTION_MONGO_HOSTS: 'cluster0.prod.mongodb.net',
        NODE_ENV: 'production'
      },
      logger: { log() {}, error() {} },
      setMongooseFlagsFn: () => {},
      connectFn: async () => ({
        connection: {
          host: 'ac-shard-00-00.prod.mongodb.net',
          port: 27017,
          name: 'SGS',
          client: { s: { options: { srvHost: 'cluster0.prod.mongodb.net', hosts: [{ host: 'ac-shard-00-00.prod.mongodb.net', port: 27017 }] } } }
        }
      }),
      disconnectFn: async () => {},
      migrateFn: async () => { dryMigrated = true; return { exitCode: 0 }; }
    });
    assert.equal(resProdDry.exitCode, 0);
    assert.equal(dryMigrated, true);
  });

  await test('16. Correct production confirmation prints sanitized banner, enforces autoIndex=false/autoCreate=false, and runs apply', async () => {
    const logs = [];
    let flagsDisabled = false;
    let disconnected = false;
    const parsedArgs = parseMigrationArgs([
      '--environment', 'production',
      '--confirm-db', 'SGS',
      '--confirm-host', 'cluster0.prod.mongodb.net',
      '--confirm-port', '27017',
      '--confirm-production'
    ]);
    assert.equal(parsedArgs.environment, 'production');
    assert.equal(parsedArgs.confirmDb, 'SGS');
    assert.equal(parsedArgs.confirmHost, 'cluster0.prod.mongodb.net');
    assert.equal(parsedArgs.confirmPort, 27017);
    assert.equal(parsedArgs.confirmProduction, true);

    const res = await executeMigrationCli({
      argv: ['--environment=production', '--confirm-db=SGS', '--confirm-host=cluster0.prod.mongodb.net', '--confirm-port=27017', '--confirm-production'],
      env: {
        QUICKR_MIGRATION_MONGODB_URI: 'mongodb+srv://dbadmin:SuperSecret99@cluster0.prod.mongodb.net/SGS?retryWrites=true',
        QUICKR_PRODUCTION_MONGO_HOSTS: 'cluster0.prod.mongodb.net',
        NODE_ENV: 'production'
      },
      logger: { log: (m) => logs.push(m), error: (m) => logs.push(m) },
      setMongooseFlagsFn: () => { flagsDisabled = true; },
      connectFn: async () => ({
        connection: {
          host: 'ac-abc-00-00.prod.mongodb.net',
          port: 27017,
          name: 'SGS',
          client: { s: { options: { srvHost: 'cluster0.prod.mongodb.net', hosts: [{ host: 'ac-abc-00-00.prod.mongodb.net', port: 27017 }] } } }
        }
      }),
      disconnectFn: async () => { disconnected = true; },
      migrateFn: async () => ({ exitCode: 0, summary: { indexAction: 'REPLACED_LEGACY_WITH_UNIQUE' } })
    });

    assert.equal(res.exitCode, 0);
    assert.equal(flagsDisabled, true);
    assert.equal(disconnected, true);
    const joined = logs.join('\n');
    assert.ok(joined.includes('QuickR Migration Target Identification Banner'));
    assert.ok(joined.includes('Port                : 27017'));
    assert.ok(joined.includes('Database Name       : SGS'));
    assert.ok(joined.includes('Target Environment  : production'));
    assert.ok(joined.includes('Migration Mode      : APPLY'));
    assert.ok(joined.includes('PRODUCTION=CONFIRMED'));
    assert.ok(joined.includes('ALLOWLIST=VERIFIED'));
  });

  await test('17. Full CLI staging dry-run (127.0.0.1:27018/quickr_staging) performs zero counter writes and zero index operations', async () => {
    const envMock = createMockMigrationEnv({
      shops: ['SHOP-STAGE'],
      sales: [{ id: 'S-1', shopId: 'SHOP-STAGE', invoiceNumber: 'INV-000004' }]
    });
    let flagsDisabled = false;
    let disconnected = false;
    const logs = [];

    const res = await executeMigrationCli({
      argv: ['--environment=staging', '--confirm-db=quickr_staging', '--confirm-host=127.0.0.1', '--confirm-port=27018', '--dry-run'],
      env: {
        QUICKR_MIGRATION_MONGODB_URI: 'mongodb://stage_user:StageSecret123@127.0.0.1:27018/quickr_staging?authSource=quickr_staging',
        QUICKR_PRODUCTION_MONGO_HOSTS: 'cluster0.prod.mongodb.net',
        NODE_ENV: 'staging'
      },
      logger: { log: (m) => logs.push(m), error: (m) => logs.push(m) },
      setMongooseFlagsFn: () => { flagsDisabled = true; },
      connectFn: async () => ({
        connection: {
          host: '127.0.0.1',
          port: 27018,
          name: 'quickr_staging',
          client: { s: { options: { hosts: [{ host: '127.0.0.1', port: 27018 }] } } }
        }
      }),
      disconnectFn: async () => { disconnected = true; },
      migrateFn: (opts) => runInvoiceCounterMigration({
        ...opts,
        models: envMock.models,
        services: envMock.services
      })
    });

    assert.equal(res.exitCode, 0);
    assert.equal(flagsDisabled, true);
    assert.equal(disconnected, true);
    assert.equal(envMock.trace.counterWrites.length, 0);
    assert.equal(envMock.trace.counterIndexCreates, 0);
    assert.equal(envMock.trace.drops.length, 0);
    assert.equal(envMock.trace.creates.length, 0);
    assert.equal(envMock.trace.saleMutated, false);
    const banner = logs.join('\n');
    assert.ok(banner.includes('Port                : 27018'));
    assert.ok(banner.includes('Database Name       : quickr_staging'));
    assert.ok(banner.includes('Migration Mode      : DRY_RUN'));
  });

  await test('18. Credentials, full URIs, and auth params never appear in banner, normal logs, or thrown error logs', async () => {
    const secretUri = 'mongodb+srv://secret_admin:UltraSecretPass!123@cluster0.prod.mongodb.net/SGS?authSource=admin';
    assert.equal(sanitizeSensitiveText(`Failed on ${secretUri}`, secretUri), 'Failed on [REDACTED_URI]');

    const logs = [];
    let disconnected = false;
    const res = await executeMigrationCli({
      argv: ['--environment=production', '--dry-run', '--confirm-db=SGS', '--confirm-host=cluster0.prod.mongodb.net', '--confirm-port=27017'],
      env: {
        QUICKR_MIGRATION_MONGODB_URI: secretUri,
        QUICKR_PRODUCTION_MONGO_HOSTS: 'cluster0.prod.mongodb.net',
        NODE_ENV: 'production'
      },
      logger: { log: (m) => logs.push(String(m)), error: (m) => logs.push(String(m)) },
      setMongooseFlagsFn: () => {},
      connectFn: async () => ({ connection: { host: 'cluster0.prod.mongodb.net', port: 27017, name: 'SGS' } }),
      disconnectFn: async () => { disconnected = true; },
      migrateFn: async () => {
        throw new Error(`Driver error connecting to ${secretUri}`);
      }
    });

    assert.equal(res.exitCode, 1);
    assert.equal(disconnected, true);
    const fullLog = logs.join('\n');
    assert.equal(fullLog.includes('secret_admin'), false);
    assert.equal(fullLog.includes('UltraSecretPass!123'), false);
    assert.equal(fullLog.includes(secretUri), false);
    assert.ok(fullLog.includes('[REDACTED_URI]'));
  });

  await test('19. Environment restoration and --env-file cleanup occur on ALL exit paths (mismatch, throw, and success)', async () => {
    let disconnectCount = 0;
    const tmpEnvPath = path.join(os.tmpdir(), `quickr-test-mig-${Date.now()}.env`);
    fs.writeFileSync(
      tmpEnvPath,
      'QUICKR_MIGRATION_MONGODB_URI=mongodb://stage:pass@127.0.0.1:27018/quickr_staging\nQUICKR_TEST_EXTRA_SECRET=hidden_secret\n',
      'utf8'
    );

    try {
      const env = { MONGODB_URI: 'mongodb://original-dev/quickr', NODE_ENV: 'staging' };
      const res = await executeMigrationCli({
        argv: ['--env-file', tmpEnvPath, '--environment=staging', '--dry-run', '--confirm-db=quickr_staging', '--confirm-host=127.0.0.1', '--confirm-port=27018'],
        env,
        logger: { log() {}, error() {} },
        setMongooseFlagsFn: () => {},
        connectFn: async () => {
          assert.equal(env.MONGODB_URI, 'mongodb://stage:pass@127.0.0.1:27018/quickr_staging');
          // Mock wrong actual port 27017 returned by Mongoose metadata
          return { connection: { host: '127.0.0.1', port: 27017, name: 'quickr_staging' } };
        },
        disconnectFn: async () => { disconnectCount++; },
        migrateFn: async () => { throw new Error('Should not run migrateFn after port mismatch'); }
      });

      assert.equal(res.exitCode, 1);
      assert.equal(disconnectCount, 1);
      assert.equal(env.MONGODB_URI, 'mongodb://original-dev/quickr');
      assert.equal(Object.prototype.hasOwnProperty.call(env, 'QUICKR_MIGRATION_MONGODB_URI'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(env, 'QUICKR_TEST_EXTRA_SECRET'), false);

      // Also verify when MONGODB_URI was initially absent
      const emptyEnv = {};
      const resFail = await executeMigrationCli({
        argv: ['--env-file', tmpEnvPath, '--environment=staging', '--dry-run', '--confirm-db=quickr_staging', '--confirm-host=127.0.0.1', '--confirm-port=27018'],
        env: emptyEnv,
        logger: { log() {}, error() {} },
        setMongooseFlagsFn: () => {},
        connectFn: async () => { throw new Error('Simulated driver failure'); },
        disconnectFn: async () => {}
      });
      assert.equal(resFail.exitCode, 1);
      assert.equal(Object.prototype.hasOwnProperty.call(emptyEnv, 'MONGODB_URI'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(emptyEnv, 'QUICKR_MIGRATION_MONGODB_URI'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(emptyEnv, 'QUICKR_TEST_EXTRA_SECRET'), false);
    } finally {
      fs.unlinkSync(tmpEnvPath);
    }
  });

  await test('20. Missing or invalid --environment rejects before connecting', async () => {
    let connectCalled = 0;
    const baseEnv = { QUICKR_MIGRATION_MONGODB_URI: 'mongodb://stage:pass@127.0.0.1:27018/quickr_staging' };

    const resMissing = await executeMigrationCli({
      argv: ['--dry-run', '--confirm-db=quickr_staging', '--confirm-host=127.0.0.1', '--confirm-port=27018'],
      env: baseEnv,
      logger: { log() {}, error() {} },
      connectFn: async () => { connectCalled++; return null; },
      disconnectFn: async () => {}
    });
    assert.equal(resMissing.exitCode, 1);

    for (const invalidEnv of ['dev', 'prod', 'local', 'STAGING']) {
      const resInvalid = await executeMigrationCli({
        argv: [`--environment=${invalidEnv}`, '--dry-run', '--confirm-db=quickr_staging', '--confirm-host=127.0.0.1', '--confirm-port=27018'],
        env: baseEnv,
        logger: { log() {}, error() {} },
        connectFn: async () => { connectCalled++; return null; },
        disconnectFn: async () => {}
      });
      assert.equal(resInvalid.exitCode, 1);
    }
    assert.equal(connectCalled, 0);
  });

  await test('21. Missing, invalid, or wrong --confirm-port rejects strictly (both pre-connect and post-connect)', async () => {
    let connectCalled = 0;
    const logs = [];
    const env = { QUICKR_MIGRATION_MONGODB_URI: 'mongodb://stage:pass@127.0.0.1:27018/quickr_staging' };

    // A. Missing --confirm-port
    const resMissing = await executeMigrationCli({
      argv: ['--environment=staging', '--dry-run', '--confirm-db=quickr_staging', '--confirm-host=127.0.0.1'],
      env,
      logger: { log() {}, error: (m) => logs.push(m) },
      connectFn: async () => { connectCalled++; return null; },
      disconnectFn: async () => {}
    });
    assert.equal(resMissing.exitCode, 1);
    assert.ok(logs.some((l) => l.includes('--confirm-port')));

    // B. Invalid --confirm-port values
    for (const badPort of ['abc', '0', '65536', '-1']) {
      const resBad = await executeMigrationCli({
        argv: ['--environment=staging', '--dry-run', '--confirm-db=quickr_staging', '--confirm-host=127.0.0.1', `--confirm-port=${badPort}`],
        env,
        logger: { log() {}, error() {} },
        connectFn: async () => { connectCalled++; return null; },
        disconnectFn: async () => {}
      });
      assert.equal(resBad.exitCode, 1);
    }

    // C. Wrong staging port (27017 instead of 27018)
    const resDevPort = await executeMigrationCli({
      argv: ['--environment=staging', '--dry-run', '--confirm-db=quickr_staging', '--confirm-host=127.0.0.1', '--confirm-port=27017'],
      env,
      logger: { log() {}, error() {} },
      connectFn: async () => { connectCalled++; return null; },
      disconnectFn: async () => {}
    });
    assert.equal(resDevPort.exitCode, 1);
    assert.equal(connectCalled, 0);

    // D. Post-connect wrong port returned in Mongoose metadata (or missing port metadata) fails closed
    let postDisconnects = 0;
    const resPostPort = await executeMigrationCli({
      argv: ['--environment=staging', '--dry-run', '--confirm-db=quickr_staging', '--confirm-host=127.0.0.1', '--confirm-port=27018'],
      env,
      logger: { log() {}, error() {} },
      setMongooseFlagsFn: () => {},
      connectFn: async () => ({ connection: { host: '127.0.0.1', port: 27017, name: 'quickr_staging' } }),
      disconnectFn: async () => { postDisconnects++; },
      migrateFn: async () => { throw new Error('Should not migrate when connected port != 27018'); }
    });
    assert.equal(resPostPort.exitCode, 1);
    assert.equal(postDisconnects, 1);

    const resMissingPortMeta = await executeMigrationCli({
      argv: ['--environment=production', '--dry-run', '--confirm-db=SGS', '--confirm-host=cluster0.prod.mongodb.net', '--confirm-port=27017'],
      env: {
        QUICKR_MIGRATION_MONGODB_URI: 'mongodb+srv://u:p@cluster0.prod.mongodb.net/SGS',
        QUICKR_PRODUCTION_MONGO_HOSTS: 'cluster0.prod.mongodb.net'
      },
      logger: { log() {}, error() {} },
      setMongooseFlagsFn: () => {},
      connectFn: async () => ({ connection: { host: 'cluster0.prod.mongodb.net', name: 'SGS' } }),
      disconnectFn: async () => { postDisconnects++; }
    });
    assert.equal(resMissingPortMeta.exitCode, 1);
    assert.equal(postDisconnects, 2);
  });

  await test('22. Staging rejects Atlas SRV, wrong host, wrong DB, wrong port URI, and NODE_ENV=production', async () => {
    let connectCalled = 0;
    const cases = [
      {
        name: 'Atlas SRV URI with --environment=staging',
        env: { QUICKR_MIGRATION_MONGODB_URI: 'mongodb+srv://u:p@cluster0.prod.mongodb.net/quickr_staging' },
        argv: ['--environment=staging', '--dry-run', '--confirm-db=quickr_staging', '--confirm-host=127.0.0.1', '--confirm-port=27018']
      },
      {
        name: 'Wrong staging database (quickr instead of quickr_staging)',
        env: { QUICKR_MIGRATION_MONGODB_URI: 'mongodb://stage:pass@127.0.0.1:27018/quickr' },
        argv: ['--environment=staging', '--dry-run', '--confirm-db=quickr', '--confirm-host=127.0.0.1', '--confirm-port=27018']
      },
      {
        name: 'Wrong staging database (SGS)',
        env: { QUICKR_MIGRATION_MONGODB_URI: 'mongodb://stage:pass@127.0.0.1:27018/SGS' },
        argv: ['--environment=staging', '--dry-run', '--confirm-db=SGS', '--confirm-host=127.0.0.1', '--confirm-port=27018']
      },
      {
        name: 'Wrong staging port in URI (27017 instead of 27018)',
        env: { QUICKR_MIGRATION_MONGODB_URI: 'mongodb://stage:pass@127.0.0.1:27017/quickr_staging' },
        argv: ['--environment=staging', '--dry-run', '--confirm-db=quickr_staging', '--confirm-host=127.0.0.1', '--confirm-port=27018']
      },
      {
        name: 'Wrong staging host (localhost instead of 127.0.0.1)',
        env: { QUICKR_MIGRATION_MONGODB_URI: 'mongodb://stage:pass@localhost:27018/quickr_staging' },
        argv: ['--environment=staging', '--dry-run', '--confirm-db=quickr_staging', '--confirm-host=localhost', '--confirm-port=27018']
      },
      {
        name: 'NODE_ENV=production conflict with --environment=staging',
        env: { QUICKR_MIGRATION_MONGODB_URI: 'mongodb://stage:pass@127.0.0.1:27018/quickr_staging', NODE_ENV: 'production' },
        argv: ['--environment=staging', '--dry-run', '--confirm-db=quickr_staging', '--confirm-host=127.0.0.1', '--confirm-port=27018']
      }
    ];

    for (const c of cases) {
      const res = await executeMigrationCli({
        argv: c.argv,
        env: c.env,
        logger: { log() {}, error() {} },
        connectFn: async () => { connectCalled++; return null; },
        disconnectFn: async () => {}
      });
      assert.equal(res.exitCode, 1, `Expected exitCode=1 for case: ${c.name}`);
    }
    assert.equal(connectCalled, 0);
  });

  await test('23. Production fails closed when QUICKR_PRODUCTION_MONGO_HOSTS missing, empty, wildcarded, or unlisted', async () => {
    let connectCalled = 0;

    // Missing allowlist
    const resMissing = await executeMigrationCli({
      argv: ['--environment=production', '--dry-run', '--confirm-db=SGS', '--confirm-host=cluster0.prod.mongodb.net', '--confirm-port=27017'],
      env: { QUICKR_MIGRATION_MONGODB_URI: 'mongodb+srv://u:p@cluster0.prod.mongodb.net/SGS' },
      logger: { log() {}, error() {} },
      connectFn: async () => { connectCalled++; return null; },
      disconnectFn: async () => {}
    });
    assert.equal(resMissing.exitCode, 1);

    // Empty / whitespace allowlist
    const resEmpty = await executeMigrationCli({
      argv: ['--environment=production', '--dry-run', '--confirm-db=SGS', '--confirm-host=cluster0.prod.mongodb.net', '--confirm-port=27017'],
      env: { QUICKR_MIGRATION_MONGODB_URI: 'mongodb+srv://u:p@cluster0.prod.mongodb.net/SGS', QUICKR_PRODUCTION_MONGO_HOSTS: '   ,  ' },
      logger: { log() {}, error() {} },
      connectFn: async () => { connectCalled++; return null; },
      disconnectFn: async () => {}
    });
    assert.equal(resEmpty.exitCode, 1);

    // Wildcard allowlist entry rejected
    const resWildcard = await executeMigrationCli({
      argv: ['--environment=production', '--dry-run', '--confirm-db=SGS', '--confirm-host=cluster0.prod.mongodb.net', '--confirm-port=27017'],
      env: { QUICKR_MIGRATION_MONGODB_URI: 'mongodb+srv://u:p@cluster0.prod.mongodb.net/SGS', QUICKR_PRODUCTION_MONGO_HOSTS: '*.mongodb.net' },
      logger: { log() {}, error() {} },
      connectFn: async () => { connectCalled++; return null; },
      disconnectFn: async () => {}
    });
    assert.equal(resWildcard.exitCode, 1);

    // Unlisted production hostname
    const resUnlisted = await executeMigrationCli({
      argv: ['--environment=production', '--dry-run', '--confirm-db=SGS', '--confirm-host=other.prod.mongodb.net', '--confirm-port=27017'],
      env: { QUICKR_MIGRATION_MONGODB_URI: 'mongodb+srv://u:p@other.prod.mongodb.net/SGS', QUICKR_PRODUCTION_MONGO_HOSTS: 'cluster0.prod.mongodb.net' },
      logger: { log() {}, error() {} },
      connectFn: async () => { connectCalled++; return null; },
      disconnectFn: async () => {}
    });
    assert.equal(resUnlisted.exitCode, 1);
    assert.equal(connectCalled, 0);
  });

  await test('24. Unknown CLI flags, --dryrun typo, and malformed boolean flags abort before APPLY or connecting', async () => {
    let connectCalled = 0;
    let migrateCalled = 0;

    const badArgLists = [
      ['--environment=staging', '--confirm-db=quickr_staging', '--confirm-host=127.0.0.1', '--confirm-port=27018', '--dryrun'],
      ['--environment=staging', '--confirm-db=quickr_staging', '--confirm-host=127.0.0.1', '--confirm-port=27018', '--dry_run'],
      ['--environment=staging', '--confirm-db=quickr_staging', '--confirm-host=127.0.0.1', '--confirm-port=27018', '--dry-run=false'],
      ['--environment=staging', '--confirm-db=quickr_staging', '--confirm-host=127.0.0.1', '--confirm-port=27018', '--dry-run=true'],
      ['--environment=staging', '--confirm-db=quickr_staging', '--confirm-host=127.0.0.1', '--confirm-port=27018', '--unknown-flag'],
      ['--environment=staging', '--confirm-db=quickr_staging', '--confirm-host=127.0.0.1', '--confirm-port=27018', 'positional'],
      ['--environment=production', '--confirm-db=SGS', '--confirm-host=cluster0.prod.mongodb.net', '--confirm-port=27017', '--confirm-production=true']
    ];

    for (const argv of badArgLists) {
      const res = await executeMigrationCli({
        argv,
        env: {
          QUICKR_MIGRATION_MONGODB_URI: 'mongodb://stage:pass@127.0.0.1:27018/quickr_staging',
          QUICKR_PRODUCTION_MONGO_HOSTS: 'cluster0.prod.mongodb.net'
        },
        logger: { log() {}, error() {} },
        connectFn: async () => { connectCalled++; return null; },
        migrateFn: async () => { migrateCalled++; return { exitCode: 0 }; },
        disconnectFn: async () => {}
      });
      assert.equal(res.exitCode, 1, `Expected exitCode=1 for malformed argv: ${argv.join(' ')}`);
    }
    assert.equal(connectCalled, 0);
    assert.equal(migrateCalled, 0);
  });

  await test('25. database.js connectDB sanitizes credentials, URIs, and auth query params in connection error logs', async () => {
    const errors = [];
    const logs = [];
    const secretUri = 'mongodb+srv://prod_admin:Super$ecret99!@cluster0.prod.mongodb.net/SGS?authSource=admin&authMechanism=SCRAM-SHA-256&password=InlinePwd';
    const origMongoUri = process.env.MONGODB_URI;
    const origNodeEnv = process.env.NODE_ENV;
    process.env.MONGODB_URI = secretUri;
    process.env.NODE_ENV = 'development';

    try {
      const res = await connectDB({
        mongooseLib: {
          connect: async () => {
            throw new Error(`Authentication failed for ${secretUri} (authSource=admin&password=ExtraSecret) on cluster0.prod.mongodb.net:27017`);
          }
        },
        logger: { log: (m) => logs.push(String(m)), error: (m) => errors.push(String(m)) }
      });
      assert.equal(res, null);
      const errOut = errors.join('\n');
      assert.equal(errOut.includes('prod_admin'), false);
      assert.equal(errOut.includes('Super$ecret99!'), false);
      assert.equal(errOut.includes('InlinePwd'), false);
      assert.equal(errOut.includes('ExtraSecret'), false);
      assert.equal(errOut.includes('mongodb+srv://'), false);
      assert.ok(errOut.includes('[REDACTED_URI]'));
      assert.ok(errOut.includes('Authentication failed'));
      assert.ok(errOut.includes('cluster0.prod.mongodb.net:27017'));

      // Also verify bare query params and bare user:pass@host redaction
      const rawSanitized = sanitizeMongoErrorText(
        'connect failed user:MyPass@db.internal:27017 ?authSource=admin&tlsCAFile=/etc/ca.pem ECONNREFUSED 127.0.0.1:27018'
      );
      assert.equal(rawSanitized.includes('MyPass'), false);
      assert.equal(rawSanitized.includes('/etc/ca.pem'), false);
      assert.ok(rawSanitized.includes('[REDACTED_CREDENTIALS]@db.internal:27017'));
      assert.ok(rawSanitized.includes('ECONNREFUSED 127.0.0.1:27018'));
    } finally {
      if (origMongoUri === undefined) delete process.env.MONGODB_URI;
      else process.env.MONGODB_URI = origMongoUri;
      if (origNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = origNodeEnv;
    }
  });

  await test('26. Destructive test/cleanup script guards block production hosts, NODE_ENV=production, generic --confirm, shared quickr, and backend/.env prod overrides', async () => {
    const uriInfo = parseMongoUriInfo('mongodb://stage:pass@127.0.0.1:27018/quickr_staging');
    assert.equal(uriInfo.valid, true);
    assert.equal(uriInfo.hosts[0].port, 27018);
    assert.equal(uriInfo.dbName, 'quickr_staging');

    // A. Generic --confirm forbidden
    assert.throws(
      () => assertSafeTestDatabaseConfig({
        scriptName: 'cleanupAllTestShops.js',
        argv: ['--confirm'],
        env: { TEST_MONGODB_URI: 'mongodb://127.0.0.1:27017/quickr_test' },
        requireWipeConfirmation: true,
        checkBackendEnvFile: false
      }),
      /Generic --confirm flag is forbidden/
    );

    // B. NODE_ENV=production blocked
    assert.throws(
      () => assertSafeTestDatabaseConfig({
        scriptName: 'testBillingConcurrency.js',
        argv: ['--confirm-test-env', '--confirm-db=quickr_billing_concurrency_test'],
        env: { NODE_ENV: 'production', TEST_MONGODB_URI: 'mongodb://127.0.0.1:27017/quickr_billing_concurrency_test' },
        checkBackendEnvFile: false
      }),
      /NODE_ENV=production/
    );

    // C. Refuses MONGODB_URI fallback and requires explicit isolated TEST_MONGODB_URI
    assert.throws(
      () => assertSafeTestDatabaseConfig({
        scriptName: 'testBillingConcurrency.js',
        argv: ['--confirm-test-env', '--confirm-db=quickr'],
        env: { MONGODB_URI: 'mongodb://127.0.0.1:27017/quickr' },
        checkBackendEnvFile: false
      }),
      /TEST_MONGODB_URI/
    );

    // D. Refuses Atlas SRV, *.mongodb.net, allowlisted prod hosts, and SGS database
    for (const badUri of [
      'mongodb+srv://u:p@cluster0.prod.mongodb.net/SGS',
      'mongodb://u:p@ac-00.prod.mongodb.net:27017/quickr_test',
      'mongodb://127.0.0.1:27017/SGS',
      'mongodb://127.0.0.1:27017/quickr'
    ]) {
      assert.throws(
        () => assertSafeTestDatabaseConfig({
          scriptName: 'testGstPricingSuite.js',
          argv: ['--confirm-test-env', '--confirm-db=quickr_test'],
          env: {
            TEST_MONGODB_URI: badUri,
            QUICKR_PRODUCTION_MONGO_HOSTS: 'cluster0.prod.mongodb.net,ac-00.prod.mongodb.net'
          },
          checkBackendEnvFile: false
        })
      );
    }

    // E. Refuses backend/.env containing NODE_ENV=production or Atlas MONGODB_URI
    const tmpDotEnv = path.join(os.tmpdir(), `quickr-bad-backend-${Date.now()}.env`);
    fs.writeFileSync(tmpDotEnv, 'MONGODB_URI=mongodb+srv://u:p@cluster0.prod.mongodb.net/SGS\n', 'utf8');
    try {
      const check = inspectEnvFileForProductionOverrides(tmpDotEnv);
      assert.equal(check.safe, false);
      assert.throws(
        () => assertSafeTestDatabaseConfig({
          scriptName: 'testBillingConcurrency.js',
          argv: ['--confirm-test-env', '--confirm-db=quickr_billing_concurrency_test'],
          env: { TEST_MONGODB_URI: 'mongodb://127.0.0.1:27017/quickr_billing_concurrency_test' },
          backendEnvPath: tmpDotEnv,
          checkBackendEnvFile: true
        }),
        /remote\/Atlas\/production/
      );
    } finally {
      fs.unlinkSync(tmpDotEnv);
    }

    // F. Valid localhost isolated test configuration passes AND syncIndexes pre-check blocks wrong connected targets
    const safe = assertSafeTestDatabaseConfig({
      scriptName: 'testBillingConcurrency.js',
      argv: ['--confirm-test-env', '--confirm-db=quickr_billing_concurrency_test'],
      env: { TEST_MONGODB_URI: 'mongodb://127.0.0.1:27017/quickr_billing_concurrency_test' },
      checkBackendEnvFile: false
    });
    assert.equal(safe.expectedDbName, 'quickr_billing_concurrency_test');

    assert.throws(
      () => assertSafeConnectedTestTarget(
        { connection: { host: 'ac-00.prod.mongodb.net', port: 27017, name: 'SGS' } },
        safe,
        { operation: 'syncIndexes' }
      ),
      /Refusing syncIndexes/
    );

    const okMeta = assertSafeConnectedTestTarget(
      { connection: { host: '127.0.0.1', port: 27017, name: 'quickr_billing_concurrency_test' } },
      safe,
      { operation: 'syncIndexes' }
    );
    assert.equal(okMeta.dbName, 'quickr_billing_concurrency_test');
  });

  console.log(`\n=== MIGRATION SAFETY SUMMARY: ${passed} PASSED, ${failed} FAILED (Total ${passed + failed}) ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal migration safety suite error:', err);
  process.exit(1);
});
