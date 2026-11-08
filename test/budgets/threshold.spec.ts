import { reachedThresholds } from '../../src/budgets/threshold';

describe('reachedThresholds', () => {
  it('returns [] when spent is below 80% of limit', () => {
    expect(reachedThresholds(79, 100)).toEqual([]);
    expect(reachedThresholds(0, 100)).toEqual([]);
    expect(reachedThresholds(799, 1000)).toEqual([]);
  });

  it('returns [80] when spent is >= 80% and < 100%', () => {
    expect(reachedThresholds(80, 100)).toEqual([80]);
    expect(reachedThresholds(85, 100)).toEqual([80]);
    expect(reachedThresholds(99, 100)).toEqual([80]);
    expect(reachedThresholds(800, 1000)).toEqual([80]);
  });

  it('returns [80, 100] when spent is >= 100%', () => {
    expect(reachedThresholds(100, 100)).toEqual([80, 100]);
    expect(reachedThresholds(120, 100)).toEqual([80, 100]);
    expect(reachedThresholds(1000, 1000)).toEqual([80, 100]);
    expect(reachedThresholds(2000, 1000)).toEqual([80, 100]);
  });

  it('handles zero or negative limit safely by returning []', () => {
    expect(reachedThresholds(100, 0)).toEqual([]);
    expect(reachedThresholds(100, -50)).toEqual([]);
  });
});
