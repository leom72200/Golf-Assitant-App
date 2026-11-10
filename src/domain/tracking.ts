/**
 * Automatic ball tracking for the camera practice mode.
 *
 * Works on small grayscale frames (luma 0-255) cut from a 240 fps side-on clip:
 *
 *  1. `locateBall` finds the ball at address near a point (a tap, or where it was last shot)
 *     and measures its radius, which calibrates pixels -> metres (a ball is 42.67 mm wide).
 *  2. `ballPresence` tells whether the ball is still sitting at address, so a coarse scan
 *     can find roughly when it was hit.
 *  3. `findCandidates` finds "new bright things" in each frame after impact: pixels brighter
 *     than both the previous frame and a pre-impact reference. A white ball flying across
 *     the frame shows up; a slowly rotating golfer mostly doesn't.
 *  4. `fitTrack` picks the set of candidates that move in a straight line at constant speed
 *     (RANSAC), which is how a ball moves over the ~30 ms it's in view, and least-squares fits it.
 *
 * Everything here is pure and synchronous so it can be unit tested without a phone.
 */
import { BALL_DIAMETER_M, MPS_PER_MPH } from './launch';

export interface GrayFrame {
  width: number;
  height: number;
  /** Row-major luma, one byte per pixel. */
  data: Uint8Array;
}

export interface Point {
  x: number;
  y: number;
}

export interface BallFix extends Point {
  radius: number;
  /** Mean luma inside the ball. */
  ballLuma: number;
  /** Mean luma of a ring just outside the ball. */
  surroundLuma: number;
}

export interface Blob {
  area: number;
  cx: number;
  cy: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Otsu's method: the threshold that best separates a histogram into two classes. */
export function otsuThreshold(values: ArrayLike<number>): number {
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < values.length; i++) hist[values[i] | 0]++;
  const total = values.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/** 4-connected components of a binary mask, keeping those within the area limits. */
export function connectedComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  minArea = 1,
  maxArea = Infinity,
): Blob[] {
  // Hot loop: plain indexed code with a fixed-size stack, no per-pixel allocations.
  const seen = new Uint8Array(mask.length);
  const blobs: Blob[] = [];
  const stack = new Int32Array(mask.length);
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let area = 0;
    let sx = 0;
    let sy = 0;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top > 0) {
      const i = stack[--top];
      const x = i % width;
      const y = (i - x) / width;
      area++;
      sx += x;
      sy += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && mask[i - 1] && !seen[i - 1]) {
        seen[i - 1] = 1;
        stack[top++] = i - 1;
      }
      if (x < width - 1 && mask[i + 1] && !seen[i + 1]) {
        seen[i + 1] = 1;
        stack[top++] = i + 1;
      }
      if (y > 0 && mask[i - width] && !seen[i - width]) {
        seen[i - width] = 1;
        stack[top++] = i - width;
      }
      if (y < height - 1 && mask[i + width] && !seen[i + width]) {
        seen[i + width] = 1;
        stack[top++] = i + width;
      }
    }
    if (area >= minArea && area <= maxArea) {
      blobs.push({ area, cx: sx / area, cy: sy / area, minX, maxX, minY, maxY });
    }
  }
  return blobs;
}

/** Mean luma of pixels whose distance from (cx, cy) is within [r0, r1). */
function ringMean(f: GrayFrame, cx: number, cy: number, r0: number, r1: number): number {
  let sum = 0;
  let n = 0;
  const x0 = Math.max(0, Math.floor(cx - r1));
  const x1 = Math.min(f.width - 1, Math.ceil(cx + r1));
  const y0 = Math.max(0, Math.floor(cy - r1));
  const y1 = Math.min(f.height - 1, Math.ceil(cy + r1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d >= r0 && d < r1) {
        sum += f.data[y * f.width + x];
        n++;
      }
    }
  }
  return n ? sum / n : 0;
}

/**
 * Find the ball near `near`: the brightest roughly-round blob within `searchRadius` pixels.
 * Returns undefined if nothing ball-like is there.
 */
export function locateBall(
  f: GrayFrame,
  near: Point,
  searchRadius: number,
  opts: { minRadius?: number; maxRadius?: number } = {},
): BallFix | undefined {
  const minR = opts.minRadius ?? 3;
  const maxR = opts.maxRadius ?? searchRadius;
  const x0 = clamp(Math.floor(near.x - searchRadius), 0, f.width - 1);
  const x1 = clamp(Math.ceil(near.x + searchRadius), 0, f.width - 1);
  const y0 = clamp(Math.floor(near.y - searchRadius), 0, f.height - 1);
  const y1 = clamp(Math.ceil(near.y + searchRadius), 0, f.height - 1);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  if (w < 3 || h < 3) return undefined;

  const window = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) window[y * w + x] = f.data[(y + y0) * f.width + (x + x0)];
  }
  // The ball is the bright class; Otsu splits it from grass/mat. Nudge up so mid-greys don't join.
  const t = otsuThreshold(window);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < window.length; i++) mask[i] = window[i] > t ? 1 : 0;

  const blobs = connectedComponents(mask, w, h, Math.PI * minR * minR * 0.6, Math.PI * maxR * maxR * 1.3);
  let best: { blob: Blob; score: number } | undefined;
  for (const b of blobs) {
    const bw = b.maxX - b.minX + 1;
    const bh = b.maxY - b.minY + 1;
    const aspect = bw / bh;
    const fill = b.area / (bw * bh); // π/4 ≈ 0.785 for a disc
    if (aspect < 0.6 || aspect > 1.67 || fill < 0.55) continue;
    const dist = Math.hypot(b.cx + x0 - near.x, b.cy + y0 - near.y);
    // Prefer round blobs close to where we looked.
    const score = dist + Math.abs(fill - 0.785) * 40;
    if (!best || score < best.score) best = { blob: b, score };
  }
  if (!best) return undefined;

  const cx = best.blob.cx + x0;
  const cy = best.blob.cy + y0;
  const rough = Math.sqrt(best.blob.area / Math.PI);
  const ballLuma = ringMean(f, cx, cy, 0, rough * 0.7);
  const surroundLuma = ringMean(f, cx, cy, rough * 1.6, rough * 2.4);
  const contrast = ballLuma - surroundLuma;
  if (contrast < 15) return undefined; // not bright enough to be a ball

  // Sub-pixel size: edge pixels count for the fraction of the ball they cover, judged by how
  // far their brightness is between the surroundings and the ball. Calibration (and so ball
  // speed) is directly proportional to this radius, so it's worth getting right.
  let covered = 0;
  const reach = rough * 1.4;
  for (let y = Math.max(0, Math.floor(cy - reach)); y <= Math.min(f.height - 1, Math.ceil(cy + reach)); y++) {
    for (let x = Math.max(0, Math.floor(cx - reach)); x <= Math.min(f.width - 1, Math.ceil(cx + reach)); x++) {
      if (Math.hypot(x - cx, y - cy) > reach) continue;
      covered += clamp((f.data[y * f.width + x] - surroundLuma) / contrast, 0, 1);
    }
  }
  const radius = Math.sqrt(covered / Math.PI);
  return { x: cx, y: cy, radius, ballLuma, surroundLuma };
}

/**
 * How much the ball still looks present at its address position: ~1 when it's there,
 * ~0 (or negative) once it's gone. Compares the ball-vs-surround contrast with setup.
 */
export function ballPresence(f: GrayFrame, ball: BallFix): number {
  const inner = ringMean(f, ball.x, ball.y, 0, ball.radius * 0.7);
  const outer = ringMean(f, ball.x, ball.y, ball.radius * 1.6, ball.radius * 2.4);
  const setupContrast = Math.max(1, ball.ballLuma - ball.surroundLuma);
  return (inner - outer) / setupContrast;
}

export interface CandidateOptions {
  /** Expected ball radius in this frame's pixels. */
  radius: number;
  /** Minimum brightness increase to count as "new". */
  threshold: number;
  /** Where the ball sat at address; blobs on top of it are ignored. */
  address: Point;
  /** +1 if the ball flies towards +x, -1 towards -x. */
  direction: 1 | -1;
  /** Keep blobs in every direction (filming from behind, the ball flies "up" the picture). */
  anyDirection?: boolean;
  /** Smallest blob to keep (pixels). Filmed from behind, the ball shrinks to a dot fast. */
  minArea?: number;
}

/**
 * Bright blobs that appeared since both the previous frame and the pre-impact reference,
 * in front of the address position.
 */
export function findCandidates(f: GrayFrame, prev: GrayFrame, ref: GrayFrame, o: CandidateOptions): Blob[] {
  const n = f.width * f.height;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const v = f.data[i];
    if (v - prev.data[i] > o.threshold && v - ref.data[i] > o.threshold) mask[i] = 1;
  }
  const ballArea = Math.PI * o.radius * o.radius;
  // A blurred ball can smear to a few diameters long; tiny specks are noise.
  const blobs = connectedComponents(mask, f.width, f.height, o.minArea ?? Math.max(2, ballArea * 0.2), ballArea * 8);
  return blobs.filter((b) => {
    // A blob cut off by the frame edge has a misleading centre.
    if (b.minX === 0 || b.minY === 0 || b.maxX === f.width - 1 || b.maxY === f.height - 1) return false;
    const ahead = (b.cx - o.address.x) * o.direction;
    const nearAddress = Math.hypot(b.cx - o.address.x, b.cy - o.address.y) < o.radius * 1.8;
    return !nearAddress && (o.anyDirection || ahead > -o.radius);
  });
}

export interface TrackPoint extends Point {
  t: number;
}

export interface Track {
  points: TrackPoint[];
  /** Velocity in pixels per second (image y grows downwards). */
  vx: number;
  vy: number;
  /** RMS distance of the points from the fitted line, in pixels. */
  rms: number;
  /** Closest distance of the fitted line's backwards extension to the address position. */
  missFromAddress: number;
}

export interface TrackOptions {
  radius: number;
  address: Point;
  direction: 1 | -1;
  /** Pixels per metre in these frames, used to reject impossible speeds. */
  pixelsPerMeter: number;
  minPoints?: number;
}

function leastSquares(points: TrackPoint[]) {
  const n = points.length;
  const mt = points.reduce((s, p) => s + p.t, 0) / n;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let stt = 0;
  let stx = 0;
  let sty = 0;
  for (const p of points) {
    stt += (p.t - mt) ** 2;
    stx += (p.t - mt) * (p.x - mx);
    sty += (p.t - mt) * (p.y - my);
  }
  const vx = stt > 0 ? stx / stt : 0;
  const vy = stt > 0 ? sty / stt : 0;
  const at = (t: number) => ({ x: mx + vx * (t - mt), y: my + vy * (t - mt) });
  const rms = Math.sqrt(
    points.reduce((s, p) => {
      const q = at(p.t);
      return s + (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
    }, 0) / n,
  );
  return { vx, vy, at, rms, mx, my };
}

/** Perpendicular distance from point p to the line through (x, y) with direction (vx, vy). */
function lineDistance(p: Point, x: number, y: number, vx: number, vy: number): number {
  const len = Math.hypot(vx, vy);
  if (len === 0) return Math.hypot(p.x - x, p.y - y);
  return Math.abs((p.x - x) * vy - (p.y - y) * vx) / len;
}

/**
 * Find the ball's flight among per-frame candidates: the largest set of detections (at most
 * one per frame) consistent with straight-line, constant-speed motion away from address.
 */
export function fitTrack(frames: { t: number; blobs: Blob[] }[], o: TrackOptions): Track | undefined {
  const minPoints = o.minPoints ?? 3;
  const tol = Math.max(3, o.radius * 1.5);
  const minSpeed = 15 * MPS_PER_MPH * o.pixelsPerMeter; // px/s
  const maxSpeed = 230 * MPS_PER_MPH * o.pixelsPerMeter;
  const all = frames.flatMap((f) => f.blobs.map((b) => ({ t: f.t, x: b.cx, y: b.cy })));

  // A real flight is a tight straight line (sub-pixel to ~1 px of centroid jitter) that
  // starts at the ball's address position.
  const maxRms = Math.max(1.2, o.radius * 0.25);
  const maxMiss = o.radius * 2.5;
  let best: (Track & { score: number }) | undefined;
  for (let i = 0; i < all.length; i++) {
    for (let j = 0; j < all.length; j++) {
      const a = all[i];
      const b = all[j];
      if (b.t <= a.t) continue;
      const vx = (b.x - a.x) / (b.t - a.t);
      const vy = (b.y - a.y) / (b.t - a.t);
      const speed = Math.hypot(vx, vy);
      if (vx * o.direction <= 0 || speed < minSpeed || speed > maxSpeed) continue;
      // Launch between -15° (topped) and 70° (lob wedge) above horizontal.
      const angle = (Math.atan2(-vy, vx * o.direction) * 180) / Math.PI;
      if (angle < -15 || angle > 70) continue;

      // Best match per frame for this hypothesis.
      const inliers: TrackPoint[] = [];
      for (const f of frames) {
        const px = a.x + vx * (f.t - a.t);
        const py = a.y + vy * (f.t - a.t);
        let bestBlob: TrackPoint | undefined;
        let bestD = tol;
        for (const blob of f.blobs) {
          const d = Math.hypot(blob.cx - px, blob.cy - py);
          if (d < bestD) {
            bestD = d;
            bestBlob = { t: f.t, x: blob.cx, y: blob.cy };
          }
        }
        if (bestBlob) inliers.push(bestBlob);
      }
      if (inliers.length < minPoints) continue;

      // Drop the worst point while the fit is loose (e.g. a frame where the ball touched the club).
      let fit = leastSquares(inliers);
      while (fit.rms > maxRms && inliers.length > minPoints) {
        let worst = 0;
        let worstD = -1;
        inliers.forEach((p, k) => {
          const q = fit.at(p.t);
          const d = Math.hypot(p.x - q.x, p.y - q.y);
          if (d > worstD) {
            worstD = d;
            worst = k;
          }
        });
        inliers.splice(worst, 1);
        fit = leastSquares(inliers);
      }
      const missFromAddress = lineDistance(o.address, fit.mx, fit.my, fit.vx, fit.vy);
      if (fit.rms > maxRms || missFromAddress > maxMiss) continue;
      // A real ball is seen in every frame while it's in view; points stitched together
      // across a run of empty frames are a coincidence.
      const t0 = inliers[0].t;
      const t1 = inliers[inliers.length - 1].t;
      const span = frames.filter((f) => f.t >= t0 && f.t <= t1).length;
      if (span - inliers.length > Math.max(1, Math.floor(span * 0.25))) continue;
      const fitSpeed = Math.hypot(fit.vx, fit.vy);
      // The ball always leaves faster than the club head (smash factor > 1), and the club
      // stays in view longer, so prefer the fastest valid track over the longest one.
      const score = fitSpeed + inliers.length;
      if (!best || score > best.score) {
        best = { points: inliers, vx: fit.vx, vy: fit.vy, rms: fit.rms, missFromAddress, score };
      }
    }
  }
  if (!best) return undefined;
  const { score: _score, ...track } = best;
  return track;
}

export interface ShotMeasurement {
  ballSpeedMph: number;
  launchAngleDeg: number;
  /** 0..1: how much to trust the reading. */
  confidence: number;
  pointsUsed: number;
}

/** Convert a fitted track into ball speed and launch angle. */
export function measureTrack(track: Track, pixelsPerMeter: number, direction: 1 | -1, radius: number): ShotMeasurement {
  const speedMps = Math.hypot(track.vx, track.vy) / pixelsPerMeter;
  const launch = (Math.atan2(-track.vy, track.vx * direction) * 180) / Math.PI;
  // More points and a tighter fit = more trust.
  const pointScore = Math.min(1, (track.points.length - 2) / 4);
  const fitScore = clamp(1 - track.rms / Math.max(1.2, radius * 0.25), 0, 1);
  const originScore = clamp(1 - track.missFromAddress / (radius * 2.5), 0, 1);
  return {
    ballSpeedMph: speedMps / MPS_PER_MPH,
    launchAngleDeg: launch,
    confidence: Math.round(pointScore * (0.5 + 0.5 * fitScore) * (0.6 + 0.4 * originScore) * 100) / 100,
    pointsUsed: track.points.length,
  };
}

/** Pixels per metre from the ball's measured radius (in the same pixels). */
export const pixelsPerMeterFromRadius = (radiusPx: number) => (2 * radiusPx) / BALL_DIAMETER_M;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The part of the frame worth analysing: from just behind the ball, forwards to the frame
 * edge in the flight direction, and from the top of the frame down to just below the ball.
 */
export function analysisRegion(ball: Point & { radius: number }, frameW: number, frameH: number, direction: 1 | -1): Rect {
  const r = ball.radius;
  const bottom = Math.min(frameH, Math.ceil(ball.y + r * 4));
  if (direction === 1) {
    const x = Math.max(0, Math.floor(ball.x - r * 4));
    return { x, y: 0, width: frameW - x, height: bottom };
  }
  const right = Math.min(frameW, Math.ceil(ball.x + r * 4));
  return { x: 0, y: 0, width: right, height: bottom };
}

/**
 * Coarse-to-fine plan for which frames to decode: `coarse` frames spread over the window where
 * the impact sound says the shot happened.
 */
export function coarseFrames(centerFrame: number, halfWindowFrames: number, step: number, maxFrame: number): number[] {
  const out: number[] = [];
  const start = Math.max(0, centerFrame - halfWindowFrames);
  const end = Math.min(maxFrame, centerFrame + halfWindowFrames);
  for (let f = start; f <= end; f += step) out.push(Math.round(f));
  return out;
}

/**
 * Given presence scores at the coarse frames, the last frame where the ball was still at
 * address and the first where it was gone. Undefined if it never left (a practice swing).
 */
export function impactBracket(
  samples: { frame: number; presence: number }[],
  presentAbove = 0.6,
  goneBelow = 0.35,
): { lastPresent: number; firstGone: number } | undefined {
  const sorted = [...samples].sort((a, b) => a.frame - b.frame);
  // The ball must be gone from some frame onwards, for good.
  let firstGoneIdx = -1;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].presence < goneBelow) firstGoneIdx = i;
    else break;
  }
  if (firstGoneIdx <= 0) return undefined;
  let lastPresentIdx = -1;
  for (let i = firstGoneIdx - 1; i >= 0; i--) {
    if (sorted[i].presence > presentAbove) {
      lastPresentIdx = i;
      break;
    }
  }
  if (lastPresentIdx < 0) return undefined;
  return { lastPresent: sorted[lastPresentIdx].frame, firstGone: sorted[firstGoneIdx].frame };
}
