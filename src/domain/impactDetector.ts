/**
 * Spots the sharp "crack" of club meeting ball in a stream of microphone levels (dBFS,
 * polled every few tens of milliseconds). An impact is much louder than the background and
 * arrives within one poll, unlike talking or wind which build up gradually.
 */
export interface ImpactDetectorOptions {
  /** Ignore anything quieter than this (dBFS). */
  minDb?: number;
  /** How far above the recent background level a spike must jump (dB). */
  riseDb?: number;
  /** No second trigger within this many ms (the same shot echoing, or the follow-through). */
  cooldownMs?: number;
  /** How quickly the background level adapts (0..1 per sample). */
  baselineAlpha?: number;
}

export class ImpactDetector {
  private baseline: number | undefined;
  private lastHit = -Infinity;
  private readonly o: Required<ImpactDetectorOptions>;

  constructor(options: ImpactDetectorOptions = {}) {
    this.o = { minDb: -28, riseDb: 16, cooldownMs: 2000, baselineAlpha: 0.08, ...options };
  }

  /** Feed one level reading; returns true if this reading is an impact. */
  push(db: number, timeMs: number): boolean {
    if (!Number.isFinite(db)) return false;
    const level = Math.max(-100, db);
    if (this.baseline === undefined) {
      this.baseline = level;
      return false;
    }
    const isHit =
      level >= this.o.minDb && level - this.baseline >= this.o.riseDb && timeMs - this.lastHit >= this.o.cooldownMs;
    if (isHit) {
      this.lastHit = timeMs;
    } else {
      // Only learn the background from non-impact readings.
      this.baseline += (level - this.baseline) * this.o.baselineAlpha;
    }
    return isHit;
  }

  reset() {
    this.baseline = undefined;
    this.lastHit = -Infinity;
  }
}

/**
 * Where in the clip the impact happened, in frames. The recorder reports how long it ran;
 * the impact was heard `stopDelayMs` before stop was requested, and microphones report a
 * little late (`audioLatencyMs`).
 */
export function impactFrameInClip(opts: {
  clipDurationMs: number;
  heardAtMs: number;
  stopRequestedAtMs: number;
  fps: number;
  audioLatencyMs?: number;
}): number {
  const fromEnd = opts.stopRequestedAtMs - opts.heardAtMs + (opts.audioLatencyMs ?? 60);
  const atMs = Math.max(0, opts.clipDurationMs - fromEnd);
  return Math.round((atMs / 1000) * opts.fps);
}
