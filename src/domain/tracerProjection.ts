/**
 * Geometry for drawing shot tracers.
 *
 *  - Down-the-line view (like TV): a virtual camera behind and above the golfer looks down the
 *    target line; the simulated flight is projected with a simple pinhole camera and the view
 *    auto-fits so a towering wedge and a long drive both stay on screen.
 *  - Camera view: the ball's measured path over a real frame, extended to the frame edge.
 */
import type { FlightResult } from './launch';

export interface Point2 {
  x: number;
  y: number;
}

/** Yards: d downrange, h height, l lateral (+ right of target). */
export interface Point3 {
  d: number;
  h: number;
  l: number;
}

/** Ball positions over time (flight samples are evenly spaced in time), then the roll-out. */
export function flightPath3d(flight: FlightResult, offlineYards = 0): { air: Point3[]; roll: Point3[] } {
  const carry = Math.max(1, flight.carryYards);
  // Without side-spin data, assume the ball curves progressively to where it finished offline.
  const lateral = (d: number) => offlineYards * Math.min(1, Math.max(0, d / carry)) ** 2;
  const air = flight.trajectory.map((p) => ({ d: p.x, h: Math.max(0, p.y), l: lateral(p.x) }));
  const end = air[air.length - 1] ?? { d: 0, h: 0, l: 0 };
  const rollLen = Math.max(0, flight.totalYards - flight.carryYards);
  const roll: Point3[] = [];
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    const d = end.d + (rollLen * i) / steps;
    roll.push({ d, h: 0, l: end.l + (offlineYards * 0.15 * rollLen * i) / steps / carry });
  }
  return { air, roll };
}

export interface DownTheLineView {
  width: number;
  height: number;
  horizonY: number;
  project: (p: Point3) => Point2;
}

/**
 * A camera behind the ball at about eye height, slightly to one side, fitted so the ball starts
 * near the bottom of the view and the apex reaches near the top: like a range tracer camera.
 */
export function downTheLineView(points: Point3[], width: number, height: number): DownTheLineView {
  const camHeight = 2; // yards above the ground
  const horizonY = height * 0.42;
  const ballY = height * 0.88;
  const top = height * 0.1;
  const ballOffsetX = width * 0.14; // ball sits right of centre; far points converge to the middle

  // For a given distance behind the ball: the focal length that puts the ball at `ballY`,
  // and whether the flight then fits inside the top and sides.
  const fitFor = (camBack: number) => {
    const f = ((ballY - horizonY) * camBack) / camHeight;
    const camL = (-ballOffsetX * camBack) / f;
    let fits = true;
    for (const p of points) {
      const z = p.d + camBack;
      const y = horizonY - (f * (p.h - camHeight)) / z;
      const x = width / 2 + (f * (p.l - camL)) / z;
      if (y < top || x < width * 0.04 || x > width * 0.96) {
        fits = false;
        break;
      }
    }
    return { f, camL, fits };
  };
  // With an eye-level camera, a close camera keeps a high flight on screen (the ball starts just
  // below the lens while the apex is far away). Move back while the flight still fits: the
  // furthest fitting camera has the most natural perspective, with the apex near the top.
  let camBack = 2;
  let fit = fitFor(camBack);
  for (let c = 3; c <= 80; c++) {
    const candidate = fitFor(c);
    if (!candidate.fits) break;
    camBack = c;
    fit = candidate;
  }
  if (!fit.fits) {
    // Extreme shot: shrink the view until it fits.
    let scale = 1;
    while (!fit.fits && scale > 0.1) {
      scale *= 0.9;
      const base = fitFor(camBack);
      fit = { ...base, f: base.f * scale, camL: base.camL / scale, fits: true };
      for (const p of points) {
        const z = p.d + camBack;
        const y = horizonY - (fit.f * (p.h - camHeight)) / z;
        if (y < top) fit.fits = false;
      }
    }
  }
  const { f, camL } = fit;
  const project = (p: Point3): Point2 => {
    const z = Math.max(0.5, p.d + camBack);
    return { x: width / 2 + (f * (p.l - camL)) / z, y: horizonY - (f * (p.h - camHeight)) / z };
  };
  return { width, height, horizonY, project };
}

/** The point where a ray from `p` with velocity (vx, vy) leaves a w×h frame. */
export function extendToEdge(p: Point2, vx: number, vy: number, w: number, h: number): Point2 {
  const ts: number[] = [];
  if (vx > 0) ts.push((w - p.x) / vx);
  if (vx < 0) ts.push(-p.x / vx);
  if (vy > 0) ts.push((h - p.y) / vy);
  if (vy < 0) ts.push(-p.y / vy);
  const t = Math.max(0, Math.min(...ts.filter((v) => v >= 0), Infinity));
  if (!Number.isFinite(t)) return p;
  return { x: p.x + vx * t, y: p.y + vy * t };
}

/** Point a fraction `t` (0..1) of the way along a polyline, by index (time), with the drawn part. */
export function partialPolyline(points: Point2[], t: number): Point2[] {
  if (points.length === 0) return [];
  const clamped = Math.max(0, Math.min(1, t));
  const pos = clamped * (points.length - 1);
  const i = Math.floor(pos);
  const out = points.slice(0, i + 1);
  if (i < points.length - 1) {
    const a = points[i];
    const b = points[i + 1];
    const f = pos - i;
    out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  }
  return out;
}

export const toSvgPoints = (pts: Point2[]) => pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
