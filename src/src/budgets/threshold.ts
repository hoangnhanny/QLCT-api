/**
 * Evaluates which budget thresholds (80% or 100%) have been reached.
 * Returns an array containing 80 and/or 100 in ascending order.
 * - 80 is reached when spent * 100 >= limit * 80
 * - 100 is reached when spent >= limit (both [80, 100] are returned)
 */
export function reachedThresholds(
  spent: number,
  limit: number,
): (80 | 100)[] {
  if (limit <= 0) {
    return [];
  }

  const reached: (80 | 100)[] = [];

  // Integer arithmetic comparison to avoid float imprecision:
  // spent / limit >= 0.8  <=>  spent * 10 >= limit * 8
  if (spent * 10 >= limit * 8) {
    reached.push(80);
  }

  if (spent >= limit) {
    reached.push(100);
  }

  return reached;
}
