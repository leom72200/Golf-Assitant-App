/**
 * Rebuild a ball flight for any logged shot, so it can be replayed with a tracer:
 *  - with ball speed + launch: simulate it directly (spin from the shot, or typical for the loft);
 *  - with only a carry distance: find the ball speed that carries that far at a typical launch.
 */
import { simulateFlight, typicalSpinForLoft, type FlightResult } from './launch';
import type { Club, Shot } from './types';

/** Rough typical launch angle for an amateur strike by loft. */
export function typicalLaunchForLoft(loft: number): number {
  return Math.max(9, Math.min(40, 6 + loft * 0.48));
}

export function flightForShot(shot: Shot, club?: Pick<Club, 'loft'>): FlightResult | undefined {
  const loft = club?.loft ?? 31;
  const spinRpm = shot.spinRpm ?? typicalSpinForLoft(loft);
  if (shot.ballSpeedMph && shot.launchAngleDeg !== undefined) {
    const f = simulateFlight({ ballSpeedMph: shot.ballSpeedMph, launchAngleDeg: shot.launchAngleDeg, spinRpm });
    return withLogged(f, shot);
  }
  if (!shot.carryYards || shot.carryYards <= 0) return undefined;
  return withLogged(flightForCarry(shot.carryYards, typicalLaunchForLoft(loft), spinRpm), shot);
}

/** The simulated flight that carries `carryYards` at the given launch and spin. */
export function flightForCarry(carryYards: number, launchAngleDeg: number, spinRpm: number): FlightResult {
  // Carry rises monotonically with ball speed, so bisect.
  let lo = 10;
  let hi = 240;
  let best = simulateFlight({ ballSpeedMph: hi, launchAngleDeg, spinRpm });
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const f = simulateFlight({ ballSpeedMph: mid, launchAngleDeg, spinRpm });
    best = f;
    if (f.carryYards < carryYards) lo = mid;
    else hi = mid;
  }
  return best;
}

/** Prefer the distances the player actually logged, scaling the drawn path to match. */
function withLogged(f: FlightResult, shot: Shot): FlightResult {
  if (!shot.carryYards || f.carryYards <= 0) {
    return shot.totalYards ? { ...f, totalYards: Math.max(f.carryYards, shot.totalYards) } : f;
  }
  const k = shot.carryYards / f.carryYards;
  return {
    ...f,
    carryYards: shot.carryYards,
    totalYards: Math.max(shot.carryYards, shot.totalYards ?? f.totalYards * k),
    trajectory: f.trajectory.map((p) => ({ x: p.x * k, y: p.y })),
  };
}
