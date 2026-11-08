import { monthKey, monthRange } from '../../src/common/month';

describe('month.ts (Asia/Ho_Chi_Minh UTC+7)', () => {
  describe('monthKey', () => {
    it('returns 2026-12-01 for 2026-11-30T17:30Z (00:30 UTC+7 on Dec 1st)', () => {
      const date = new Date('2026-11-30T17:30:00Z');
      expect(monthKey(date)).toBe('2026-12-01');
    });

    it('returns 2026-11-01 for 2026-11-30T16:59Z (23:59 UTC+7 on Nov 30th)', () => {
      const date = new Date('2026-11-30T16:59:00Z');
      expect(monthKey(date)).toBe('2026-11-01');
    });

    it('returns YYYY-MM-01 correctly at the beginning of a month', () => {
      const date = new Date('2026-05-01T00:00:00+07:00');
      expect(monthKey(date)).toBe('2026-05-01');
    });
  });

  describe('monthRange', () => {
    it('returns half-open interval in UTC for a month key', () => {
      const range = monthRange('2026-12-01');
      expect(range.from.toISOString()).toBe('2026-11-30T17:00:00.000Z');
      expect(range.to.toISOString()).toBe('2026-12-31T17:00:00.000Z');
    });

    it('handles year rollover (December to January)', () => {
      const range = monthRange('2026-12');
      expect(range.from.toISOString()).toBe('2026-11-30T17:00:00.000Z');
      expect(range.to.toISOString()).toBe('2026-12-31T17:00:00.000Z');
    });

    it('handles January correctly', () => {
      const range = monthRange('2027-01-01');
      expect(range.from.toISOString()).toBe('2026-12-31T17:00:00.000Z');
      expect(range.to.toISOString()).toBe('2027-01-31T17:00:00.000Z');
    });
  });
});
