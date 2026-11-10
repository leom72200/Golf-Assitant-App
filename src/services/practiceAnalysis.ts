/**
 * Glue between the 240 fps recorder and the tracker for the camera practice mode:
 * calibrating on the ball at setup, and analysing each clip after an impact is heard.
 */
import type { RecordingResult } from '../../modules/highspeed-camera';
import { impactFrameInClip } from '@/domain/impactDetector';
import { analyzeShot, type ShotAnalysis } from '@/domain/shotAnalyzer';
import {
  analysisRegion,
  locateBall,
  pixelsPerMeterFromRadius,
  type BallFix,
  type GrayFrame,
  type Point,
} from '@/domain/tracking';

import { analysisSize, ClipFrames, type ClipGeometry } from './clipFrames';

export interface PracticeSetup {
  geometry: ClipGeometry;
  /** Ball at address, in full-frame analysis-space pixels. */
  ball: BallFix;
  direction: 1 | -1;
  /** Analysis-space pixels per metre (measured at full resolution for precision). */
  pixelsPerMeter: number;
}

/**
 * Find the ball near a tap on the setup still, then re-measure it at full resolution:
 * calibration (and so every ball speed) is proportional to the measured ball size.
 */
export async function calibrateOnBall(
  clip: ClipFrames,
  still: GrayFrame,
  frame: number,
  tap: Point,
  geometry: ClipGeometry,
): Promise<{ ball: BallFix; pixelsPerMeter: number } | undefined> {
  const ball = locateBall(still, tap, 28, { minRadius: 2, maxRadius: 25 });
  if (!ball) return undefined;
  const { scale } = analysisSize(geometry);
  const r = ball.radius / scale;
  const half = Math.ceil(r * 5);
  const cx = ball.x / scale;
  const cy = ball.y / scale;
  const sideways = geometry.rotation % 180 !== 0;
  const fullW = sideways ? geometry.height : geometry.width;
  const fullH = sideways ? geometry.width : geometry.height;
  const x = Math.max(0, Math.floor(cx - half));
  const y = Math.max(0, Math.floor(cy - half));
  const region = { x, y, width: Math.min(fullW - x, half * 2), height: Math.min(fullH - y, half * 2) };
  try {
    const [crop] = await clip.gray([frame], region, true);
    const precise = locateBall(crop, { x: cx - x, y: cy - y }, r * 2, { minRadius: r * 0.6, maxRadius: r * 1.6 });
    if (precise) return { ball, pixelsPerMeter: pixelsPerMeterFromRadius(precise.radius) * scale };
  } catch {
    // Fall back to the analysis-scale measurement below.
  }
  return { ball, pixelsPerMeter: pixelsPerMeterFromRadius(ball.radius) };
}

/** What the camera tracer needs: a real frame and the ball's path on it (analysis pixels). */
export interface CameraTracerData {
  uri: string;
  width: number;
  height: number;
  address: Point;
  points: Point[];
  vx: number;
  vy: number;
}

export type ClipAnalysis = ShotAnalysis & { elapsedMs: number; tracer?: CameraTracerData };

/** Analyse one recorded clip. The clip file is deleted afterwards. */
export async function analyzeClip(
  clip: RecordingResult,
  setup: PracticeSetup,
  heardAtMs: number,
  stopRequestedAtMs: number,
): Promise<ClipAnalysis> {
  const started = Date.now();
  const geometry: ClipGeometry = { ...setup.geometry, width: clip.width, height: clip.height, fps: clip.fps };
  const size = analysisSize(geometry);
  const region = analysisRegion(setup.ball, size.width, size.height, setup.direction);
  const toRegion = (b: BallFix): BallFix => ({ ...b, x: b.x - region.x, y: b.y - region.y });
  const fromRegion = (b: BallFix): BallFix => ({ ...b, x: b.x + region.x, y: b.y + region.y });

  const frames = new ClipFrames(clip.uri, geometry);
  try {
    const frameCount = Math.floor((clip.durationMs / 1000) * clip.fps);
    const result = await analyzeShot({
      fps: clip.fps,
      frameCount,
      impactGuessFrame: impactFrameInClip({
        clipDurationMs: clip.durationMs,
        heardAtMs,
        stopRequestedAtMs,
        fps: clip.fps,
      }),
      // ±250 ms covers microphone and scheduling delays.
      halfWindowFrames: Math.round(clip.fps * 0.25),
      setup: { ball: toRegion(setup.ball), direction: setup.direction, pixelsPerMeter: setup.pixelsPerMeter },
      loadFrames: (f) => frames.gray(f, region),
      coarseStep: Math.max(4, Math.round(clip.fps / 40)),
    });
    if (result.status === 'ok') {
      // Keep one frame from just after impact for the camera tracer (best effort).
      let tracer: CameraTracerData | undefined;
      try {
        const first = result.track.points[0];
        const still = await frames.still(Math.round(first.t * clip.fps));
        tracer = {
          uri: still.uri,
          width: still.gray.width,
          height: still.gray.height,
          address: fromRegion(result.ball),
          points: result.track.points.map((p) => ({ x: p.x + region.x, y: p.y + region.y })),
          vx: result.track.vx,
          vy: result.track.vy,
        };
      } catch {
        tracer = undefined;
      }
      return { ...result, ball: fromRegion(result.ball), elapsedMs: Date.now() - started, tracer };
    }
    const elapsedMs = Date.now() - started;
    return { ...result, ball: result.ball ? fromRegion(result.ball) : undefined, elapsedMs };
  } finally {
    frames.release(true);
  }
}
