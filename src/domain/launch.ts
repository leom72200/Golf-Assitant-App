/**
 * "Sim sensor" maths: turn what a phone camera can see into launch-monitor style numbers.
 *
 * Measuring from video:
 *   The camera films face-on (perpendicular to the target line). The ball's position is
 *   marked in two frames after impact. Knowing the frame rate gives the time between them,
 *   and a calibration (pixels per metre at the ball's distance) turns pixels into metres.
 *   That yields ball speed and vertical launch angle. Spin can't be read reliably from
 *   ordinary phone video, so it falls back to a typical value for the club's loft.
 *
 * Ball flight:
 *   A 2D point-mass simulation with gravity, aerodynamic drag and Magnus lift from backspin.
 *   Coefficients are simple approximations fitted to published tour-average launch data
 *   (driver through pitching wedge); carries come out within ~7% of those averages.
 *   Treat output as an estimate, not a measurement.
 */

export const BALL_DIAMETER_M = 0.04267;
const BALL_RADIUS_M = BALL_DIAMETER_M / 2;
const BALL_MASS_KG = 0.04593;
const BALL_AREA_M2 = Math.PI * BALL_RADIUS_M ** 2;
const GRAVITY = 9.81;
const SEA_LEVEL_AIR_DENSITY = 1.225;

export const MPS_PER_MPH = 0.44704;
const YARDS_PER_M = 1 / 0.9144;

export interface PixelPoint {
  x: number;
  /** Image y grows downwards, as in every image/video coordinate system. */
  y: number;
}

export interface BallObservation {
  frame: number;
  position: PixelPoint;
}

export interface Calibration {
  /** Pixels per metre in the plane the ball travels through. */
  pixelsPerMeter: number;
}

/** Calibrate from the ball itself: measure its diameter in pixels at address. */
export function calibrateFromBall(ballDiameterPx: number): Calibration {
  if (!(ballDiameterPx > 0)) throw new Error('Ball diameter must be positive');
  return { pixelsPerMeter: ballDiameterPx / BALL_DIAMETER_M };
}

/** Calibrate from any reference of known length in the ball's plane (e.g. an alignment stick). */
export function calibrateFromReference(lengthPx: number, lengthMeters: number): Calibration {
  if (!(lengthPx > 0) || !(lengthMeters > 0)) throw new Error('Reference lengths must be positive');
  return { pixelsPerMeter: lengthPx / lengthMeters };
}

export interface MeasuredLaunch {
  ballSpeedMph: number;
  launchAngleDeg: number;
}

/**
 * Ball speed and launch angle from two observations of the ball after impact.
 * `facingRight` should be true when the ball travels towards +x in the image.
 */
export function measureLaunch(
  a: BallObservation,
  b: BallObservation,
  fps: number,
  calibration: Calibration,
  facingRight = true,
): MeasuredLaunch {
  const frames = b.frame - a.frame;
  if (frames <= 0) throw new Error('Second observation must come after the first');
  if (!(fps > 0)) throw new Error('Frame rate must be positive');
  return measureLaunchOverTime(a.position, b.position, frames / fps, calibration, facingRight);
}

/**
 * Same as `measureLaunch`, but from the real time elapsed between the two positions.
 * Useful for slow-motion clips whose file timestamps are stretched: divide the playback time
 * between the marks by the slow-motion factor to get `elapsedSec`.
 */
export function measureLaunchOverTime(
  a: PixelPoint,
  b: PixelPoint,
  elapsedSec: number,
  calibration: Calibration,
  facingRight = true,
): MeasuredLaunch {
  if (!(elapsedSec > 0)) throw new Error('Second observation must come after the first');
  const dxPx = (b.x - a.x) * (facingRight ? 1 : -1);
  const dyPx = a.y - b.y; // flip so "up" is positive
  const distM = Math.hypot(dxPx, dyPx) / calibration.pixelsPerMeter;
  return {
    ballSpeedMph: distM / elapsedSec / MPS_PER_MPH,
    launchAngleDeg: (Math.atan2(dyPx, dxPx) * 180) / Math.PI,
  };
}

/**
 * The fastest ball speed a recording can capture: the ball must still be in frame in at
 * least two consecutive frames. `fieldOfViewMeters` is the width the camera sees at the ball.
 */
export function maxMeasurableSpeedMph(fps: number, fieldOfViewMeters: number): number {
  // Ball must move at most ~half the frame between frames to be seen twice.
  return ((fieldOfViewMeters / 2) * fps) / MPS_PER_MPH;
}

/** Rough typical backspin (rpm) for an amateur strike with a club of the given loft. */
export function typicalSpinForLoft(loftDeg: number): number {
  const table: [number, number][] = [
    [9, 2600],
    [12, 3000],
    [15, 3600],
    [18, 4200],
    [22, 4600],
    [24, 5000],
    [27, 5600],
    [31, 6500],
    [35, 7400],
    [39, 8200],
    [44, 8800],
    [50, 9400],
    [56, 9900],
    [60, 10200],
  ];
  if (loftDeg <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [l1, s1] = table[i];
    const [l0, s0] = table[i - 1];
    if (loftDeg <= l1) return Math.round(s0 + ((s1 - s0) * (loftDeg - l0)) / (l1 - l0));
  }
  return table[table.length - 1][1];
}

/** Typical smash factor (ball speed / club speed) for a solid strike, by loft. */
export function typicalSmashForLoft(loftDeg: number): number {
  if (loftDeg <= 12) return 1.48;
  if (loftDeg <= 20) return 1.45;
  if (loftDeg <= 28) return 1.4;
  if (loftDeg <= 36) return 1.33;
  if (loftDeg <= 46) return 1.25;
  return 1.18;
}

export interface FlightInput {
  ballSpeedMph: number;
  launchAngleDeg: number;
  spinRpm: number;
  /** Air density in kg/m³. Lower at altitude / in heat, so the ball flies further. */
  airDensity?: number;
}

export interface FlightResult {
  carryYards: number;
  /** Estimated carry + roll on a firm-ish fairway. */
  totalYards: number;
  apexYards: number;
  /** Angle the ball lands at, in degrees below horizontal. */
  descentAngleDeg: number;
  flightTimeSec: number;
  /** Trajectory samples (x downrange, y height) in yards, for drawing. */
  trajectory: { x: number; y: number }[];
}

function dragCoefficient(spinFactor: number): number {
  return 0.24 + 0.2 * spinFactor;
}

function liftCoefficient(spinFactor: number): number {
  // Rises with spin factor and saturates, as in wind-tunnel data for dimpled balls.
  return Math.min(0.3, 0.7 * Math.pow(spinFactor, 0.6));
}

/** Simulate ball flight until it returns to ground level. */
export function simulateFlight(input: FlightInput): FlightResult {
  const rho = input.airDensity ?? SEA_LEVEL_AIR_DENSITY;
  const k = (0.5 * rho * BALL_AREA_M2) / BALL_MASS_KG;
  const launch = (input.launchAngleDeg * Math.PI) / 180;
  let vx = input.ballSpeedMph * MPS_PER_MPH * Math.cos(launch);
  let vy = input.ballSpeedMph * MPS_PER_MPH * Math.sin(launch);
  let omega = (Math.max(0, input.spinRpm) * 2 * Math.PI) / 60; // rad/s
  let x = 0;
  let y = 0;
  let t = 0;
  let apex = 0;
  const dt = 0.005;
  const trajectory: { x: number; y: number }[] = [{ x: 0, y: 0 }];

  if (input.ballSpeedMph <= 0) {
    return { carryYards: 0, totalYards: 0, apexYards: 0, descentAngleDeg: 0, flightTimeSec: 0, trajectory };
  }

  while (t < 20) {
    const v = Math.hypot(vx, vy);
    const s = (omega * BALL_RADIUS_M) / Math.max(v, 1e-6);
    const cd = dragCoefficient(s);
    const cl = liftCoefficient(s);
    // Drag opposes velocity; lift is perpendicular to it (rotated +90° for backspin).
    const ax = -k * v * (cd * vx + cl * vy);
    const ay = -k * v * (cd * vy - cl * vx) - GRAVITY;
    const nx = x + vx * dt;
    const ny = y + vy * dt;
    if (ny < 0 && t > 0) {
      // Interpolate the exact landing point.
      const f = y / (y - ny);
      x += vx * dt * f;
      t += dt * f;
      y = 0;
      break;
    }
    x = nx;
    y = ny;
    vx += ax * dt;
    vy += ay * dt;
    t += dt;
    omega *= 1 - 0.04 * dt; // spin decays roughly 4% per second
    apex = Math.max(apex, y);
    if (Math.round(t / dt) % 20 === 0) trajectory.push({ x: x * YARDS_PER_M, y: y * YARDS_PER_M });
  }
  trajectory.push({ x: x * YARDS_PER_M, y: 0 });

  const descent = (Math.atan2(-vy, vx) * 180) / Math.PI;
  const carryYards = x * YARDS_PER_M;
  // Steep landings stop quickly; shallow ones release.
  const rollFraction = Math.min(0.2, Math.max(0.01, 0.35 - 0.0065 * descent));
  return {
    carryYards: Math.round(carryYards * 10) / 10,
    totalYards: Math.round(carryYards * (1 + rollFraction) * 10) / 10,
    apexYards: Math.round(apex * YARDS_PER_M * 10) / 10,
    descentAngleDeg: Math.round(descent * 10) / 10,
    flightTimeSec: Math.round(t * 100) / 100,
    trajectory,
  };
}

/** Air density from temperature (°F) and altitude (ft), ignoring humidity. */
export function airDensity(tempF: number, altitudeFt: number): number {
  const tempK = ((tempF - 32) * 5) / 9 + 273.15;
  const altitudeM = altitudeFt * 0.3048;
  const pressure = 101_325 * Math.pow(1 - 2.25577e-5 * altitudeM, 5.25588);
  return pressure / (287.05 * tempK);
}
