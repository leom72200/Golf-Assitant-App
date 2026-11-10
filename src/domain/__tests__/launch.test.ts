import {
  airDensity,
  calibrateFromBall,
  calibrateFromReference,
  MPS_PER_MPH,
  measureLaunch,
  simulateFlight,
  typicalSpinForLoft,
} from '../launch';

describe('measureLaunch', () => {
  it('derives ball speed and launch angle from two frames', () => {
    // 1000 px per metre; ball moves 0.5 m along a 15° line in 2 frames at 240 fps.
    const cal = calibrateFromReference(1000, 1);
    const angle = (15 * Math.PI) / 180;
    const dist = 0.5 * 1000;
    const result = measureLaunch(
      { frame: 10, position: { x: 100, y: 800 } },
      { frame: 12, position: { x: 100 + dist * Math.cos(angle), y: 800 - dist * Math.sin(angle) } },
      240,
      cal,
    );
    const expectedMph = 0.5 / (2 / 240) / MPS_PER_MPH; // 60 m/s ≈ 134 mph
    expect(result.ballSpeedMph).toBeCloseTo(expectedMph, 5);
    expect(result.launchAngleDeg).toBeCloseTo(15, 5);
  });

  it('supports balls travelling right-to-left', () => {
    const r = measureLaunch(
      { frame: 0, position: { x: 500, y: 500 } },
      { frame: 1, position: { x: 400, y: 500 } },
      100,
      calibrateFromReference(100, 1),
      false,
    );
    expect(r.launchAngleDeg).toBeCloseTo(0);
    expect(r.ballSpeedMph).toBeCloseTo(100 / MPS_PER_MPH, 5);
  });

  it('calibrates from the ball diameter', () => {
    expect(calibrateFromBall(42.67).pixelsPerMeter).toBeCloseTo(1000);
  });

  it('rejects bad input', () => {
    const cal = calibrateFromBall(40);
    const p = { frame: 1, position: { x: 0, y: 0 } };
    expect(() => measureLaunch(p, p, 240, cal)).toThrow();
    expect(() => calibrateFromBall(0)).toThrow();
  });
});

describe('simulateFlight', () => {
  // Published tour-average launch conditions and carries (yards).
  const benchmarks: [string, number, number, number, number][] = [
    ['driver', 171, 10.4, 2545, 282],
    ['5 iron', 132, 12.1, 5361, 194],
    ['7 iron', 123, 16.1, 7124, 176],
    ['pitching wedge', 104, 23.7, 9311, 142],
  ];

  it.each(benchmarks)('%s carry is within 8%% of tour average', (_, speed, launch, spin, carry) => {
    const r = simulateFlight({ ballSpeedMph: speed, launchAngleDeg: launch, spinRpm: spin });
    expect(Math.abs(r.carryYards / carry - 1)).toBeLessThan(0.08);
    expect(r.totalYards).toBeGreaterThanOrEqual(r.carryYards);
    expect(r.apexYards).toBeGreaterThan(15);
  });

  it('flies further in thin air', () => {
    const base = { ballSpeedMph: 150, launchAngleDeg: 12, spinRpm: 3000 };
    const sea = simulateFlight(base);
    const denver = simulateFlight({ ...base, airDensity: airDensity(70, 5280) });
    expect(denver.carryYards).toBeGreaterThan(sea.carryYards * 1.04);
  });

  it('returns zeros for no ball speed', () => {
    expect(simulateFlight({ ballSpeedMph: 0, launchAngleDeg: 10, spinRpm: 0 }).carryYards).toBe(0);
  });
});

describe('typicalSpinForLoft', () => {
  it('increases with loft', () => {
    expect(typicalSpinForLoft(10)).toBeLessThan(typicalSpinForLoft(31));
    expect(typicalSpinForLoft(31)).toBeLessThan(typicalSpinForLoft(56));
    expect(typicalSpinForLoft(80)).toBe(typicalSpinForLoft(60));
  });
});
