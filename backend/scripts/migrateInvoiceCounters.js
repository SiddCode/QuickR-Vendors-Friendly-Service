import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import {
  APPROVED_STAGING_TARGET,
  sanitizeMongoErrorText,
  parseMongoUriInfo,
  parseHostAllowlist,
  extractActualConnectionMetadata,
  isProductionLikeHostname
} from '../utils/mongoSafety.js';
import { connectDB } from '../config/database.js';
import { Shop } from '../models/Shop.js';
import { Sale } from '../models/Sale.js';
import { InvoiceCounter } from '../models/InvoiceCounter.js';
import {
  analyzeShopInvoiceHistory,
  detectDuplicateInvoiceNumbers,
  ensureInvoiceCounterInitialized
} from '../services/invoiceCounterService.js';

export { sanitizeMongoErrorText as sanitizeSensitiveText, parseHostAllowlist };

function isExactShopInvoiceIndex(idx) {
  if (!idx || !idx.key || typeof idx.key !== 'object') return false;
  const keys = Object.keys(idx.key);
  return (
    keys.length === 2 &&
    keys[0] === 'shopId' &&
    keys[1] === 'invoiceNumber' &&
    idx.key.shopId === 1 &&
    idx.key.invoiceNumber === 1
  );
}

async function readSaleIndexesSafe(collection) {
  try {
    return await collection.indexes();
  } catch (err) {
    // NamespaceNotFound (code 26): fresh DB where 'sales' collection does not exist yet
    if (err?.code === 26 || err?.codeName === 'NamespaceNotFound') {
      return [];
    }
    throw err;
  }
}

function readFlagValue(argv, index, raw, flagName) {
  const prefix = `--${flagName}=`;
  if (raw.startsWith(prefix)) {
    const val = raw.slice(prefix.length).trim();
    if (!val) throw new Error(`--${flagName} requires a non-empty value.`);
    return { value: val, nextIndex: index };
  }
  if (raw === `--${flagName}`) {
    const next = argv[index + 1];
    if (!next || String(next).startsWith('--') || !String(next).trim()) {
      throw new Error(`--${flagName} requires a non-empty value.`);
    }
    return { value: String(next).trim(), nextIndex: index + 1 };
  }
  return null;
}

/**
 * Strictly parses CLI flags (--flag=value and --flag value forms).
 * Rejects every unknown, duplicate, or malformed flag (such as --dryrun or --dry-run=false)
 * so typos can never silently turn DRY-RUN into APPLY mode.
 */
export function parseMigrationArgs(argv = []) {
  const args = {
    isDryRun: false,
    initCountersOnly: false,
    confirmProduction: false,
    environment: null,
    envFile: null,
    confirmDb: null,
    confirmHost: null,
    confirmPort: null
  };

  const booleanFlags = new Set(['--dry-run', '--init-counters-only', '--confirm-production']);
  const seenFlags = new Set();

  for (let i = 0; i < argv.length; i++) {
    const raw = String(argv[i] || '').trim();
    if (!raw) continue;

    if (raw === '--dry-run') {
      if (seenFlags.has('--dry-run')) throw new Error('Duplicate flag: "--dry-run".');
      seenFlags.add('--dry-run');
      args.isDryRun = true;
      continue;
    }
    if (raw === '--init-counters-only') {
      if (seenFlags.has('--init-counters-only')) throw new Error('Duplicate flag: "--init-counters-only".');
      seenFlags.add('--init-counters-only');
      args.initCountersOnly = true;
      continue;
    }
    if (raw === '--confirm-production') {
      if (seenFlags.has('--confirm-production')) throw new Error('Duplicate flag: "--confirm-production".');
      seenFlags.add('--confirm-production');
      args.confirmProduction = true;
      continue;
    }

    for (const boolName of booleanFlags) {
      if (raw.startsWith(`${boolName}=`)) {
        throw new Error(`Malformed CLI flag "${raw}": "${boolName}" is a boolean flag and does not accept a value.`);
      }
    }

    const envFlag = readFlagValue(argv, i, raw, 'environment');
    if (envFlag) {
      if (seenFlags.has('--environment')) throw new Error('Duplicate flag: "--environment".');
      seenFlags.add('--environment');
      args.environment = envFlag.value;
      i = envFlag.nextIndex;
      continue;
    }

    const envFileFlag = readFlagValue(argv, i, raw, 'env-file');
    if (envFileFlag) {
      if (seenFlags.has('--env-file')) throw new Error('Duplicate flag: "--env-file".');
      seenFlags.add('--env-file');
      args.envFile = envFileFlag.value;
      i = envFileFlag.nextIndex;
      continue;
    }

    const dbFlag = readFlagValue(argv, i, raw, 'confirm-db');
    if (dbFlag) {
      if (seenFlags.has('--confirm-db')) throw new Error('Duplicate flag: "--confirm-db".');
      seenFlags.add('--confirm-db');
      args.confirmDb = dbFlag.value;
      i = dbFlag.nextIndex;
      continue;
    }

    const hostFlag = readFlagValue(argv, i, raw, 'confirm-host');
    if (hostFlag) {
      if (seenFlags.has('--confirm-host')) throw new Error('Duplicate flag: "--confirm-host".');
      seenFlags.add('--confirm-host');
      args.confirmHost = hostFlag.value;
      i = hostFlag.nextIndex;
      continue;
    }

    const portFlag = readFlagValue(argv, i, raw, 'confirm-port');
    if (portFlag) {
      if (seenFlags.has('--confirm-port')) throw new Error('Duplicate flag: "--confirm-port".');
      seenFlags.add('--confirm-port');
      if (!/^\d+$/.test(portFlag.value)) {
        throw new Error(`Invalid --confirm-port="${portFlag.value}". Expected an integer port between 1 and 65535.`);
      }
      const parsedPort = Number.parseInt(portFlag.value, 10);
      if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
        throw new Error(`Invalid --confirm-port="${portFlag.value}". Port must be between 1 and 65535.`);
      }
      args.confirmPort = parsedPort;
      i = portFlag.nextIndex;
      continue;
    }

    if (/^--?dry[-_]?run/i.test(raw) || raw === '-dryrun' || raw === '--dry') {
      throw new Error(`Malformed CLI flag "${raw}". Use exact "--dry-run" flag.`);
    }

    throw new Error(`Unknown or unsupported CLI argument: "${raw}".`);
  }

  return args;
}

/**
 * Extracts exact hostname and port sets exposed by the connected Mongoose/MongoDB client
 * without ever using substring matching.
 */
export function extractActualHosts(conn) {
  return extractActualConnectionMetadata(conn);
}

/**
 * Pure, testable migration runner. Does NOT mutate historical sales or exit the process.
 * Returns { exitCode, summary } so callers/CLI can clean up connections inside finally.
 */
export async function runInvoiceCounterMigration({
  isDryRun = false,
  initCountersOnly = false,
  logger = console,
  models = { Shop, Sale, InvoiceCounter },
  services = { analyzeShopInvoiceHistory, detectDuplicateInvoiceNumbers, ensureInvoiceCounterInitialized }
} = {}) {
  const summary = {
    mode: isDryRun ? 'DRY_RUN' : 'APPLY',
    shopsDiscovered: 0,
    duplicateGroups: [],
    malformedShops: [],
    countersPlanned: [],
    countersApplied: [],
    indexAction: 'NONE'
  };

  logger.log(`\n=== QuickR Invoice Counter & Unique Index Migration (${summary.mode}) ===\n`);

  // 1. Collect all shops from Shop and Sale collections
  const [shops, distinctSaleShopIds] = await Promise.all([
    models.Shop.find().select('customId name').lean(),
    models.Sale.distinct('shopId')
  ]);

  const allShopIds = [...new Set([
    ...shops.map((s) => s.customId).filter(Boolean),
    ...distinctSaleShopIds.filter(Boolean)
  ])].sort();

  summary.shopsDiscovered = allShopIds.length;
  logger.log(`Discovered ${allShopIds.length} shop(s) to verify/initialize.`);

  // 2. Detect existing historical duplicate (shopId, invoiceNumber) pairs without modifying sales
  const duplicates = await services.detectDuplicateInvoiceNumbers();
  summary.duplicateGroups = duplicates;

  if (duplicates.length > 0) {
    logger.error(`\n[ERROR] Detected ${duplicates.length} duplicate (shopId, invoiceNumber) group(s):`);
    for (const dup of duplicates) {
      logger.error(
        `  - shopId=${dup.shopId}, invoiceNumber=${dup.invoiceNumber}, count=${dup.count}, saleIds=[${dup.saleIds.join(', ')}]`
      );
    }
    logger.error('No historical sales were deleted or renumbered.');
  } else {
    logger.log('Historical duplicate check: 0 duplicate (shopId, invoiceNumber) entries found.');
  }

  // 3. Validate historical invoiceNumber integrity per shop (detect missing/malformed records)
  const shopHistories = new Map();
  for (const shopId of allShopIds) {
    const history = await services.analyzeShopInvoiceHistory(shopId);
    shopHistories.set(shopId, history);

    if (history.malformed.length > 0) {
      summary.malformedShops.push({ shopId, malformed: history.malformed });
      logger.error(
        `\n[ERROR] Detected ${history.malformed.length} missing/malformed invoiceNumber record(s) in shopId=${shopId}:`
      );
      for (const item of history.malformed.slice(0, 10)) {
        logger.error(
          `  - saleId=${item.saleId}, invoiceNumber=${JSON.stringify(item.invoiceNumber)}, reason=${item.reason}`
        );
      }
      if (history.malformed.length > 10) {
        logger.error(`  ... and ${history.malformed.length - 10} more.`);
      }
    }
  }

  // Abort BEFORE any writes or index drops if duplicates OR malformed invoice numbers exist
  if (duplicates.length > 0 || summary.malformedShops.length > 0) {
    if (isDryRun) {
      logger.error(
        '\n[DRY RUN] Migration would ABORT before modifying counters or indexes until duplicates/malformed records above are resolved.'
      );
    } else {
      logger.error(
        '\n[ABORTED] No counters were written and no indexes were dropped/modified. Resolve reported issues above and re-run cleanly.'
      );
    }
    return { exitCode: 2, summary };
  }

  // 4. Plan or apply per-shop InvoiceCounter seeding ($max preserves higher existing counters)
  if (isDryRun) {
    for (const shopId of allShopIds) {
      const history = shopHistories.get(shopId);
      const existingCounter = await models.InvoiceCounter.findOne({ shopId }).select('seq').lean();
      const currentSeq = existingCounter?.seq ?? null;
      const targetSeq = currentSeq !== null ? Math.max(currentSeq, history.maxSeq) : history.maxSeq;
      summary.countersPlanned.push({ shopId, totalSales: history.totalSales, maxHistoricalSeq: history.maxSeq, currentSeq, targetSeq });
      logger.log(
        `  [DRY RUN] shopId=${shopId}: sales=${history.totalSales}, maxHistorical=${history.maxSeq}, currentCounter=${currentSeq ?? 'none'} -> targetSeq=${targetSeq}`
      );
    }
  } else {
    // Ensure InvoiceCounter unique { shopId: 1 } index exists only during apply
    await models.InvoiceCounter.createIndexes();

    for (const shopId of allShopIds) {
      const history = shopHistories.get(shopId);
      const counter = await services.ensureInvoiceCounterInitialized(shopId, {
        maxHistoricalOverride: history.maxSeq
      });
      summary.countersApplied.push({ shopId, seq: counter.seq });
      logger.log(`  [OK] Counter shopId=${shopId} synced at seq=${counter.seq}`);
    }
  }

  // 5. Inspect & enforce unique compound index on { shopId: 1, invoiceNumber: 1 }
  if (initCountersOnly) {
    summary.indexAction = 'SKIPPED_BY_FLAG';
    logger.log('\nSkipped unique index creation (--init-counters-only).');
    return { exitCode: 0, summary };
  }

  const existingIndexes = await readSaleIndexesSafe(models.Sale.collection);
  const matchingIndex = existingIndexes.find(isExactShopInvoiceIndex);
  const collidingSameName = !matchingIndex
    ? existingIndexes.find((idx) => idx.name === 'shopId_1_invoiceNumber_1')
    : null;

  if (collidingSameName) {
    logger.error(
      `[ERROR] Index "shopId_1_invoiceNumber_1" exists with unexpected key order/spec: ${JSON.stringify(collidingSameName.key)}. Refusing blind modification.`
    );
    summary.indexAction = 'CONFLICTING_SPEC';
    return { exitCode: 2, summary };
  }

  if (matchingIndex && matchingIndex.unique === true) {
    summary.indexAction = 'ALREADY_UNIQUE';
    logger.log(`[OK] Unique compound index "${matchingIndex.name}" on { shopId: 1, invoiceNumber: 1 } already exists.`);
  } else if (matchingIndex && !matchingIndex.unique) {
    if (isDryRun) {
      summary.indexAction = 'WOULD_REPLACE_LEGACY_NON_UNIQUE';
      logger.log(
        `[DRY RUN] Would drop legacy non-unique index "${matchingIndex.name}" and create unique { shopId: 1, invoiceNumber: 1 }.`
      );
    } else {
      logger.log(`Replacing non-unique legacy index "${matchingIndex.name}"...`);
      await models.Sale.collection.dropIndex(matchingIndex.name);
      await models.Sale.collection.createIndex(
        { shopId: 1, invoiceNumber: 1 },
        { unique: true, name: 'shopId_1_invoiceNumber_1' }
      );
      summary.indexAction = 'REPLACED_LEGACY_WITH_UNIQUE';
      logger.log('[OK] Created unique compound index { shopId: 1, invoiceNumber: 1 } on sales collection.');
    }
  } else {
    if (isDryRun) {
      summary.indexAction = 'WOULD_CREATE_UNIQUE';
      logger.log('[DRY RUN] Would create unique compound index { shopId: 1, invoiceNumber: 1 } on sales collection.');
    } else {
      await models.Sale.collection.createIndex(
        { shopId: 1, invoiceNumber: 1 },
        { unique: true, name: 'shopId_1_invoiceNumber_1' }
      );
      summary.indexAction = 'CREATED_UNIQUE';
      logger.log('[OK] Created unique compound index { shopId: 1, invoiceNumber: 1 } on sales collection.');
    }
  }

  logger.log(`\nMigration ${isDryRun ? 'dry-run verification' : 'execution'} completed cleanly.\n`);
  return { exitCode: 0, summary };
}

function defaultLoadEnvFile(envFilePath, targetEnv = process.env) {
  const resolved = path.resolve(envFilePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Explicit --env-file path does not exist: ${envFilePath}`);
  }
  let parsed;
  try {
    parsed = dotenv.parse(fs.readFileSync(resolved));
  } catch (err) {
    throw new Error(`Failed to load --env-file (${envFilePath}): ${err.message}`);
  }

  const addedKeys = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (!Object.prototype.hasOwnProperty.call(targetEnv, key)) {
      targetEnv[key] = value;
      addedKeys.push(key);
    }
  }
  return addedKeys;
}

/**
 * Full CLI/environment orchestrator enforcing dedicated QUICKR_MIGRATION_MONGODB_URI,
 * explicit --env-file (never implicit backend/.env), --environment=staging|production,
 * --confirm-db, --confirm-host, --confirm-port, mandatory non-empty
 * QUICKR_PRODUCTION_MONGO_HOSTS allowlist for production, locked staging endpoint
 * (127.0.0.1:27018/quickr_staging, non-SRV), --confirm-production (for production apply),
 * pre-operation banner, credential-safe logging, and guaranteed cleanup on all exit paths.
 */
export async function executeMigrationCli({
  argv = [],
  env = process.env,
  logger = console,
  loadEnvFn = defaultLoadEnvFile,
  connectFn = connectDB,
  disconnectFn = () => mongoose.disconnect(),
  setMongooseFlagsFn = () => {
    mongoose.set('autoIndex', false);
    mongoose.set('autoCreate', false);
  },
  migrateFn = (opts) => runInvoiceCounterMigration(opts)
} = {}) {
  const hadOriginalMongoUri = Object.prototype.hasOwnProperty.call(env, 'MONGODB_URI');
  const originalMongoUri = env.MONGODB_URI;
  const addedEnvKeys = [];
  let rawMigrationUri = '';
  let conn = null;

  try {
    const args = parseMigrationArgs(argv);

    if (args.envFile) {
      const loadedKeys = loadEnvFn(args.envFile, env);
      if (Array.isArray(loadedKeys)) {
        addedEnvKeys.push(...loadedKeys);
      }
    }

    rawMigrationUri = typeof env.QUICKR_MIGRATION_MONGODB_URI === 'string'
      ? env.QUICKR_MIGRATION_MONGODB_URI.trim()
      : '';

    if (!rawMigrationUri) {
      logger.error(
        '[ABORTED] QUICKR_MIGRATION_MONGODB_URI must be explicitly set (no fallback to MONGODB_URI, backend/.env, or 127.0.0.1).'
      );
      return { exitCode: 1 };
    }

    const uriInfo = parseMongoUriInfo(rawMigrationUri);
    if (!uriInfo.valid) {
      logger.error(`[ABORTED] Invalid QUICKR_MIGRATION_MONGODB_URI: ${uriInfo.reason}`);
      return { exitCode: 1 };
    }

    if (!args.environment) {
      logger.error('[ABORTED] Missing required target environment flag: --environment=staging or --environment=production.');
      return { exitCode: 1 };
    }

    if (args.environment !== 'staging' && args.environment !== 'production') {
      logger.error(`[ABORTED] Invalid --environment="${args.environment}". Expected "staging" or "production".`);
      return { exitCode: 1 };
    }

    if (!args.confirmDb) {
      logger.error('[ABORTED] Missing required target confirmation flag: --confirm-db=<expectedDatabaseName>.');
      return { exitCode: 1 };
    }

    if (!args.confirmHost) {
      logger.error('[ABORTED] Missing required target confirmation flag: --confirm-host=<expectedMongoHost>.');
      return { exitCode: 1 };
    }

    if (/[:/@\s]/.test(args.confirmHost)) {
      logger.error(
        `[ABORTED] Invalid --confirm-host="${args.confirmHost}". Specify hostname only (use --confirm-port for TCP port).`
      );
      return { exitCode: 1 };
    }

    if (args.confirmPort === null) {
      logger.error('[ABORTED] Missing required target confirmation flag: --confirm-port=<expectedMongoPort>.');
      return { exitCode: 1 };
    }

    const nodeEnv = typeof env.NODE_ENV === 'string' && env.NODE_ENV.trim() ? env.NODE_ENV.trim() : 'unset';
    const isTargetProduction = args.environment === 'production';
    const expectedHostLower = args.confirmHost.toLowerCase();
    const expectedPort = args.confirmPort;

    if (nodeEnv === 'production' && !isTargetProduction) {
      logger.error('[ABORTED] NODE_ENV=production conflicts with --environment=staging.');
      return { exitCode: 1 };
    }

    const prodHostAllowlist = parseHostAllowlist(env.QUICKR_PRODUCTION_MONGO_HOSTS);

    if (!isTargetProduction) {
      if (uriInfo.isSrv) {
        logger.error('[ABORTED] Staging migration strictly rejects MongoDB Atlas SRV (mongodb+srv://) connections.');
        return { exitCode: 1 };
      }

      if ([...uriInfo.hostnames].some((h) => isProductionLikeHostname(h, prodHostAllowlist))) {
        logger.error('[ABORTED] Staging migration rejects Atlas/production host in QUICKR_MIGRATION_MONGODB_URI.');
        return { exitCode: 1 };
      }

      if (
        uriInfo.hosts.length !== 1 ||
        uriInfo.hosts[0].host !== APPROVED_STAGING_TARGET.host ||
        uriInfo.hosts[0].port !== APPROVED_STAGING_TARGET.port ||
        uriInfo.dbName !== APPROVED_STAGING_TARGET.database
      ) {
        logger.error(
          `[ABORTED] Staging migration URI must target only ${APPROVED_STAGING_TARGET.host}:${APPROVED_STAGING_TARGET.port}/${APPROVED_STAGING_TARGET.database}.`
        );
        return { exitCode: 1 };
      }

      if (
        expectedHostLower !== APPROVED_STAGING_TARGET.host ||
        expectedPort !== APPROVED_STAGING_TARGET.port ||
        args.confirmDb !== APPROVED_STAGING_TARGET.database
      ) {
        logger.error(
          `[ABORTED] Staging migration rejects unapproved target parameters. Required: --confirm-host=${APPROVED_STAGING_TARGET.host} --confirm-port=${APPROVED_STAGING_TARGET.port} --confirm-db=${APPROVED_STAGING_TARGET.database}.`
        );
        return { exitCode: 1 };
      }
    } else {
      if (prodHostAllowlist.size === 0) {
        logger.error(
          '[ABORTED] Production target (--environment=production) requires non-empty QUICKR_PRODUCTION_MONGO_HOSTS allowlist (fail closed).'
        );
        return { exitCode: 1 };
      }

      if (!prodHostAllowlist.has(expectedHostLower)) {
        logger.error(
          `[ABORTED] Host "${args.confirmHost}" is NOT in configured QUICKR_PRODUCTION_MONGO_HOSTS allowlist for --environment=production.`
        );
        return { exitCode: 1 };
      }

      if (![...uriInfo.hostnames].every((h) => prodHostAllowlist.has(h))) {
        logger.error(
          '[ABORTED] QUICKR_MIGRATION_MONGODB_URI contains hostname not listed in QUICKR_PRODUCTION_MONGO_HOSTS allowlist.'
        );
        return { exitCode: 1 };
      }

      if (uriInfo.dbName && uriInfo.dbName !== args.confirmDb) {
        logger.error(
          `[ABORTED] QUICKR_MIGRATION_MONGODB_URI database "${uriInfo.dbName}" does not match --confirm-db="${args.confirmDb}".`
        );
        return { exitCode: 1 };
      }

      if (!args.isDryRun && !args.confirmProduction) {
        logger.error(
          '[ABORTED] Production apply mode (--environment=production without --dry-run) requires --confirm-production.'
        );
        return { exitCode: 1 };
      }
    }

    // CRITICAL SAFETY GUARD: Disable Mongoose autoIndex/autoCreate BEFORE connecting
    // so --dry-run (and pre-validation startup) NEVER touches indexes automatically.
    setMongooseFlagsFn();

    // Safely pass validated dedicated URI to connectDB() without touching application database.js defaults
    env.MONGODB_URI = rawMigrationUri;

    conn = await connectFn();
    if (!conn || !conn.connection) {
      logger.error('[ABORTED] Failed to establish MongoDB connection using QUICKR_MIGRATION_MONGODB_URI.');
      return { exitCode: 1 };
    }

    const hostInfo = extractActualHosts(conn);
    const actualDb = hostInfo.dbName;

    if (!actualDb || actualDb !== args.confirmDb) {
      logger.error(
        `[ABORTED] Database confirmation mismatch: expected "--confirm-db=${args.confirmDb}", connected to "${actualDb || 'unknown'}".`
      );
      return { exitCode: 1 };
    }

    if (hostInfo.allHosts.size === 0 || !hostInfo.allHosts.has(expectedHostLower)) {
      const actualDisplay = hostInfo.srvHost && hostInfo.srvHost !== hostInfo.primaryHost
        ? `${hostInfo.primaryHost} (srvHost=${hostInfo.srvHost})`
        : (hostInfo.primaryHost || 'unknown');
      logger.error(
        `[ABORTED] Host confirmation mismatch: expected "--confirm-host=${args.confirmHost}", connected to "${actualDisplay}".`
      );
      return { exitCode: 1 };
    }

    if (hostInfo.allPorts.size === 0 || !hostInfo.allPorts.has(expectedPort)) {
      const portDisplay = hostInfo.allPorts.size > 0 ? [...hostInfo.allPorts].join(',') : 'unknown';
      logger.error(
        `[ABORTED] Port confirmation mismatch: expected "--confirm-port=${expectedPort}", connected port "${portDisplay}".`
      );
      return { exitCode: 1 };
    }

    if (!isTargetProduction) {
      if (hostInfo.srvHost) {
        logger.error('[ABORTED] Connected cluster uses SRV host, which is forbidden in staging.');
        return { exitCode: 1 };
      }

      if (
        actualDb !== APPROVED_STAGING_TARGET.database ||
        hostInfo.allHosts.size !== 1 ||
        !hostInfo.allHosts.has(APPROVED_STAGING_TARGET.host) ||
        hostInfo.allPorts.size !== 1 ||
        !hostInfo.allPorts.has(APPROVED_STAGING_TARGET.port)
      ) {
        logger.error(
          `[ABORTED] Connected staging endpoint mismatch: expected ${APPROVED_STAGING_TARGET.host}:${APPROVED_STAGING_TARGET.port}/${APPROVED_STAGING_TARGET.database}.`
        );
        return { exitCode: 1 };
      }

      if ([...hostInfo.allHosts].some((h) => isProductionLikeHostname(h, prodHostAllowlist))) {
        logger.error(
          '[ABORTED] Connected cluster/host matches Atlas or QUICKR_PRODUCTION_MONGO_HOSTS and cannot be run with --environment=staging.'
        );
        return { exitCode: 1 };
      }
    } else {
      const matchesProdAllowlist = [...hostInfo.allHosts].some((h) => prodHostAllowlist.has(h));
      if (
        prodHostAllowlist.size === 0 ||
        !prodHostAllowlist.has(expectedHostLower) ||
        !matchesProdAllowlist ||
        (hostInfo.srvHost && !prodHostAllowlist.has(hostInfo.srvHost.toLowerCase()))
      ) {
        logger.error(
          '[ABORTED] Connected cluster/host does not match configured QUICKR_PRODUCTION_MONGO_HOSTS allowlist.'
        );
        return { exitCode: 1 };
      }
    }

    const modeLabel = args.isDryRun ? 'DRY_RUN' : 'APPLY';
    const prodConfirmStatus = isTargetProduction
      ? (args.isDryRun ? 'NOT_REQUIRED_DRY_RUN' : 'CONFIRMED')
      : 'NOT_APPLICABLE_STAGING';
    const allowlistStatus = isTargetProduction
      ? 'VERIFIED'
      : (prodHostAllowlist.size > 0 ? 'VERIFIED_LOCAL_STAGING' : 'LOCAL_STAGING_LOCKED');

    const hostDisplay = hostInfo.srvHost && hostInfo.srvHost.toLowerCase() !== hostInfo.primaryHost.toLowerCase()
      ? `${hostInfo.primaryHost} (SRV: ${hostInfo.srvHost})`
      : hostInfo.primaryHost;

    logger.log('\n=== QuickR Migration Target Identification Banner ===');
    logger.log(`  Sanitized Host      : ${hostDisplay}`);
    logger.log(`  Port                : ${expectedPort}`);
    logger.log(`  Database Name       : ${actualDb}`);
    logger.log(`  Target Environment  : ${args.environment}`);
    logger.log(`  NODE_ENV            : ${nodeEnv}`);
    logger.log(`  Migration Mode      : ${modeLabel}`);
    logger.log(`  Confirmation Status : DB=MATCHED (${actualDb}), HOST=MATCHED, PORT=${expectedPort}, ENV=${args.environment}, PRODUCTION=${prodConfirmStatus}, ALLOWLIST=${allowlistStatus}`);
    logger.log('====================================================\n');

    const result = await migrateFn({
      isDryRun: args.isDryRun,
      initCountersOnly: args.initCountersOnly,
      logger
    });
    return result;
  } catch (err) {
    const safeMsg = sanitizeMongoErrorText(err?.message || String(err), rawMigrationUri);
    logger.error(`[ABORTED] Migration failed: ${safeMsg}`);
    return { exitCode: 1 };
  } finally {
    if (hadOriginalMongoUri) {
      env.MONGODB_URI = originalMongoUri;
    } else {
      delete env.MONGODB_URI;
    }

    for (const key of addedEnvKeys) {
      delete env[key];
    }

    if (conn) {
      await Promise.resolve(disconnectFn()).catch(() => {});
    }
  }
}

async function main() {
  const result = await executeMigrationCli({ argv: process.argv.slice(2) });
  process.exit(typeof result?.exitCode === 'number' ? result.exitCode : 1);
}

const isCliEntrypoint =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isCliEntrypoint) {
  main();
}
