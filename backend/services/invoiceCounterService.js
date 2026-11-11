import { InvoiceCounter } from '../models/InvoiceCounter.js';
import { Sale } from '../models/Sale.js';

/**
 * Parses numeric suffix from canonical formatted invoice strings such as INV-000042.
 * Does NOT accept whitespace padding, zero/negative numbers, non-digits, or unsafe integers.
 */
export const extractInvoiceNumericValue = (invoiceNumber) => {
  if (typeof invoiceNumber !== 'string') return 0;
  const match = invoiceNumber.match(/^INV-(\d+)$/i);
  if (!match) return 0;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
};

/**
 * Formats integer sequence into QuickR's canonical invoice format: INV-000001.
 */
export const formatInvoiceNumber = (seq) => {
  const num = Number(seq);
  const safeSeq = Number.isSafeInteger(num) && num > 0 ? num : 1;
  return `INV-${String(safeSeq).padStart(6, '0')}`;
};

/**
 * Scans all historical Sale invoice numbers for a shop, computing the highest valid
 * canonical numeric INV sequence and explicitly reporting any missing or malformed values.
 */
export const analyzeShopInvoiceHistory = async (shopId) => {
  if (!shopId) {
    throw new Error('shopId is required to analyze invoice history');
  }

  const rows = await Sale.find({ shopId }).select('id invoiceNumber').lean();

  let maxSeq = 0;
  let validCount = 0;
  const malformed = [];

  for (const row of rows) {
    const raw = row?.invoiceNumber;
    const saleId = row?.id || String(row?._id || 'unknown');

    if (typeof raw !== 'string' || raw.trim() === '') {
      malformed.push({ saleId, invoiceNumber: raw ?? null, reason: 'MISSING_OR_EMPTY' });
      continue;
    }

    if (raw !== raw.trim()) {
      malformed.push({ saleId, invoiceNumber: raw, reason: 'WHITESPACE_PADDING' });
      continue;
    }

    const match = raw.match(/^INV-(\d+)$/i);
    if (!match) {
      malformed.push({
        saleId,
        invoiceNumber: raw,
        reason: /^INV-/i.test(raw) ? 'MALFORMED_INV_FORMAT' : 'NON_CANONICAL_PREFIX'
      });
      continue;
    }

    const parsed = Number.parseInt(match[1], 10);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      malformed.push({
        saleId,
        invoiceNumber: raw,
        reason: parsed <= 0 ? 'ZERO_OR_NEGATIVE_SEQUENCE' : 'INTEGER_OVERFLOW'
      });
      continue;
    }

    validCount++;
    if (parsed > maxSeq) maxSeq = parsed;
  }

  return {
    shopId,
    totalSales: rows.length,
    validCount,
    maxSeq,
    malformed
  };
};

/**
 * Finds the highest numeric INV-xxxxxx sequence already present in historical Sales for a shop.
 * Fails loudly if missing or malformed historical invoice numbers exist rather than silently
 * returning 0 (unless allowMalformed is explicitly enabled).
 * Never uses Sale.countDocuments(), which breaks if historical records have gaps or deletions.
 */
export const getMaxHistoricalInvoiceSeq = async (shopId, { allowMalformed = false } = {}) => {
  if (!shopId) return 0;
  const analysis = await analyzeShopInvoiceHistory(shopId);

  if (analysis.malformed.length > 0 && !allowMalformed) {
    const sample = analysis.malformed
      .slice(0, 5)
      .map((m) => `${m.saleId}:${JSON.stringify(m.invoiceNumber)}(${m.reason})`)
      .join(', ');
    throw new Error(
      `Refusing silent fallback for shop ${shopId}: detected ${analysis.malformed.length} missing or malformed invoiceNumber record(s) [${sample}]`
    );
  }

  return analysis.maxSeq;
};

/**
 * Detects duplicate (shopId, invoiceNumber) pairs across Sales without altering data.
 */
export const detectDuplicateInvoiceNumbers = async (shopId = null) => {
  const pipeline = [];
  if (shopId) {
    pipeline.push({ $match: { shopId: String(shopId) } });
  }
  pipeline.push(
    {
      $group: {
        _id: { shopId: '$shopId', invoiceNumber: '$invoiceNumber' },
        count: { $sum: 1 },
        saleIds: { $push: '$id' }
      }
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { '_id.shopId': 1, '_id.invoiceNumber': 1 } }
  );

  const duplicates = await Sale.aggregate(pipeline);
  return duplicates.map((d) => ({
    shopId: d._id.shopId,
    invoiceNumber: d._id.invoiceNumber,
    count: d.count,
    saleIds: d.saleIds
  }));
};

/**
 * Idempotently initializes or advances the shop counter to at least max historical INV number.
 * Uses MongoDB $max so an existing higher sequence can never be decreased.
 */
export const ensureInvoiceCounterInitialized = async (shopId, { maxHistoricalOverride = null } = {}) => {
  if (!shopId) throw new Error('shopId is required to initialize invoice counter');
  const maxHistorical =
    maxHistoricalOverride !== null ? maxHistoricalOverride : await getMaxHistoricalInvoiceSeq(shopId);

  try {
    return await InvoiceCounter.findOneAndUpdate(
      { shopId },
      { $max: { seq: maxHistorical } },
      { upsert: true, new: true }
    );
  } catch (err) {
    if (err?.code === 11000) {
      return await InvoiceCounter.findOneAndUpdate(
        { shopId },
        { $max: { seq: maxHistorical } },
        { new: true }
      );
    }
    throw err;
  }
};

/**
 * Allocates the next unique sequential invoice number for a shop using atomic MongoDB $inc.
 * If the shop's counter doc does not exist yet (e.g. brand-new or pre-migration shop), seeds
 * atomically with $setOnInsert from historical max before performing atomic $inc.
 */
export const allocateNextInvoiceNumber = async (shopId) => {
  if (!shopId) {
    throw new Error('shopId is required to allocate an invoice number');
  }

  let counterDoc = await InvoiceCounter.findOneAndUpdate(
    { shopId },
    { $inc: { seq: 1 } },
    { new: true }
  );

  if (!counterDoc) {
    const maxHistorical = await getMaxHistoricalInvoiceSeq(shopId);
    try {
      await InvoiceCounter.updateOne(
        { shopId },
        { $setOnInsert: { shopId, seq: maxHistorical } },
        { upsert: true }
      );
    } catch (err) {
      // Another concurrent first-time request created the counter row first
      if (err?.code !== 11000) {
        throw err;
      }
    }

    counterDoc = await InvoiceCounter.findOneAndUpdate(
      { shopId },
      { $inc: { seq: 1 } },
      { new: true }
    );
  }

  if (!counterDoc || !Number.isFinite(counterDoc.seq) || counterDoc.seq < 1) {
    throw new Error(`Failed to allocate atomic invoice counter for shop ${shopId}`);
  }

  return formatInvoiceNumber(counterDoc.seq);
};
