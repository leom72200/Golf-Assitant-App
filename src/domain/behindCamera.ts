/**
 * Geometry for the Shot Tracer, filmed from BEHIND the player looking down the fairway.
 *
 * Calibration needs two taps on a frame of the video: the ball, and the target far down the
 * fairway. The target sits (almost) on the horizon and marks where the target line vanishes;
 * with the phone's typical field of view and an assumed camera height, that fixes a simple
 * pinhole camera. The simulated flight (carry, height, start line, curve) is then projected
 * into the real video so the tracer follows the true perspective of the shot.
 */
import type { FlightResult } from './launch';
import { typicalSpinForLoft } from './launch';
import { flightForCarry, typicalLaunchForLoft } from './shotFlight';
import type { Point2, Point3 } from './tracerProjection';

const M_PER_YD = 0.9144;

export interface BehindCalibration {
  imageW: number;
  imageH: number;
  ball: Point2;
  target: Point2;
  /** Focal length in image pixels. */
  f: number;
  camHeightM: number;
  /** Camera distance behind the ball along the target line (m). */
  backM: number;
  /** Camera offset sideways from the target line (m, + right). */
  sideM: number;
  horizonY: number;
}

export interface CalibrationOptions {
  /** Field of view across the image's long side. Phone main cameras are ~70–75°. */
  hfovDeg?: number;
  /** Phone height above the ground (tripod / held at chest ≈ 1.2 m). */
  camHeightM?: number;
}

export function calibrateBehind(
  ball: Point2,
  target: Point2,
  imageW: number,
  imageH: number,
  opts: CalibrationOptions = {},
): BehindCalibration | undefined {
  const hfov = ((opts.hfovDeg ?? 72) * Math.PI) / 180;
  const camHeightM = opts.camHeightM ?? 1.2;
  const horizonY = target.y;
  const drop = ball.y - horizonY;
  // The ball must be clearly below the target in the picture.
  if (drop < imageH * 0.03) return undefined;
  const f = Math.max(imageW, imageH) / 2 / Math.tan(hfov / 2);
  const backM = (f * camHeightM) / drop;
  const sideM = (-(ball.x - target.x) * backM) / f;
  return { imageW, imageH, ball, target, f, camHeightM, backM, sideM, horizonY };
}

/** Project a point of the flight (yards: d downrange, h height, l lateral + right) into the image. */
export function projectBehind(cal: BehindCalibration, p: Point3): Point2 {
  const z = Math.max(0.3, p.d * M_PER_YD + cal.backM);
  return {
    x: cal.target.x + (cal.f * (p.l * M_PER_YD - cal.sideM)) / z,
    y: cal.horizonY - (cal.f * (p.h * M_PER_YD - cal.camHeightM)) / z,
  };
}

export interface TracerShape {
  carryYards: number;
  launchDeg: number;
  spinRpm: number;
  /** Start line in degrees, + right of target. */
  startDeg: number;
  /** Extra sideways movement by landing (yards): + curves right (fade/slice for a right-hander). */
  curveYards: number;
}

/** A sensible starting shape for a club with the given stock carry and loft. */
export function defaultShape(carryYards: number, loft = 31): TracerShape {
  return {
    carryYards,
    launchDeg: typicalLaunchForLoft(loft),
    spinRpm: typicalSpinForLoft(loft),
    startDeg: 0,
    curveYards: 0,
  };
}

export interface TracerFlight {
  flight: FlightResult;
  /** Ball positions every `dt` seconds through the air, ending at the landing spot. */
  air: Point3[];
  roll: Point3[];
  dt: number;
}

export function tracerFlight(shape: TracerShape): TracerFlight {
  const flight = flightForCarry(shape.carryYards, shape.launchDeg, shape.spinRpm);
  const carry = Math.max(1, flight.carryYards);
  const tanStart = Math.tan((shape.startDeg * Math.PI) / 180);
  const lateral = (d: number) => d * tanStart + shape.curveYards * Math.min(1, d / carry) ** 2;
  const air = flight.trajectory.map((p) => ({ d: p.x, h: Math.max(0, p.y), l: lateral(p.x) }));
  // Roll out along the direction the ball was travelling when it landed.
  const end = air[air.length - 1];
  const before = air[Math.max(0, air.length - 3)];
  const len = Math.hypot(end.d - before.d, end.l - before.l) || 1;
  const rollYards = Math.max(0, flight.totalYards - flight.carryYards);
  const roll: Point3[] = [];
  for (let i = 1; i <= 6; i++) {
    const k = (rollYards * i) / 6 / len;
    roll.push({ d: end.d + (end.d - before.d) * k, h: 0, l: end.l + (end.l - before.l) * k });
  }
  return { flight, air, roll, dt: 0.1 };
}

/** Where the ball is (index into `air`, fractional) `t` seconds after impact. */
export function airIndexAt(tf: TracerFlight, t: number): number {
  const n = tf.air.length;
  if (t <= 0) return 0;
  // Samples are every dt except the final landing point, which comes at the full flight time.
  const lastGrid = n - 2;
  if (t >= tf.flight.flightTimeSec) return n - 1;
  const idx = t / tf.dt;
  if (idx <= lastGrid) return idx;
  const tLastGrid = lastGrid * tf.dt;
  return lastGrid + (t - tLastGrid) / Math.max(1e-6, tf.flight.flightTimeSec - tLastGrid);
}

/**
 * Start line (degrees) that best explains where the ball was first seen after impact, for a
 * given launch angle. Only the direction of travel in the image is used, not the distance.
 */
export function startAngleFromSighting(cal: BehindCalibration, launchDeg: number, seen: Point2): number {
  const observed = Math.atan2(seen.y - cal.ball.y, seen.x - cal.ball.x);
  const th = (launchDeg * Math.PI) / 180;
  let best = 0;
  let bestErr = Infinity;
  for (let deg = -30; deg <= 30; deg += 0.25) {
    const ph = (deg * Math.PI) / 180;
    const r = 3; // yards along the launch direction
    const p = projectBehind(cal, { d: r * Math.cos(th) * Math.cos(ph), h: r * Math.sin(th), l: r * Math.cos(th) * Math.sin(ph) });
    const a = Math.atan2(p.y - cal.ball.y, p.x - cal.ball.x);
    const err = Math.abs(Math.atan2(Math.sin(a - observed), Math.cos(a - observed)));
    if (err < bestErr) {
      bestErr = err;
      best = deg;
    }
  }
  return best;
}

/** Offline distance (yards, + right) where the ball finished, for saving the shot. */
export function finishOffline(tf: TracerFlight): number {
  const end = tf.roll[tf.roll.length - 1] ?? tf.air[tf.air.length - 1];
  return Math.round(end.l);
}
