/**
 * Renders fake 240 fps side-on swing frames with a known ball speed and launch angle, so the
 * tracker can be tested without a phone. The scene deliberately includes things that fool
 * naive trackers: textured grass, a golfer with a bright moving shirt, and a shiny club head
 * that sweeps through the ball position and keeps going after impact.
 */
import { BALL_DIAMETER_M, MPS_PER_MPH } from '../../launch';
import type { GrayFrame } from '../../tracking';

export interface SwingScene {
  width: number;
  height: number;
  fps: number;
  ball: { x: number; y: number; radius: number };
  ballSpeedMph: number;
  launchDeg: number;
  direction: 1 | -1;
  impactFrame: number;
  /** Shutter time as a fraction of the frame interval (motion blur). */
  exposure: number;
  /** Ball never leaves (practice swing). */
  practiceSwing?: boolean;
  /** No ball at all. */
  noBall?: boolean;
  noise?: number;
  seed?: number;
}

export const defaultScene = (over: Partial<SwingScene> = {}): SwingScene => ({
  width: 640,
  height: 360,
  fps: 240,
  ball: { x: 150, y: 300, radius: 6.5 },
  ballSpeedMph: 150,
  launchDeg: 12,
  direction: 1,
  impactFrame: 120,
  exposure: 0.25,
  noise: 6,
  seed: 1,
  ...over,
});

export const scenePixelsPerMeter = (s: SwingScene) => (2 * s.ball.radius) / BALL_DIAMETER_M;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Paint a shape with soft (anti-aliased) edges. `dist` returns signed distance (<0 inside). */
function paint(img: Float32Array, w: number, h: number, box: [number, number, number, number], luma: number, dist: (x: number, y: number) => number) {
  const [x0, y0, x1, y1] = box;
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(h - 1, Math.ceil(y1)); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(w - 1, Math.ceil(x1)); x++) {
      const d = dist(x, y);
      const cover = Math.max(0, Math.min(1, 0.5 - d));
      if (cover > 0) img[y * w + x] = img[y * w + x] * (1 - cover) + luma * cover;
    }
  }
}

/** Distance from p to segment a-b, minus radius: a capsule (a blurred moving disc). */
function capsule(ax: number, ay: number, bx: number, by: number, r: number) {
  return (x: number, y: number) => {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    return Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) - r;
  };
}

const backgrounds = new Map<string, Float32Array>();

/** Static textured background (brighter sky, darker textured turf), cached per scene size + seed. */
function background(w: number, h: number, seed: number): Float32Array {
  const key = `${w}x${h}:${seed}`;
  let img = backgrounds.get(key);
  if (!img) {
    img = new Float32Array(w * h);
    const bg = rng(seed);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const base = y < h * 0.55 ? 150 - y * 0.08 : 85 + Math.sin(x * 0.9) * 6;
        img[y * w + x] = base + (bg() - 0.5) * 20;
      }
    }
    backgrounds.set(key, img);
  }
  return img;
}

export function renderFrame(s: SwingScene, frame: number): GrayFrame {
  const { width: w, height: h } = s;
  const img = Float32Array.from(background(w, h, s.seed ?? 1));
  const t = (frame - s.impactFrame) / s.fps; // seconds from impact
  const dir = s.direction;
  const ppm = scenePixelsPerMeter(s);
  const { x: bx, y: by, radius: r } = s.ball;

  // Golfer: dark trousers, bright shirt that rotates through the swing (moves a few px/frame).
  const golferX = bx - dir * 60;
  const sway = Math.sin(frame / 30) * 25;
  paint(img, w, h, [golferX - 25, by - 150, golferX + 25, by + 10], 45, (x, y) =>
    Math.max(Math.abs(x - golferX) - 25, Math.abs(y - (by - 70)) - 80),
  );
  const shirtX = golferX + sway;
  paint(img, w, h, [shirtX - 30, by - 230, shirtX + 30, by - 140], 215, (x, y) =>
    Math.max(Math.abs(x - shirtX) - 30, Math.abs(y - (by - 185)) - 45),
  );

  // Club head: approaches along an arc, passes the ball at impact, continues slower and steeper.
  const ballSpeedPx = s.ballSpeedMph * MPS_PER_MPH * ppm;
  const clubSpeedPx = ballSpeedPx / 1.45;
  const clubAngle = ((s.launchDeg + 25) * Math.PI) / 180;
  if (Math.abs(t) < 0.06) {
    const cx = bx + dir * Math.cos(t < 0 ? 0 : clubAngle) * clubSpeedPx * t;
    const cy = by + (t < 0 ? -clubSpeedPx * t * 0.25 : -Math.sin(clubAngle) * clubSpeedPx * t);
    const blur = (clubSpeedPx * s.exposure) / s.fps;
    paint(img, w, h, [cx - 20 - blur, cy - 20, cx + 20 + blur, cy + 20], 185, capsule(cx - dir * blur, cy, cx, cy, r * 1.3));
  }

  // Ball.
  if (!s.noBall) {
    if (t < 0 || s.practiceSwing) {
      paint(img, w, h, [bx - r - 2, by - r - 2, bx + r + 2, by + r + 2], 238, (x, y) => Math.hypot(x - bx, y - by) - r);
    } else {
      const a = (s.launchDeg * Math.PI) / 180;
      const vx = dir * Math.cos(a) * ballSpeedPx;
      const vy = -Math.sin(a) * ballSpeedPx;
      const blurT = s.exposure / s.fps;
      // Centre of the exposure window is at time t.
      const x0 = bx + vx * (t - blurT / 2);
      const y0 = by + vy * (t - blurT / 2);
      const x1 = bx + vx * (t + blurT / 2);
      const y1 = by + vy * (t + blurT / 2);
      // Blur spreads the same light over more pixels, so the streak is dimmer.
      const streak = Math.hypot(x1 - x0, y1 - y0);
      const luma = 90 + (238 - 90) * Math.min(1, (2 * r) / (2 * r + streak * 0.6));
      paint(img, w, h, [Math.min(x0, x1) - r - 2, Math.min(y0, y1) - r - 2, Math.max(x0, x1) + r + 2, Math.max(y0, y1) + r + 2], luma, capsule(x0, y0, x1, y1, r));
    }
  }

  // Per-frame sensor noise (a cheap LCG keeps this fast even under the test transpiler).
  let seed = ((s.seed ?? 1) * 7919 + frame * 104729) >>> 0;
  const amp = (s.noise ?? 0) * 2;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const v = img[i] + (seed / 4294967296 - 0.5) * amp;
    out[i] = v < 0 ? 0 : v > 255 ? 255 : v + 0.5;
  }
  return { width: w, height: h, data: out };
}
