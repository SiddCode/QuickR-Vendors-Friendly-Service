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

  const str = String(followUpOptionOrDate).trim().toLowerCase();

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

  const parsed = new Date(followUpOptionOrDate);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  return now;
};
