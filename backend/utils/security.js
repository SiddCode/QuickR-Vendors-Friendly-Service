import zlib from 'zlib';

/**
 * Escapes special RegExp metacharacters from untrusted user search strings
 * before building MongoDB $regex filters, preventing ReDoS and regex injection.
 */
export const escapeRegex = (input) => {
  if (typeof input !== 'string') return '';
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/**
 * Prevents spreadsheet formula injection (CSV / Excel DDE attacks)
 * when strings begin with formula triggers (=, +, -, @, \t, \r).
 */
export const sanitizeSpreadsheetCell = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  const str = String(value);
  if (/^\s*[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
};

/**
 * Validates that an incoming query/body parameter is a primitive string (guards against Mongo operator object injection).
 */
export const asSafeString = (val) => {
  return typeof val === 'string' ? val.trim() : '';
};

/**
 * Zero-dependency security headers middleware equivalent to baseline Helmet hardening.
 */
export const securityHeadersMiddleware = (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '0');
  next();
};

/**
 * Zero-dependency gzip compression middleware for JSON and UTF-8 text payloads >= 1 KB.
 * Preserves binary downloads (Excel/streams) untouched.
 */
export const compressionMiddleware = (req, res, next) => {
  const acceptEncoding = String(req.headers['accept-encoding'] || '');
  if (!acceptEncoding.includes('gzip') || req.method === 'HEAD') {
    return next();
  }

  const origJson = res.json.bind(res);
  res.json = (body) => {
    try {
      const jsonStr = JSON.stringify(body);
      if (!jsonStr || jsonStr.length < 1024 || res.headersSent) {
        return origJson(body);
      }
      zlib.gzip(Buffer.from(jsonStr, 'utf8'), (err, compressed) => {
        if (err || res.headersSent) {
          return origJson(body);
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Vary', 'Accept-Encoding');
        res.send(compressed);
      });
    } catch {
      return origJson(body);
    }
  };

  next();
};

/**
 * Memory-bounded sliding-window rate limiter factory (no external Redis dependency).
 */
export const createRateLimiter = ({ windowMs = 15 * 60 * 1000, maxRequests = 30, message = 'Too many requests. Please try again shortly.' } = {}) => {
  const hits = new Map();
  const MAX_TRACKED_KEYS = 10000;

  // Periodic cleanup of expired windows to prevent unbounded memory growth
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits.entries()) {
      if (now >= entry.resetAt) {
        hits.delete(key);
      }
    }
  }, Math.min(windowMs, 5 * 60 * 1000));
  if (cleanupTimer.unref) cleanupTimer.unref();

  return (req, res, next) => {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = (typeof forwarded === 'string' ? forwarded.split(',')[0] : req.socket?.remoteAddress || '127.0.0.1').trim();
    const key = `${ip}:${req.baseUrl || ''}${req.path || ''}`;
    const now = Date.now();

    let entry = hits.get(key);
    if (!entry || now >= entry.resetAt) {
      if (hits.size >= MAX_TRACKED_KEYS) {
        const oldestKey = hits.keys().next().value;
        if (oldestKey) hits.delete(oldestKey);
      }
      entry = { count: 1, resetAt: now + windowMs };
      hits.set(key, entry);
      return next();
    }

    entry.count += 1;
    if (entry.count > maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({
        success: false,
        error: message,
        retryAfterSeconds
      });
    }

    return next();
  };
};
