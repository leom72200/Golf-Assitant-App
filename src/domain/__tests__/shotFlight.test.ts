import { flightForShot } from '../shotFlight';
import type { Shot } from '../types';

const base: Shot = { id: 's', clubId: '7i', createdAt: '', source: 'manual' };

describe('flightForShot', () => {
  it('simulates from launch data', () => {
    const f = flightForShot({ ...base, ballSpeedMph: 120, launchAngleDeg: 17 }, { loft: 31 })!;
    expect(f.carryYards).toBeGreaterThan(150);
    expect(f.trajectory.length).toBeGreaterThan(10);
  });

  it('builds a flight that matches a carry-only shot', () => {
    const f = flightForShot({ ...base, carryYards: 150, totalYards: 158 }, { loft: 31 })!;
    expect(f.carryYards).toBe(150);
    expect(f.totalYards).toBe(158);
    const end = f.trajectory[f.trajectory.length - 1];
    expect(end.x).toBeCloseTo(150, 0);
    expect(Math.max(...f.trajectory.map((p) => p.y))).toBeGreaterThan(15);
  });

  it('returns nothing without distance or launch data', () => {
    expect(flightForShot(base)).toBeUndefined();
  });
});
