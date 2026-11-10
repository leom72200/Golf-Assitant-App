/**
 * Shot Tracer field tests: each saved shot keeps what the app detected alongside what the
 * player says really happened, so the tracer can be tuned on real footage. The report is
 * plain JSON so it can be shared and read back by a developer (or Claude).
 */
import type { Point2 } from './tracerProjection';

export type ShotShape = 'straight' | 'draw' | 'fade' | 'hook' | 'slice' | 'push' | 'pull' | 'topped' | 'other';
export type TracerMatch = 'yes' | 'close' | 'no';

export interface TracerTestRecord {
  id: string;
  createdAt: string;
  /** File name of the kept clip (in the app's tracer-tests folder). */
  videoFile: string;
  device: { model?: string; os?: string };
  video: { width: number; height: number; fps: number; duration: number; rotation: number };
  /** Analysis-space size the coordinates below refer to. */
  analysis: { width: number; height: number };
  aim: { ball: Point2 & { radius: number }; target: Point2 };
  detection: {
    /** Impact time from the sound (s into the clip). */
    impactFromAudioSec: number;
    /** Impact time from the frames (s), if the ball was seen leaving. */
    impactFromFramesSec?: number;
    ballFound: boolean;
    sighting?: Point2;
    startDeg?: number;
    elapsedMs: number;
    triggeredBy: 'sound' | 'button';
  };
  /** The tracer as the player left it after adjusting. */
  final: { clubId: string; carryYards: number; launchDeg: number; startDeg: number; curveYards: number; apexYards: number };
  /** What really happened, from the player. */
  notes: {
    landedYards?: number;
    shape?: ShotShape;
    matched?: TracerMatch;
    cameraDistanceM?: number;
    cameraHeightM?: number;
    comment?: string;
  };
}

export interface TracerTestSummary {
  shots: number;
  ballFoundRate: number;
  startDetectedRate: number;
  /** Mean |frames − audio| impact timing difference (ms), where both exist. */
  meanAudioOffsetMs?: number;
  /** Mean change the player made to the detected start line (degrees). */
  meanStartCorrectionDeg?: number;
  matched: Record<TracerMatch, number>;
}

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined);

export function summarizeTracerTests(records: TracerTestRecord[]): TracerTestSummary {
  const n = records.length;
  const offsets = records
    .filter((r) => r.detection.impactFromFramesSec !== undefined)
    .map((r) => Math.abs(r.detection.impactFromFramesSec! - r.detection.impactFromAudioSec) * 1000);
  const corrections = records
    .filter((r) => r.detection.startDeg !== undefined)
    .map((r) => Math.abs(r.final.startDeg - r.detection.startDeg!));
  const matched: Record<TracerMatch, number> = { yes: 0, close: 0, no: 0 };
  for (const r of records) if (r.notes.matched) matched[r.notes.matched]++;
  const round1 = (x: number | undefined) => (x === undefined ? undefined : Math.round(x * 10) / 10);
  return {
    shots: n,
    ballFoundRate: n ? records.filter((r) => r.detection.ballFound).length / n : 0,
    startDetectedRate: n ? records.filter((r) => r.detection.startDeg !== undefined).length / n : 0,
    meanAudioOffsetMs: round1(mean(offsets)),
    meanStartCorrectionDeg: round1(mean(corrections)),
    matched,
  };
}

/** The shareable report: summary first, then every record. */
export function tracerTestReport(records: TracerTestRecord[], appVersion = '0.1.0') {
  return {
    kind: 'golf-assistant/tracer-tests',
    version: 1,
    appVersion,
    exportedAt: new Date().toISOString(),
    summary: summarizeTracerTests(records),
    records,
  };
}
