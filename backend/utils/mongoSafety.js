import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

export const APPROVED_STAGING_TARGET = Object.freeze({
  host: '127.0.0.1',
  port: 27018,
  database: 'quickr_staging'
});

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const RESERVED_OR_PROD_DB_NAMES = new Set(['sgs', 'prod', 'production', 'admin', 'local', 'config', 'test']);
const ATLAS_HOST_SUFFIXES = ['.mongodb.net', '.mongodb.com'];

/**
 * Scrubs MongoDB connection strings, embedded username:password credentials,
 * and authentication/TLS query parameters from diagnostic or error text while
 * preserving error codes and non-secret connection diagnostics (e.g. host:port).
 */
export function sanitizeMongoErrorText(input, knownSecretUri = '') {
  let out = typeof input === 'string' ? input : String(input || '');

  if (knownSecretUri && typeof knownSecretUri === 'string' && knownSecretUri.trim()) {
    const trimmed = knownSecretUri.trim();
    out = out.split(trimmed).join('[REDACTED_URI]');
    try {
      const decoded = decodeURIComponent(trimmed);
      if (decoded && decoded !== trimmed) {
        out = out.split(decoded).join('[REDACTED_URI]');
      }
    } catch {
      // Ignore malformed percent-encoding in raw input
    }
  }

  return out
    .replace(/mongodb(?:\+srv)?:\/\/[^\s"'`<>]+/gi, 'mongodb***://[REDACTED_URI]')
    .replace(
      /(^|[\s"'`([<{])([^:\s/@"'`()<>]+):([^@\s/"'`()<>]+)@([a-z0-9.-]+(?::\d+)?)/gi,
      '$1[REDACTED_CREDENTIALS]@$4'
    )
    .replace(
      /(^|[\s?&;,])((?:password|pwd|user|username|authSource|authMechanism|authMechanismProperties|gssapiServiceName|tlsCertificateKeyFilePassword|tlsCertificateKeyFile|tlsCAFile|replicaSet)=)[^&\s"'`<>]+/gi,
      '$1$2[REDACTED]'
    );
}

/**
 * Parses a MongoDB URI into sanitized structural components without exposing
 * credentials or relying on Node URL (which rejects comma-separated replica hosts).
 */
export function parseMongoUriInfo(rawUri) {
  if (typeof rawUri !== 'string' || !rawUri.trim()) {
    return { valid: false, reason: 'Connection URI is empty or not a string.' };
  }

  const trimmed = rawUri.trim();
  if (/\s/.test(trimmed)) {
    return { valid: false, reason: 'Connection URI must not contain whitespace.' };
  }

  const schemeMatch = trimmed.match(/^(mongodb(?:\+srv)?):\/\//i);
  if (!schemeMatch) {
    return { valid: false, reason: 'Connection URI must start with mongodb:// or mongodb+srv://.' };
  }

  const isSrv = schemeMatch[1].toLowerCase() === 'mongodb+srv';
  const afterScheme = trimmed.slice(schemeMatch[0].length);
  const slashIdx = afterScheme.indexOf('/');
  const queryIdx = afterScheme.indexOf('?');

  let authorityEnd = afterScheme.length;
  if (slashIdx >= 0 && queryIdx >= 0) {
    authorityEnd = Math.min(slashIdx, queryIdx);
  } else if (slashIdx >= 0) {
    authorityEnd = slashIdx;
  } else if (queryIdx >= 0) {
    authorityEnd = queryIdx;
  }

  const authority = afterScheme.slice(0, authorityEnd);
  const pathAndQuery = slashIdx >= 0 ? afterScheme.slice(slashIdx + 1) : '';
  const atIdx = authority.lastIndexOf('@');
  const hasCredentials = atIdx >= 0;
  const hostListRaw = (atIdx >= 0 ? authority.slice(atIdx + 1) : authority).trim();

  if (!hostListRaw) {
    return { valid: false, reason: 'Connection URI is missing host information.' };
  }

  const hosts = [];
  const hostnames = new Set();
  const ports = new Set();

  for (const token of hostListRaw.split(',')) {
    const part = token.trim();
    if (!part) {
      return { valid: false, reason: 'Connection URI contains an empty host entry.' };
    }

    let host = '';
    let port = isSrv ? null : 27017;

    if (part.startsWith('[')) {
      const closeIdx = part.indexOf(']');
      if (closeIdx < 0) {
        return { valid: false, reason: 'Connection URI contains malformed IPv6 host.' };
      }
      host = part.slice(1, closeIdx).trim().toLowerCase();
      const rest = part.slice(closeIdx + 1);
      if (rest) {
        if (!rest.startsWith(':') || !/^\d+$/.test(rest.slice(1))) {
          return { valid: false, reason: 'Connection URI contains malformed port.' };
        }
        if (isSrv) {
          return { valid: false, reason: 'mongodb+srv:// URIs cannot specify an explicit port.' };
        }
        port = Number.parseInt(rest.slice(1), 10);
      }
    } else {
      const colonIdx = part.lastIndexOf(':');
      if (colonIdx >= 0) {
        if (isSrv) {
          return { valid: false, reason: 'mongodb+srv:// URIs cannot specify an explicit port.' };
        }
        const portStr = part.slice(colonIdx + 1);
        if (!/^\d+$/.test(portStr)) {
          return { valid: false, reason: 'Connection URI contains a non-numeric port.' };
        }
        host = part.slice(0, colonIdx).trim().toLowerCase();
        port = Number.parseInt(portStr, 10);
      } else {
        host = part.toLowerCase();
      }
    }

    if (!host) {
      return { valid: false, reason: 'Connection URI contains an empty hostname.' };
    }
    if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      return { valid: false, reason: `Connection URI port "${port}" is out of valid range (1-65535).` };
    }

    hosts.push({ host, port });
    hostnames.add(host);
    if (port !== null) {
      ports.add(port);
    }
  }

  const rawDbSegment = pathAndQuery.split('?')[0].trim();
  let dbName = '';
  if (rawDbSegment) {
    try {
      dbName = decodeURIComponent(rawDbSegment).trim();
    } catch {
      dbName = rawDbSegment;
    }
  }

  return {
    valid: true,
    uri: trimmed,
    isSrv,
    hasCredentials,
    hosts,
    hostnames,
    ports,
    dbName
  };
}

/**
 * Parses comma-separated exact production hostnames (rejects wildcards, schemes, paths, or ports).
 */
export function parseHostAllowlist(rawList) {
  if (rawList == null) return new Set();
  if (typeof rawList !== 'string') {
    throw new Error('QUICKR_PRODUCTION_MONGO_HOSTS must be a comma-separated string of exact hostnames.');
  }
  const trimmed = rawList.trim();
  if (!trimmed) return new Set();

  const result = new Set();
  for (const item of trimmed.split(',')) {
    const host = item.trim().toLowerCase();
    if (!host) continue;
    if (
      host.includes('*') ||
      host.includes('://') ||
      host.includes('/') ||
      host.includes(':') ||
      /\s/.test(host)
    ) {
      throw new Error(
        `Invalid QUICKR_PRODUCTION_MONGO_HOSTS entry "${item.trim()}". Provide exact hostnames only (no wildcards, protocols, paths, or ports).`
      );
    }
    result.add(host);
  }
  return result;
}

/**
 * Extracts exact hostnames, ports, SRV hostname, and DB name from Mongoose connection metadata.
 */
export function extractActualConnectionMetadata(conn) {
  const allHosts = new Set();
  const allPorts = new Set();

  const primaryHost = typeof conn?.connection?.host === 'string' ? conn.connection.host.trim() : '';
  if (primaryHost) allHosts.add(primaryHost.toLowerCase());

  const rawPrimaryPort = conn?.connection?.port;
  const primaryPort =
    Number.isInteger(rawPrimaryPort) && rawPrimaryPort >= 1 && rawPrimaryPort <= 65535
      ? rawPrimaryPort
      : null;
  if (primaryPort !== null) allPorts.add(primaryPort);

  const clientOpts = conn?.connection?.client?.s?.options;
  const srvHost = typeof clientOpts?.srvHost === 'string' ? clientOpts.srvHost.trim() : '';
  if (srvHost) allHosts.add(srvHost.toLowerCase());

  if (Array.isArray(clientOpts?.hosts)) {
    for (const h of clientOpts.hosts) {
      if (typeof h?.host === 'string' && h.host.trim()) {
        allHosts.add(h.host.trim().toLowerCase());
      }
      if (Number.isInteger(h?.port) && h.port >= 1 && h.port <= 65535) {
        allPorts.add(h.port);
      }
    }
  }

  const dbName = typeof conn?.connection?.name === 'string' ? conn.connection.name.trim() : '';

  return {
    primaryHost: primaryHost || srvHost || '',
    primaryPort,
    srvHost,
    allHosts,
    allPorts,
    dbName
  };
}

export function isLoopbackHostname(host) {
  return typeof host === 'string' && LOOPBACK_HOSTS.has(host.trim().toLowerCase());
}

export function isProductionLikeHostname(host, prodAllowlist = new Set()) {
  if (typeof host !== 'string' || !host.trim()) return false;
  const lower = host.trim().toLowerCase();
  if (prodAllowlist.has(lower)) return true;
  return ATLAS_HOST_SUFFIXES.some((suffix) => lower === suffix.slice(1) || lower.endsWith(suffix));
}

export function isProtectedProductionDbName(dbName) {
  if (typeof dbName !== 'string' || !dbName.trim()) return false;
  const lower = dbName.trim().toLowerCase();
  return lower === 'sgs' || lower === 'prod' || lower === 'production';
}

function parseStrictTestArgs(argv = [], { requireWipeConfirmation = false } = {}) {
  const parsed = {
    confirmTestEnv: false,
    confirmWipeTestData: false,
    confirmDb: null,
    confirmHost: null,
    confirmPort: null,
    sawLegacyGenericConfirm: false
  };

  for (let i = 0; i < argv.length; i++) {
    const raw = String(argv[i] || '').trim();
    if (!raw) continue;

    if (raw === '--confirm' || raw.startsWith('--confirm=')) {
      parsed.sawLegacyGenericConfirm = true;
      throw new Error(
        'Generic --confirm flag is forbidden. Use explicit --confirm-test-env and --confirm-db=<isolatedDbName>.'
      );
    }

    if (raw === '--confirm-test-env') {
      parsed.confirmTestEnv = true;
      continue;
    }

    if (raw === '--confirm-wipe-test-data') {
      if (!requireWipeConfirmation) {
        throw new Error('Unexpected flag "--confirm-wipe-test-data" for this script.');
      }
      parsed.confirmWipeTestData = true;
      continue;
    }

    const matchValueFlag = (name) => {
      const prefix = `--${name}=`;
      if (raw.startsWith(prefix)) {
        const val = raw.slice(prefix.length).trim();
        if (!val) throw new Error(`--${name} requires a non-empty value.`);
        return { value: val, consumedNext: false };
      }
      if (raw === `--${name}`) {
        const next = argv[i + 1];
        if (!next || String(next).startsWith('--') || !String(next).trim()) {
          throw new Error(`--${name} requires a non-empty value.`);
        }
        return { value: String(next).trim(), consumedNext: true };
      }
      return null;
    };

    const dbFlag = matchValueFlag('confirm-db');
    if (dbFlag) {
      if (parsed.confirmDb !== null) throw new Error('Duplicate --confirm-db flag.');
      parsed.confirmDb = dbFlag.value;
      if (dbFlag.consumedNext) i++;
      continue;
    }

    const hostFlag = matchValueFlag('confirm-host');
    if (hostFlag) {
      if (parsed.confirmHost !== null) throw new Error('Duplicate --confirm-host flag.');
      parsed.confirmHost = hostFlag.value;
      if (hostFlag.consumedNext) i++;
      continue;
    }

    const portFlag = matchValueFlag('confirm-port');
    if (portFlag) {
      if (parsed.confirmPort !== null) throw new Error('Duplicate --confirm-port flag.');
      if (!/^\d+$/.test(portFlag.value)) {
        throw new Error(`Invalid --confirm-port="${portFlag.value}". Expected integer port.`);
      }
      const p = Number.parseInt(portFlag.value, 10);
      if (p < 1 || p > 65535) {
        throw new Error(`Invalid --confirm-port="${portFlag.value}". Valid port range is 1-65535.`);
      }
      parsed.confirmPort = p;
      if (portFlag.consumedNext) i++;
      continue;
    }

    throw new Error(`Unknown or disallowed CLI argument: "${raw}".`);
  }

  return parsed;
}

/**
 * Inspects a .env file read-only without modifying process.env, failing closed if
 * it defines production overrides that an imported module's dotenv.config() could pick up.
 */
export function inspectEnvFileForProductionOverrides(envFilePath, prodAllowlist = new Set()) {
  if (!envFilePath || !fs.existsSync(envFilePath)) {
    return { exists: false, safe: true };
  }
  const raw = fs.readFileSync(envFilePath, 'utf8');
  const parsed = dotenv.parse(raw);

  if ((parsed.NODE_ENV || '').trim().toLowerCase() === 'production') {
    return {
      exists: true,
      safe: false,
      reason: `Refusing execution: ${path.basename(envFilePath)} sets NODE_ENV=production.`
    };
  }

  for (const key of ['MONGODB_URI', 'MONGO_URI', 'QUICKR_MIGRATION_MONGODB_URI']) {
    const val = (parsed[key] || '').trim();
    if (!val) continue;
    const info = parseMongoUriInfo(val);
    if (!info.valid) continue;
    if (info.isSrv || [...info.hostnames].some((h) => isProductionLikeHostname(h, prodAllowlist))) {
      return {
        exists: true,
        safe: false,
        reason: `Refusing execution: ${path.basename(envFilePath)} contains a remote/Atlas/production host in ${key}.`
      };
    }
    if (isProtectedProductionDbName(info.dbName)) {
      return {
        exists: true,
        safe: false,
        reason: `Refusing execution: ${path.basename(envFilePath)} targets protected production database "${info.dbName}" in ${key}.`
      };
    }
  }

  return { exists: true, safe: true };
}

/**
 * Fail-closed guard for destructive or index-modifying DB test/cleanup scripts.
 * Never connects automatically, never consumes backend/.env MONGODB_URI overrides,
 * rejects NODE_ENV=production and Atlas/production hosts, and requires explicit
 * isolated test DB selection + confirmation flags.
 */
export function assertSafeTestDatabaseConfig({
  scriptName = 'test-script',
  argv = [],
  env = process.env,
  suggestedTestDb = 'quickr_test',
  backendEnvPath = null,
  requireWipeConfirmation = false,
  disallowSharedDevDb = true,
  allowStagingDbIfConfirmed = true,
  checkBackendEnvFile = true
} = {}) {
  if ((env.NODE_ENV || '').trim().toLowerCase() === 'production') {
    throw new Error(`[ABORTED] ${scriptName} cannot run when NODE_ENV=production.`);
  }

  const prodAllowlist = parseHostAllowlist(env.QUICKR_PRODUCTION_MONGO_HOSTS || '');

  if (checkBackendEnvFile) {
    const candidateEnvPath = backendEnvPath || path.resolve(process.cwd(), '.env');
    const envCheck = inspectEnvFileForProductionOverrides(candidateEnvPath, prodAllowlist);
    if (!envCheck.safe) {
      throw new Error(`[ABORTED] ${scriptName}: ${envCheck.reason}`);
    }
  }

  const flags = parseStrictTestArgs(argv, { requireWipeConfirmation });

  const rawTestUri = typeof env.TEST_MONGODB_URI === 'string' ? env.TEST_MONGODB_URI.trim() : '';
  if (!rawTestUri) {
    const sampleFlags = requireWipeConfirmation
      ? `--confirm-test-env --confirm-db=${suggestedTestDb} --confirm-host=127.0.0.1 --confirm-port=27017 --confirm-wipe-test-data`
      : `--confirm-test-env --confirm-db=${suggestedTestDb}`;
    throw new Error(
      `[ABORTED] ${scriptName} requires explicit isolated TEST_MONGODB_URI (never falls back to MONGODB_URI, MONGO_URI, backend/.env, or shared quickr DB). Example local test command flags: TEST_MONGODB_URI=mongodb://127.0.0.1:27017/${suggestedTestDb} ... ${sampleFlags}`
    );
  }

  const uriInfo = parseMongoUriInfo(rawTestUri);
  if (!uriInfo.valid) {
    throw new Error(`[ABORTED] ${scriptName} invalid TEST_MONGODB_URI: ${uriInfo.reason}`);
  }

  if (uriInfo.isSrv) {
    throw new Error(`[ABORTED] ${scriptName} rejects mongodb+srv:// URIs (Atlas/cloud clusters are strictly forbidden).`);
  }

  for (const host of uriInfo.hostnames) {
    if (isProductionLikeHostname(host, prodAllowlist)) {
      throw new Error(`[ABORTED] ${scriptName} rejects production/Atlas host "${host}".`);
    }
    if (!isLoopbackHostname(host)) {
      throw new Error(
        `[ABORTED] ${scriptName} restricts destructive test/cleanup scripts to loopback hosts (127.0.0.1, localhost, ::1); got "${host}".`
      );
    }
  }

  if (!uriInfo.dbName) {
    throw new Error(
      `[ABORTED] ${scriptName} requires an explicit isolated database name in TEST_MONGODB_URI (e.g. /${suggestedTestDb}).`
    );
  }

  const dbLower = uriInfo.dbName.toLowerCase();
  if (RESERVED_OR_PROD_DB_NAMES.has(dbLower)) {
    throw new Error(
      `[ABORTED] ${scriptName} refuses protected or reserved database "${uriInfo.dbName}".`
    );
  }

  if (disallowSharedDevDb && dbLower === 'quickr') {
    throw new Error(
      `[ABORTED] ${scriptName} refuses shared local application database "quickr". Use an isolated test database such as "${suggestedTestDb}".`
    );
  }

  if (!allowStagingDbIfConfirmed && dbLower === APPROVED_STAGING_TARGET.database) {
    throw new Error(
      `[ABORTED] ${scriptName} cannot target "${APPROVED_STAGING_TARGET.database}".`
    );
  }

  if (!flags.confirmTestEnv) {
    throw new Error(
      `[ABORTED] ${scriptName} requires explicit --confirm-test-env flag.`
    );
  }

  if (!flags.confirmDb || flags.confirmDb !== uriInfo.dbName) {
    throw new Error(
      `[ABORTED] ${scriptName} requires --confirm-db=${uriInfo.dbName} matching the isolated database in TEST_MONGODB_URI.`
    );
  }

  if (requireWipeConfirmation) {
    if (!flags.confirmWipeTestData) {
      throw new Error(
        `[ABORTED] ${scriptName} requires explicit --confirm-wipe-test-data flag.`
      );
    }
    const uriPrimaryHost = uriInfo.hosts[0].host;
    const uriPrimaryPort = uriInfo.hosts[0].port;
    if (!flags.confirmHost || flags.confirmHost.toLowerCase() !== uriPrimaryHost) {
      throw new Error(
        `[ABORTED] ${scriptName} requires --confirm-host=${uriPrimaryHost} matching TEST_MONGODB_URI.`
      );
    }
    if (flags.confirmPort === null || flags.confirmPort !== uriPrimaryPort) {
      throw new Error(
        `[ABORTED] ${scriptName} requires --confirm-port=${uriPrimaryPort} matching TEST_MONGODB_URI.`
      );
    }
  }

  return {
    uri: uriInfo.uri,
    expectedHosts: uriInfo.hostnames,
    expectedPorts: uriInfo.ports,
    expectedDbName: uriInfo.dbName,
    prodAllowlist
  };
}

/**
 * Post-connect and pre-syncIndexes() guard verifying the active Mongoose connection
 * actually landed on the verified loopback isolated test DB and never on production.
 */
export function assertSafeConnectedTestTarget(conn, expectedTarget, { env = process.env, operation = 'test execution' } = {}) {
  if ((env.NODE_ENV || '').trim().toLowerCase() === 'production') {
    throw new Error(`[ABORTED] Refusing ${operation} when NODE_ENV=production.`);
  }

  const meta = extractActualConnectionMetadata(conn);
  if (meta.srvHost) {
    throw new Error(`[ABORTED] Refusing ${operation} on SRV/Atlas connection (${meta.srvHost}).`);
  }

  if (meta.allHosts.size === 0) {
    throw new Error(`[ABORTED] Refusing ${operation}: unable to determine connected MongoDB host.`);
  }

  const prodAllowlist = expectedTarget?.prodAllowlist || parseHostAllowlist(env.QUICKR_PRODUCTION_MONGO_HOSTS || '');

  for (const h of meta.allHosts) {
    if (isProductionLikeHostname(h, prodAllowlist) || !isLoopbackHostname(h)) {
      throw new Error(`[ABORTED] Refusing ${operation} on disallowed or production host "${h}".`);
    }
    if (expectedTarget?.expectedHosts && !expectedTarget.expectedHosts.has(h)) {
      throw new Error(`[ABORTED] Refusing ${operation}: connected host "${h}" does not match expected test host.`);
    }
  }

  if (expectedTarget?.expectedPorts?.size > 0) {
    const portMatched = [...meta.allPorts].some((p) => expectedTarget.expectedPorts.has(p));
    if (!portMatched) {
      throw new Error(
        `[ABORTED] Refusing ${operation}: connected port does not match expected test port.`
      );
    }
  }

  if (!meta.dbName || isProtectedProductionDbName(meta.dbName) || RESERVED_OR_PROD_DB_NAMES.has(meta.dbName.toLowerCase())) {
    throw new Error(`[ABORTED] Refusing ${operation} on protected database "${meta.dbName || 'unknown'}".`);
  }

  if (expectedTarget?.expectedDbName && meta.dbName !== expectedTarget.expectedDbName) {
    throw new Error(
      `[ABORTED] Refusing ${operation}: connected DB "${meta.dbName}" != confirmed "${expectedTarget.expectedDbName}".`
    );
  }

  return meta;
}
