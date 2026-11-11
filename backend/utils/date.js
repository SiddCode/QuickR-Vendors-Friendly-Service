/**
 * Centralized Indian Standard Time (IST = UTC + 05:30) Date Utility
 * Handles IST business day boundary calculation and date arithmetic cleanly.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Returns UTC Date objects representing 00:00:00.000 IST and 23:59:59.999 IST for today (or specified base date).
 */
export const getISTDayBounds = (baseDate = new Date()) => {
  const now = new Date(baseDate);
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);

  const istYear = istNow.getUTCFullYear();
  const istMonth = istNow.getUTCMonth();
  const istDate = istNow.getUTCDate();

  const startOfToday = new Date(Date.UTC(istYear, istMonth, istDate, 0, 0, 0, 0) - IST_OFFSET_MS);
  const endOfToday = new Date(Date.UTC(istYear, istMonth, istDate, 23, 59, 59, 999) - IST_OFFSET_MS);

  return {
    startOfToday,
    endOfToday,
    istYear,
    istMonth,
    istDate,
    istDateStr: `${istYear}-${String(istMonth + 1).padStart(2, '0')}-${String(istDate).padStart(2, '0')}`
  };
};

/**
 * Calculates scheduled follow-up Date based on option or string in IST.
 */
export const calculateScheduledDateIST = (followUpOptionOrDate, baseDate = new Date()) => {
  const now = new Date(baseDate);
  if (!followUpOptionOrDate) return now;
  if (followUpOptionOrDate instanceof Date) return followUpOptionOrDate;

  const rawStr = String(followUpOptionOrDate).trim();
  const str = rawStr.toLowerCase();

  if (str === 'today') {
    return now;
  }
  if (str === 'tomorrow') {
    return new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);
  }
  if (str === '3 days' || str === '3days' || str === '3_days') {
    return new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  }
  if (str === 'next week' || str === 'nextweek' || str === 'next_week') {
    return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  }

  // Parse explicit YYYY-MM-DD as 10:00 AM IST on that calendar date (avoiding UTC midnight server drift)
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rawStr);
  if (dateOnlyMatch) {
    const [, y, m, d] = dateOnlyMatch;
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 10, 0, 0, 0) - IST_OFFSET_MS);
  }

  // Parse timezone-less YYYY-MM-DDTHH:mm(:ss)? as IST
  const localIsoMatch = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(rawStr);
  if (localIsoMatch) {
    const [, y, m, d, hh, mm, ss = '0'] = localIsoMatch;
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss), 0) - IST_OFFSET_MS);
  }

  const parsed = new Date(rawStr);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  return now;
};
