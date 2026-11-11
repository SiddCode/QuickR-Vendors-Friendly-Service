/**
 * Automated Invoice Counter Migration Safety Suite (Mocked DB Operations)
 *
 * Tests all 12 safety requirements for migrateInvoiceCounters.js and
 * invoiceCounterService.js without connecting to or modifying any real MongoDB.
 */
import assert from 'node:assert/strict';

process.env.QUICKR_TEST_IMPORT = 'true';

const {
  runInvoiceCounterMigration,
  executeMigrationCli,
  parseMigrationArgs,
  sanitizeSensitiveText
} = await import('./migrateInvoiceCounters.js');
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
  // ENV GUARD, TARGET CONFIRMATION, REDACTION & CLEANUP TESTS (Section 6: 1-12)
  // ---------------------------------------------------------------------------
  console.log('\n  --- CLI Environment & Target Confirmation Guard Tests ---');

  await test('8. Rejects missing QUICKR_MIGRATION_MONGODB_URI even if MONGODB_URI exists and rejects implicit backend/.env', async () => {
    let connectCalled = 0;
    const logs = [];
    const env = { MONGODB_URI: 'mongodb://127.0.0.1:27017/quickr', NODE_ENV: 'staging' };
    const res = await executeMigrationCli({
      argv: ['--environment=staging', '--dry-run', '--confirm-db=quickr', '--confirm-host=127.0.0.1'],
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
      argv: ['--environment=staging', '--dry-run', '--confirm-db=quickr', '--confirm-host=127.0.0.1'],
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
      argv: ['--environment=staging', '--dry-run', '--confirm-db=staging_db', '--confirm-host=staging.host'],
      env: {}, // No QUICKR_MIGRATION_MONGODB_URI
      logger: { log() {}, error() {} },
      loadEnvFn: (p) => { loadedPath = p; },
      connectFn: async () => { throw new Error('Should not connect'); },
      disconnectFn: async () => {}
    });
    assert.equal(res.exitCode, 1);
    assert.equal(loadedPath, null);

    // Explicit --env-file missing on disk rejects safely
    const resMissingFile = await executeMigrationCli({
      argv: ['--env-file=/nonexistent/migration.env', '--environment=staging', '--dry-run', '--confirm-db=a', '--confirm-host=b'],
      env: {},
      logger: { log() {}, error() {} }
    });
    assert.equal(resMissingFile.exitCode, 1);
  });

  await test('11. Missing --confirm-db rejects before any connection attempt (both dry-run and apply)', async () => {
    let connectCalled = 0;
    const logs = [];
    const env = { QUICKR_MIGRATION_MONGODB_URI: 'mongodb+srv://u:p@cluster0.test.mongodb.net/staging_db' };
    const resDry = await executeMigrationCli({
      argv: ['--environment=staging', '--dry-run', '--confirm-host=cluster0.test.mongodb.net'],
      env,
      logger: { log() {}, error: (m) => logs.push(m) },
      connectFn: async () => { connectCalled++; return null; },
      disconnectFn: async () => {}
    });
    assert.equal(resDry.exitCode, 1);
    assert.equal(connectCalled, 0);
    assert.ok(logs.some((l) => l.includes('--confirm-db')));
  });

  await test('12. Wrong --confirm-db aborts BEFORE migration queries, disconnects cleanly, and restores env.MONGODB_URI', async () => {
    let migrated = false;
    let disconnected = false;
    const logs = [];
    const env = {
      QUICKR_MIGRATION_MONGODB_URI: 'mongodb+srv://adminuser:supersecret@cluster0.test.mongodb.net/prod_actual',
      MONGODB_URI: 'mongodb://old-app-uri/dev',
      NODE_ENV: 'staging'
    };
    const res = await executeMigrationCli({
      argv: ['--environment=staging', '--dry-run', '--confirm-db=staging_expected', '--confirm-host=cluster0.test.mongodb.net'],
      env,
      logger: { log: (m) => logs.push(m), error: (m) => logs.push(m) },
      setMongooseFlagsFn: () => {},
      connectFn: async () => ({
        connection: { host: 'cluster0.test.mongodb.net', name: 'prod_actual' }
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
      argv: ['--environment=staging', '--dry-run', '--confirm-db=staging_db'],
      env: { QUICKR_MIGRATION_MONGODB_URI: 'mongodb+srv://u:p@cluster0.test.mongodb.net/staging_db' },
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
      argv: ['--environment=staging', '--dry-run', '--confirm-db=staging_db', '--confirm-host=cluster0'], // Substring of cluster0.test.mongodb.net!
      env: { QUICKR_MIGRATION_MONGODB_URI: 'mongodb+srv://u:p@cluster0.test.mongodb.net/staging_db', NODE_ENV: 'staging' },
      logger: { log: (m) => logs.push(m), error: (m) => logs.push(m) },
      setMongooseFlagsFn: () => {},
      connectFn: async () => ({
        connection: {
          host: 'ac-shard-00-00.test.mongodb.net',
          name: 'staging_db',
          client: { s: { options: { srvHost: 'cluster0.test.mongodb.net' } } }
        }
      }),
      disconnectFn: async () => { disconnected++; },
      migrateFn: async () => { migrated = true; return { exitCode: 0 }; }
    });
    assert.equal(res.exitCode, 1);
    assert.equal(migrated, false);
    assert.equal(disconnected, 1);
    assert.ok(logs.some((l) => l.includes('Host confirmation mismatch')));
  });

  await test('15. Production apply requires --confirm-production (even when NODE_ENV unset) and never infers env from DB name', async () => {
    let connectCalled = 0;
    const logs = [];
    const resNoConfirm = await executeMigrationCli({
      argv: ['--environment=production', '--confirm-db=staging_named_db', '--confirm-host=cluster0.prod.mongodb.net'],
      env: {
        QUICKR_MIGRATION_MONGODB_URI: 'mongodb+srv://u:p@cluster0.prod.mongodb.net/staging_named_db'
      },
      logger: { log: (m) => logs.push(m), error: (m) => logs.push(m) },
      connectFn: async () => { connectCalled++; return null; },
      disconnectFn: async () => {}
    });
    assert.equal(resNoConfirm.exitCode, 1);
    assert.equal(connectCalled, 0);
    assert.ok(logs.some((l) => l.includes('--confirm-production')));

    // Conversely, --environment=production --dry-run succeeds cleanly without --confirm-production
    let dryMigrated = false;
    const resProdDry = await executeMigrationCli({
      argv: ['--environment=production', '--dry-run', '--confirm-db=prod_db', '--confirm-host=cluster0.prod.mongodb.net'],
      env: {
        QUICKR_MIGRATION_MONGODB_URI: 'mongodb+srv://u:p@cluster0.prod.mongodb.net/prod_db',
        NODE_ENV: 'production'
      },
      logger: { log() {}, error() {} },
      setMongooseFlagsFn: () => {},
      connectFn: async () => ({ connection: { host: 'cluster0.prod.mongodb.net', name: 'prod_db' } }),
      disconnectFn: async () => {},
      migrateFn: async () => { dryMigrated = true; return { exitCode: 0 }; }
    });
    assert.equal(resProdDry.exitCode, 0);
    assert.equal(dryMigrated, true);
  });

  await test('16. Correct target confirmation prints sanitized banner, enforces autoIndex=false/autoCreate=false, and runs apply', async () => {
    const logs = [];
    let flagsDisabled = false;
    let disconnected = false;
    const parsedArgs = parseMigrationArgs(['--environment', 'production', '--confirm-db', 'quickr_prod', '--confirm-host', 'cluster0.prod.mongodb.net', '--confirm-production']);
    assert.equal(parsedArgs.environment, 'production');
    assert.equal(parsedArgs.confirmDb, 'quickr_prod');
    assert.equal(parsedArgs.confirmHost, 'cluster0.prod.mongodb.net');
    assert.equal(parsedArgs.confirmProduction, true);

    const res = await executeMigrationCli({
      argv: ['--environment=production', '--confirm-db=quickr_prod', '--confirm-host=cluster0.prod.mongodb.net', '--confirm-production'],
      env: {
        QUICKR_MIGRATION_MONGODB_URI: 'mongodb+srv://dbadmin:SuperSecret99@cluster0.prod.mongodb.net/quickr_prod?retryWrites=true',
        NODE_ENV: 'production'
      },
      logger: { log: (m) => logs.push(m), error: (m) => logs.push(m) },
      setMongooseFlagsFn: () => { flagsDisabled = true; },
      connectFn: async () => ({
        connection: {
          host: 'ac-abc-00-00.prod.mongodb.net',
          name: 'quickr_prod',
          client: { s: { options: { srvHost: 'cluster0.prod.mongodb.net' } } }
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
    assert.ok(joined.includes('Database Name       : quickr_prod'));
    assert.ok(joined.includes('Target Environment  : production'));
    assert.ok(joined.includes('NODE_ENV            : production'));
    assert.ok(joined.includes('Migration Mode      : APPLY'));
    assert.ok(joined.includes('PRODUCTION=CONFIRMED'));
  });

  await test('17. Full CLI dry-run performs zero counter writes and zero index operations while keeping autoIndex/autoCreate disabled', async () => {
    const envMock = createMockMigrationEnv({
      shops: ['SHOP-STAGE'],
      sales: [{ id: 'S-1', shopId: 'SHOP-STAGE', invoiceNumber: 'INV-000004' }]
    });
    let flagsDisabled = false;
    let disconnected = false;
    const logs = [];

    const res = await executeMigrationCli({
      argv: ['--environment=staging', '--dry-run', '--confirm-db=quickr_staging', '--confirm-host=staging.cluster.mongodb.net'],
      env: {
        QUICKR_MIGRATION_MONGODB_URI: 'mongodb+srv://stage_user:StageSecret123@staging.cluster.mongodb.net/quickr_staging',
        NODE_ENV: 'staging'
      },
      logger: { log: (m) => logs.push(m), error: (m) => logs.push(m) },
      setMongooseFlagsFn: () => { flagsDisabled = true; },
      connectFn: async () => ({ connection: { host: 'staging.cluster.mongodb.net', name: 'quickr_staging' } }),
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
    assert.ok(logs.join('\n').includes('Migration Mode      : DRY_RUN'));
  });

  await test('18. Credentials and full URIs never appear in banner, normal logs, or thrown error logs', async () => {
    const secretUri = 'mongodb+srv://secret_admin:UltraSecretPass!123@cluster0.prod.mongodb.net/quickr_prod?authSource=admin';
    assert.equal(sanitizeSensitiveText(`Failed on ${secretUri}`, secretUri), 'Failed on [REDACTED_URI]');

    const logs = [];
    let disconnected = false;
    const res = await executeMigrationCli({
      argv: ['--environment=staging', '--dry-run', '--confirm-db=quickr_prod', '--confirm-host=cluster0.prod.mongodb.net'],
      env: { QUICKR_MIGRATION_MONGODB_URI: secretUri, NODE_ENV: 'staging' },
      logger: { log: (m) => logs.push(String(m)), error: (m) => logs.push(String(m)) },
      setMongooseFlagsFn: () => {},
      connectFn: async () => ({ connection: { host: 'cluster0.prod.mongodb.net', name: 'quickr_prod' } }),
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

  await test('19. Connection cleanup and original env.MONGODB_URI restoration occur cleanly after target mismatch', async () => {
    let disconnectCount = 0;
    const env = {
      QUICKR_MIGRATION_MONGODB_URI: 'mongodb://user:pass@wrong-host.internal:27017/staging_db',
      NODE_ENV: 'staging'
    };

    const res = await executeMigrationCli({
      argv: ['--environment=staging', '--confirm-db=staging_db', '--confirm-host=expected-host.internal'],
      env,
      logger: { log() {}, error() {} },
      setMongooseFlagsFn: () => {},
      connectFn: async () => {
        assert.equal(env.MONGODB_URI, 'mongodb://user:pass@wrong-host.internal:27017/staging_db');
        return { connection: { host: 'wrong-host.internal', name: 'staging_db' } };
      },
      disconnectFn: async () => { disconnectCount++; },
      migrateFn: async () => { throw new Error('Should not run migrateFn after host mismatch'); }
    });

    assert.equal(res.exitCode, 1);
    assert.equal(disconnectCount, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(env, 'MONGODB_URI'), false);
  });

  await test('20. Missing --environment argument rejects before connecting', async () => {
    let connectCalled = 0;
    const logs = [];
    const res = await executeMigrationCli({
      argv: ['--dry-run', '--confirm-db=staging_db', '--confirm-host=staging.host'],
      env: { QUICKR_MIGRATION_MONGODB_URI: 'mongodb+srv://u:p@staging.host/staging_db' },
      logger: { log() {}, error: (m) => logs.push(m) },
      connectFn: async () => { connectCalled++; return null; },
      disconnectFn: async () => {}
    });
    assert.equal(res.exitCode, 1);
    assert.equal(connectCalled, 0);
    assert.ok(logs.some((l) => l.includes('--environment=staging or --environment=production')));
  });

  await test('21. Invalid --environment argument (dev/prod/local) rejects strictly before connecting', async () => {
    for (const invalidEnv of ['dev', 'prod', 'local', 'STAGING']) {
      let connectCalled = 0;
      const logs = [];
      const res = await executeMigrationCli({
        argv: [`--environment=${invalidEnv}`, '--dry-run', '--confirm-db=staging_db', '--confirm-host=staging.host'],
        env: { QUICKR_MIGRATION_MONGODB_URI: 'mongodb+srv://u:p@staging.host/staging_db' },
        logger: { log() {}, error: (m) => logs.push(m) },
        connectFn: async () => { connectCalled++; return null; },
        disconnectFn: async () => {}
      });
      assert.equal(res.exitCode, 1);
      assert.equal(connectCalled, 0);
      assert.ok(logs.some((l) => l.includes('Invalid --environment')));
    }
  });

  await test('22. Trusted QUICKR_PRODUCTION_MONGO_HOSTS allowlist blocks treating a production host as staging (both pre-connect and post-connect)', async () => {
    // A. Pre-connect guard on confirmHost
    let preConnectCalls = 0;
    const logsA = [];
    const resPre = await executeMigrationCli({
      argv: ['--environment=staging', '--dry-run', '--confirm-db=quickr', '--confirm-host=cluster0.prod.mongodb.net'],
      env: {
        QUICKR_MIGRATION_MONGODB_URI: 'mongodb+srv://u:p@cluster0.prod.mongodb.net/quickr',
        QUICKR_PRODUCTION_MONGO_HOSTS: 'cluster0.prod.mongodb.net,ac-shard-00-00.prod.mongodb.net'
      },
      logger: { log() {}, error: (m) => logsA.push(m) },
      connectFn: async () => { preConnectCalls++; return null; },
      disconnectFn: async () => {}
    });
    assert.equal(resPre.exitCode, 1);
    assert.equal(preConnectCalls, 0);
    assert.ok(logsA.some((l) => l.includes('QUICKR_PRODUCTION_MONGO_HOSTS')));

    // B. Post-connect guard catches resolved SRV shard host matching production allowlist even when confirmHost used alias/shard
    let migrated = false;
    let disconnected = false;
    const logsB = [];
    const resPost = await executeMigrationCli({
      argv: ['--environment=staging', '--dry-run', '--confirm-db=quickr', '--confirm-host=alias.example.net'],
      env: {
        QUICKR_MIGRATION_MONGODB_URI: 'mongodb+srv://u:p@alias.example.net/quickr',
        QUICKR_PRODUCTION_MONGO_HOSTS: 'ac-shard-00-00.prod.mongodb.net'
      },
      logger: { log: (m) => logsB.push(m), error: (m) => logsB.push(m) },
      setMongooseFlagsFn: () => {},
      connectFn: async () => ({
        connection: {
          host: 'ac-shard-00-00.prod.mongodb.net',
          name: 'quickr',
          client: { s: { options: { srvHost: 'alias.example.net' } } }
        }
      }),
      disconnectFn: async () => { disconnected = true; },
      migrateFn: async () => { migrated = true; return { exitCode: 0 }; }
    });
    assert.equal(resPost.exitCode, 1);
    assert.equal(migrated, false);
    assert.equal(disconnected, true);
    assert.ok(logsB.some((l) => l.includes('QUICKR_PRODUCTION_MONGO_HOSTS')));

    // C. When allowlist is configured, --environment=production rejects staging hosts not in allowlist
    let nonProdConnectCalls = 0;
    const resWrongProd = await executeMigrationCli({
      argv: ['--environment=production', '--dry-run', '--confirm-db=quickr_stage', '--confirm-host=cluster0.stage.mongodb.net'],
      env: {
        QUICKR_MIGRATION_MONGODB_URI: 'mongodb+srv://u:p@cluster0.stage.mongodb.net/quickr_stage',
        QUICKR_PRODUCTION_MONGO_HOSTS: 'cluster0.prod.mongodb.net'
      },
      logger: { log() {}, error() {} },
      connectFn: async () => { nonProdConnectCalls++; return null; },
      disconnectFn: async () => {}
    });
    assert.equal(resWrongProd.exitCode, 1);
    assert.equal(nonProdConnectCalls, 0);
  });

  console.log(`\n=== MIGRATION SAFETY SUMMARY: ${passed} PASSED, ${failed} FAILED (Total ${passed + failed}) ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal migration safety suite error:', err);
  process.exit(1);
});
