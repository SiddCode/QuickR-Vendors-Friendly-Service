import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDB } from '../config/database.js';
import { Shop } from '../models/Shop.js';
import { Sale } from '../models/Sale.js';
import { InvoiceCounter } from '../models/InvoiceCounter.js';
import {
  analyzeShopInvoiceHistory,
  detectDuplicateInvoiceNumbers,
  ensureInvoiceCounterInitialized
} from '../services/invoiceCounterService.js';

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

/**
 * Scrubs MongoDB connection strings and embedded credentials from log/error strings.
 */
export function sanitizeSensitiveText(input, knownSecretUri = '') {
  let out = typeof input === 'string' ? input : String(input || '');
  if (knownSecretUri && knownSecretUri.trim()) {
    out = out.split(knownSecretUri.trim()).join('[REDACTED_URI]');
  }
  return out
    .replace(/mongodb(?:\+srv)?:\/\/[^\s"'`]+/gi, 'mongodb***://[REDACTED_URI]')
    .replace(/([?&](?:password|pwd|authSource|replicaSet|tlsCAFile)=)[^&\s]+/gi, '$1[REDACTED]');
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

export function parseHostAllowlist(rawList) {
  if (typeof rawList !== 'string' || !rawList.trim()) return new Set();
  return new Set(
    rawList
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );
}

/**
 * Parses CLI flags cleanly (supports both --flag=value and --flag value forms).
 */
export function parseMigrationArgs(argv = []) {
  const args = {
    isDryRun: false,
    initCountersOnly: false,
    confirmProduction: false,
    environment: null,
    envFile: null,
    confirmDb: null,
    confirmHost: null
  };

  for (let i = 0; i < argv.length; i++) {
    const raw = String(argv[i] || '').trim();
    if (!raw) continue;

    if (raw === '--dry-run') {
      args.isDryRun = true;
      continue;
    }
    if (raw === '--init-counters-only') {
      args.initCountersOnly = true;
      continue;
    }
    if (raw === '--confirm-production') {
      args.confirmProduction = true;
      continue;
    }

    const envFlag = readFlagValue(argv, i, raw, 'environment');
    if (envFlag) {
      args.environment = envFlag.value;
      i = envFlag.nextIndex;
      continue;
    }

    const envFileFlag = readFlagValue(argv, i, raw, 'env-file');
    if (envFileFlag) {
      args.envFile = envFileFlag.value;
      i = envFileFlag.nextIndex;
      continue;
    }

    const dbFlag = readFlagValue(argv, i, raw, 'confirm-db');
    if (dbFlag) {
      args.confirmDb = dbFlag.value;
      i = dbFlag.nextIndex;
      continue;
    }

    const hostFlag = readFlagValue(argv, i, raw, 'confirm-host');
    if (hostFlag) {
      args.confirmHost = hostFlag.value;
      i = hostFlag.nextIndex;
      continue;
    }
  }

  return args;
}

/**
 * Extracts exact hostname strings exposed by the connected Mongoose/MongoDB client
 * (supports both standard single/replica-set hosts and resolved Atlas mongodb+srv hosts)
 * without ever using substring matching.
 */
export function extractActualHosts(conn) {
  const hostSet = new Set();
  const primaryHost = typeof conn?.connection?.host === 'string' ? conn.connection.host.trim() : '';
  if (primaryHost) hostSet.add(primaryHost.toLowerCase());

  const clientOpts = conn?.connection?.client?.s?.options;
  const srvHost = typeof clientOpts?.srvHost === 'string' ? clientOpts.srvHost.trim() : '';
  if (srvHost) hostSet.add(srvHost.toLowerCase());

  if (Array.isArray(clientOpts?.hosts)) {
    for (const h of clientOpts.hosts) {
      if (typeof h?.host === 'string' && h.host.trim()) {
        hostSet.add(h.host.trim().toLowerCase());
      }
    }
  }

  return {
    primaryHost: primaryHost || srvHost || '',
    srvHost,
    allHosts: hostSet
  };
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

function defaultLoadEnvFile(envFilePath) {
  const resolved = path.resolve(envFilePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Explicit --env-file path does not exist: ${envFilePath}`);
  }
  const res = dotenv.config({ path: resolved, override: false });
  if (res.error) {
    throw new Error(`Failed to load --env-file (${envFilePath}): ${res.error.message}`);
  }
}

/**
 * Full CLI/environment orchestrator enforcing dedicated QUICKR_MIGRATION_MONGODB_URI,
 * explicit --env-file (never implicit backend/.env), --environment=staging|production,
 * --confirm-db, --confirm-host, QUICKR_PRODUCTION_MONGO_HOSTS allowlist checks,
 * --confirm-production (for --environment=production apply), pre-operation banner,
 * credential-safe logging, and guaranteed connection cleanup before returning exit code.
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
  let rawMigrationUri = '';
  let conn = null;

  try {
    const args = parseMigrationArgs(argv);

    if (args.envFile) {
      loadEnvFn(args.envFile);
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

    if (!/^mongodb(\+srv)?:\/\/\S+/i.test(rawMigrationUri)) {
      logger.error(
        '[ABORTED] QUICKR_MIGRATION_MONGODB_URI must be a valid mongodb:// or mongodb+srv:// connection string.'
      );
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

    const nodeEnv = typeof env.NODE_ENV === 'string' && env.NODE_ENV.trim() ? env.NODE_ENV.trim() : 'unset';
    const isTargetProduction = args.environment === 'production';

    if (nodeEnv === 'production' && !isTargetProduction) {
      logger.error('[ABORTED] NODE_ENV=production conflicts with --environment=staging.');
      return { exitCode: 1 };
    }

    if (isTargetProduction && !args.isDryRun && !args.confirmProduction) {
      logger.error(
        '[ABORTED] Production apply mode (--environment=production without --dry-run) requires --confirm-production.'
      );
      return { exitCode: 1 };
    }

    const prodHostAllowlist = parseHostAllowlist(env.QUICKR_PRODUCTION_MONGO_HOSTS);
    const expectedHostLower = args.confirmHost.toLowerCase();

    if (prodHostAllowlist.size > 0) {
      if (!isTargetProduction && prodHostAllowlist.has(expectedHostLower)) {
        logger.error(
          `[ABORTED] Host "${args.confirmHost}" is listed in QUICKR_PRODUCTION_MONGO_HOSTS and cannot be targeted with --environment=staging.`
        );
        return { exitCode: 1 };
      }
      if (isTargetProduction && !prodHostAllowlist.has(expectedHostLower)) {
        logger.error(
          `[ABORTED] Host "${args.confirmHost}" is NOT in configured QUICKR_PRODUCTION_MONGO_HOSTS allowlist for --environment=production.`
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

    const actualDb = typeof conn.connection.name === 'string' ? conn.connection.name.trim() : '';
    const hostInfo = extractActualHosts(conn);

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

    if (prodHostAllowlist.size > 0) {
      const matchesProdAllowlist = [...hostInfo.allHosts].some((h) => prodHostAllowlist.has(h));
      if (!isTargetProduction && matchesProdAllowlist) {
        logger.error(
          '[ABORTED] Connected cluster/host matches QUICKR_PRODUCTION_MONGO_HOSTS and cannot be run with --environment=staging.'
        );
        return { exitCode: 1 };
      }
      if (isTargetProduction && !matchesProdAllowlist) {
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
    const allowlistStatus = prodHostAllowlist.size > 0 ? 'VERIFIED' : 'NOT_CONFIGURED';

    const hostDisplay = hostInfo.srvHost && hostInfo.srvHost.toLowerCase() !== hostInfo.primaryHost.toLowerCase()
      ? `${hostInfo.primaryHost} (SRV: ${hostInfo.srvHost})`
      : hostInfo.primaryHost;

    logger.log('\n=== QuickR Migration Target Identification Banner ===');
    logger.log(`  Sanitized Host      : ${hostDisplay}`);
    logger.log(`  Database Name       : ${actualDb}`);
    logger.log(`  Target Environment  : ${args.environment}`);
    logger.log(`  NODE_ENV            : ${nodeEnv}`);
    logger.log(`  Migration Mode      : ${modeLabel}`);
    logger.log(`  Confirmation Status : DB=MATCHED (${actualDb}), HOST=MATCHED, ENV=${args.environment}, PRODUCTION=${prodConfirmStatus}, ALLOWLIST=${allowlistStatus}`);
    logger.log('====================================================\n');

    const result = await migrateFn({
      isDryRun: args.isDryRun,
      initCountersOnly: args.initCountersOnly,
      logger
    });
    return result;
  } catch (err) {
    const safeMsg = sanitizeSensitiveText(err?.message || String(err), rawMigrationUri);
    logger.error(`Migration failed: ${safeMsg}`);
    return { exitCode: 1 };
  } finally {
    if (hadOriginalMongoUri) {
      env.MONGODB_URI = originalMongoUri;
    } else {
      delete env.MONGODB_URI;
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
