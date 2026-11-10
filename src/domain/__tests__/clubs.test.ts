import { clubStats, DEFAULT_BAG, percentile, suggestClub, trimmedMean } from '../clubs';
import type { Shot } from '../types';

const shot = (carry: number, extra: Partial<Shot> = {}): Shot => ({
  id: String(Math.random()),
  clubId: '7i',
  createdAt: '2026-01-01T00:00:00Z',
  source: 'manual',
  carryYards: carry,
  ...extra,
});

describe('stat helpers', () => {
  it('computes percentiles with interpolation', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([10, 20], 0.5)).toBe(15);
    expect(percentile([], 0.5)).toBeUndefined();
  });

  it('trims outliers from the mean', () => {
    const values = [100, 150, 151, 152, 153, 154, 155, 156, 157, 250];
    expect(trimmedMean(values, 0.1)).toBeCloseTo(153.5);
  });
});

describe('clubStats', () => {
  it('ignores mishits and reports stock carry, smash factor and spread', () => {
    const shots = [
      shot(150, { ballSpeedMph: 112, clubSpeedMph: 84 }),
      shot(155, { ballSpeedMph: 114, clubSpeedMph: 85 }),
      shot(152),
      shot(60, { mishit: true }),
    ];
    const s = clubStats(shots);
    expect(s.shotCount).toBe(4);
    expect(s.usedCount).toBe(3);
    expect(s.stockCarry).toBeCloseTo(152.3, 1);
    expect(s.smashFactor).toBeCloseTo(1.34, 2);
    expect(s.carrySpread).toBeGreaterThan(0);
    expect(s.carryRange?.[0]).toBeGreaterThanOrEqual(150);
  });

  it('handles a club with no shots', () => {
    const s = clubStats([]);
    expect(s.stockCarry).toBeUndefined();
    expect(s.smashFactor).toBeUndefined();
  });
});

describe('suggestClub', () => {
  const stats = {
    '7i': clubStats([shot(150)]),
    '8i': clubStats([shot(140)]),
    '9i': clubStats([shot(130)]),
  };

  it('picks the shortest club that reaches', () => {
    expect(suggestClub(135, DEFAULT_BAG, stats)?.id).toBe('8i');
    expect(suggestClub(140, DEFAULT_BAG, stats)?.id).toBe('8i');
  });

  it('falls back to the longest club when nothing reaches', () => {
    expect(suggestClub(200, DEFAULT_BAG, stats)?.id).toBe('7i');
  });

  it('returns undefined with no data', () => {
    expect(suggestClub(150, DEFAULT_BAG, {})).toBeUndefined();
  });
});
