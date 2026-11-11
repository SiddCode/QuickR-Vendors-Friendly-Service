const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Returns the YYYY-MM-DD calendar date in Indian Standard Time (IST, UTC+05:30).
 */
export function getISTDateString(date: Date = new Date()): string {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  const year = ist.getUTCFullYear();
  const month = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const day = String(ist.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns startOfToday, endOfToday, startOfWeek, and startOfMonth Date objects aligned to IST (UTC+05:30).
 */
export function getISTDayBounds(baseDate: Date = new Date()): {
  startOfToday: Date;
  endOfToday: Date;
  startOfWeek: Date;
  startOfMonth: Date;
  istDateStr: string;
} {
  const ist = new Date(baseDate.getTime() + IST_OFFSET_MS);
  const year = ist.getUTCFullYear();
  const month = ist.getUTCMonth();
  const day = ist.getUTCDate();
  const dayOfWeek = ist.getUTCDay();
  const startOfToday = new Date(Date.UTC(year, month, day, 0, 0, 0, 0) - IST_OFFSET_MS);
  const endOfToday = new Date(Date.UTC(year, month, day, 23, 59, 59, 999) - IST_OFFSET_MS);
  const startOfWeek = new Date(Date.UTC(year, month, day - dayOfWeek, 0, 0, 0, 0) - IST_OFFSET_MS);
  const startOfMonth = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0) - IST_OFFSET_MS);
  return {
    startOfToday,
    endOfToday,
    startOfWeek,
    startOfMonth,
    istDateStr: getISTDateString(baseDate)
  };
}

/**
 * Adds whole calendar days in IST and returns the YYYY-MM-DD date string.
 */
export function addDaysIST(days: number, baseDate: Date = new Date()): string {
  return getISTDateString(new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000));
}

export function formatDateIST(dateVal?: string | Date | null): string {
  if (!dateVal) return 'N/A';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return 'N/A';
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata'
  });
}

export function formatTimeIST(dateVal?: string | Date | null): string {
  if (!dateVal) return '';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata'
  });
}

export function formatDateTimeIST(dateVal?: string | Date | null): string {
  if (!dateVal) return 'N/A';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return 'N/A';
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata'
  });
}

/**
 * Calculates a scheduled Date at 10:00 AM IST for relative labels ('Today', 'Tomorrow', '3 days', etc.) or YYYY-MM-DD strings.
 */
export function calculateFollowUpDateIST(input?: string | Date | null): Date {
  const istNow = new Date(Date.now() + IST_OFFSET_MS);
  let y = istNow.getUTCFullYear();
  let m = istNow.getUTCMonth();
  let d = istNow.getUTCDate();

  if (input instanceof Date && !isNaN(input.getTime())) {
    return input;
  }

  const normalized = typeof input === 'string' ? input.trim() : '';
  const lower = normalized.toLowerCase();

  let daysToAdd = 1;
  if (!normalized || lower === 'tomorrow' || lower === 'in 1 day') {
    daysToAdd = 1;
  } else if (lower === 'today') {
    daysToAdd = 0;
  } else if (lower === '3 days' || lower === 'in 3 days') {
    daysToAdd = 3;
  } else if (lower === '5 days' || lower === 'in 5 days') {
    daysToAdd = 5;
  } else if (lower === '7 days' || lower === '1 week' || lower === 'next week' || lower === 'in 1 week') {
    daysToAdd = 7;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const [yy, mm, dd] = normalized.split('-').map(Number);
    return new Date(Date.UTC(yy, mm - 1, dd, 10, 0, 0, 0) - IST_OFFSET_MS);
  } else {
    const parsed = new Date(normalized);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date(Date.UTC(y, m, d + daysToAdd, 10, 0, 0, 0) - IST_OFFSET_MS);
}
