import {
  airIndexAt,
  calibrateBehind,
  defaultShape,
  finishOffline,
  projectBehind,
  startAngleFromSighting,
  tracerFlight,
} from '../behindCamera';

const W = 1280;
const H = 720;
const ball = { x: 700, y: 620 };
const target = { x: 640, y: 300 };

describe('behind-the-player camera', () => {
  const cal = calibrateBehind(ball, target, W, H)!;

  it('calibrates to a believable camera position', () => {
    expect(cal).toBeDefined();
    expect(cal.backM).toBeGreaterThan(0.5);
    expect(cal.backM).toBeLessThan(6);
    expect(cal.sideM).toBeLessThan(0); // ball right of the target in the image => camera left of the line
  });

  it('projects the ball onto itself and far target-line points towards the target', () => {
    const p0 = projectBehind(cal, { d: 0, h: 0, l: 0 });
    expect(p0.x).toBeCloseTo(ball.x, 6);
    expect(p0.y).toBeCloseTo(ball.y, 6);
    const far = projectBehind(cal, { d: 5000, h: 0, l: 0 });
    expect(far.x).toBeCloseTo(target.x, 0);
    expect(far.y).toBeCloseTo(target.y, 0);
  });

  it('a flight rises above the horizon and lands near the target line', () => {
    const tf = tracerFlight(defaultShape(150, 31));
    const pts = tf.air.map((p) => projectBehind(cal, p));
    expect(Math.min(...pts.map((p) => p.y))).toBeLessThan(cal.horizonY);
    const land = pts[pts.length - 1];
    expect(land.y).toBeGreaterThan(cal.horizonY);
    expect(Math.abs(land.x - target.x)).toBeLessThan(40);
    expect(tf.flight.carryYards).toBeCloseTo(150, 0);
  });

  it('start line and curve move the ball sideways the right way', () => {
    const right = tracerFlight({ ...defaultShape(150), startDeg: 4 });
    const fade = tracerFlight({ ...defaultShape(150), curveYards: 15 });
    const draw = tracerFlight({ ...defaultShape(150), curveYards: -15 });
    expect(finishOffline(right)).toBeGreaterThan(8);
    expect(finishOffline(fade)).toBeGreaterThan(12);
    expect(finishOffline(draw)).toBeLessThan(-12);
  });

  it('recovers the start line from where the ball was first seen', () => {
    for (const startDeg of [-6, 0, 5]) {
      const shape = { ...defaultShape(160, 31), startDeg };
      const tf = tracerFlight(shape);
      // First sighting ~1/30 s after impact.
      const seen = projectBehind(cal, tf.air[1]);
      expect(startAngleFromSighting(cal, shape.launchDeg, seen)).toBeCloseTo(startDeg, 0);
    }
  });

  it('maps time to positions along the flight', () => {
    const tf = tracerFlight(defaultShape(150));
    expect(airIndexAt(tf, 0)).toBe(0);
    expect(airIndexAt(tf, 0.25)).toBeCloseTo(2.5);
    expect(airIndexAt(tf, 99)).toBe(tf.air.length - 1);
  });

  it('in portrait, a full iron and a driver stay inside the picture', () => {
    // Phone upright, ball near the bottom, horizon a little above the middle.
    const portrait = calibrateBehind({ x: 380, y: 1150 }, { x: 360, y: 560 }, 720, 1280)!;
    for (const [carry, loft] of [
      [165, 31],
      [235, 10.5],
      [100, 50],
    ]) {
      const pts = tracerFlight(defaultShape(carry, loft)).air.map((p) => projectBehind(portrait, p));
      expect(Math.min(...pts.map((p) => p.y))).toBeGreaterThan(0);
    }
  });

  it('refuses a calibration where the target is not above the ball', () => {
    expect(calibrateBehind({ x: 600, y: 300 }, { x: 640, y: 305 }, W, H)).toBeUndefined();
  });
});
