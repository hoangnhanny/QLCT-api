const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Returns the `YYYY-MM-01` key representing the Asia/Ho_Chi_Minh (UTC+7)
 * calendar month for the given date instant.
 */
export function monthKey(date: Date): string {
  const vnTime = new Date(date.getTime() + VN_OFFSET_MS);
  const year = vnTime.getUTCFullYear();
  const month = String(vnTime.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

/**
 * Given a month key (`YYYY-MM-01` or `YYYY-MM`), returns the half-open
 * `[from, to)` Date instant interval matching 00:00:00 of the 1st of that month
 * up to 00:00:00 of the 1st of the next month in Asia/Ho_Chi_Minh (UTC+7).
 */
export function monthRange(key: string): { from: Date; to: Date } {
  const match = key.match(/^(\d{4})-(\d{2})/);
  if (!match) {
    throw new Error(
      `Invalid month key format: "${key}". Expected YYYY-MM or YYYY-MM-01`,
    );
  }
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);

  const fromMs = Date.UTC(year, month - 1, 1, 0, 0, 0) - VN_OFFSET_MS;
  const toMs = Date.UTC(year, month, 1, 0, 0, 0) - VN_OFFSET_MS;

  return {
    from: new Date(fromMs),
    to: new Date(toMs),
  };
}
