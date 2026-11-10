/**
 * Shot Tracer helpers for videos recorded from behind the player (normal 30/60 fps video):
 * reading the clip's size and frame rate, grabbing a still for aiming, and finding the start
 * line from the frames around impact.
 */
import { createVideoPlayer } from 'expo-video';

import { calibrateBehind, startAngleFromSighting, type BehindCalibration } from '@/domain/behindCamera';
import { detectLaunchBehind } from '@/domain/behindDetect';
import type { Point2 } from '@/domain/tracerProjection';
import { locateBall, type BallFix } from '@/domain/tracking';

import { analysisSize, ClipFrames, type ClipGeometry } from './clipFrames';

export interface VideoInfo {
  width: number;
  height: number;
  fps: number;
  duration: number;
}

/** Size, frame rate and length of a video file (with sensible fallbacks). */
export function probeVideo(uri: string, timeoutMs = 4000): Promise<VideoInfo> {
  return new Promise((resolve) => {
    const player = createVideoPlayer(uri);
    let done = false;
    const finish = (info: Partial<VideoInfo>) => {
      if (done) return;
      done = true;
      sub.remove();
      player.release();
      resolve({ width: 1920, height: 1080, fps: 30, duration: 0, ...info });
    };
    const sub = player.addListener('sourceLoad', (e) => {
      const track = e.availableVideoTracks[0];
      finish({
        width: track?.size?.width || undefined,
        height: track?.size?.height || undefined,
        fps: track?.frameRate || undefined,
        duration: e.duration,
      } as Partial<VideoInfo>);
    });
    setTimeout(() => finish({ duration: player.duration || 0 }), timeoutMs);
  });
}

/** The tracer's view of a clip: geometry for frame extraction plus analysis-space size. */
export function tracerGeometry(info: VideoInfo, rotation: number): ClipGeometry {
  return { width: info.width, height: info.height, fps: info.fps, rotation };
}

export interface Aim {
  /** Ball at address, analysis-space pixels. */
  ball: BallFix | (Point2 & { radius: number });
  /** Target far down the fairway, analysis-space pixels. */
  target: Point2;
  rotation: number;
}

export function calibrationFor(aim: Aim, geometry: ClipGeometry): BehindCalibration | undefined {
  const size = analysisSize(geometry);
  return calibrateBehind(aim.ball, aim.target, size.width, size.height);
}

/** Find the ball near a tap on the aiming still (falls back to the tap itself). */
export function ballNear(still: { width: number; height: number; data: Uint8Array }, tap: Point2) {
  return locateBall(still, tap, 18, { minRadius: 1.5, maxRadius: 14 });
}

export interface TracerDetection {
  /** Seconds into the clip when the ball was struck. */
  impactSec: number;
  /** Start line in degrees (+ right), if the ball was seen leaving. */
  startDeg?: number;
  /** The ball's address position this time (it may have been re-teed). */
  ball?: BallFix;
  /** Where the ball was first seen in flight (analysis pixels). */
  sighting?: Point2;
  /** True when the impact time came from the frames rather than the sound. */
  impactFromFrames?: boolean;
  elapsedMs?: number;
}

/**
 * Look at the frames around the expected impact for the ball leaving, and turn its first
 * sighting into a start line. Best effort: returns the guess if the ball can't be followed.
 */
export async function detectTracerLaunch(opts: {
  frames: ClipFrames;
  geometry: ClipGeometry;
  aim: Aim;
  impactGuessSec: number;
  launchDeg: number;
  windowSec?: number;
}): Promise<TracerDetection> {
  const { frames, geometry, aim, impactGuessSec, launchDeg } = opts;
  const started = Date.now();
  const took = () => Date.now() - started;
  const fps = geometry.fps;
  const size = analysisSize(geometry);
  const half = Math.round((opts.windowSec ?? 0.4) * fps);
  const center = Math.round(impactGuessSec * fps);
  const indices: number[] = [];
  for (let f = Math.max(0, center - half); f <= center + half; f++) indices.push(f);
  // Only the part of the picture between the horizon and just below the ball matters.
  const r0 = aim.ball.radius;
  const x0 = Math.max(0, Math.floor(Math.min(aim.ball.x, aim.target.x) - size.width * 0.3));
  const x1 = Math.min(size.width, Math.ceil(Math.max(aim.ball.x, aim.target.x) + size.width * 0.3));
  const y0 = Math.max(0, Math.floor(aim.target.y - size.height * 0.08));
  const y1 = Math.min(size.height, Math.ceil(aim.ball.y + Math.max(20, r0 * 8)));
  const region = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  const toRegion = (p: Point2) => ({ x: p.x - x0, y: p.y - y0 });
  try {
    const imgs = await frames.gray(indices, region);
    // The ball may have been re-teed a little away from last time.
    const near = toRegion(aim.ball);
    let found: BallFix | undefined;
    for (const img of imgs) {
      found = locateBall(img, near, Math.max(12, r0 * 6), { minRadius: 1.5, maxRadius: Math.max(6, r0 * 2) });
      if (found) break;
    }
    if (!found) return { impactSec: impactGuessSec, elapsedMs: took() };
    const ball: BallFix = { ...found, x: found.x + x0, y: found.y + y0 };
    const res = detectLaunchBehind(imgs, found, toRegion(aim.target));
    if (!res) return { impactSec: impactGuessSec, ball, elapsedMs: took() };
    const impactSec = (indices[res.impactIndex] + 0.5) / fps;
    const sighting = { x: res.sighting.x + x0, y: res.sighting.y + y0 };
    const cal = calibrateBehind(ball, aim.target, size.width, size.height);
    const startDeg = cal ? startAngleFromSighting(cal, launchDeg, sighting) : undefined;
    return { impactSec, startDeg, ball, sighting, impactFromFrames: true, elapsedMs: took() };
  } catch {
    return { impactSec: impactGuessSec, elapsedMs: took() };
  }
}
