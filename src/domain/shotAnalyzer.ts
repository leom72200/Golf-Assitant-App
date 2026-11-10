/**
 * Orchestrates one shot's analysis: which frames to decode, in what order, and how the
 * tracking steps fit together. Frame loading is injected, so the same code runs against the
 * phone's video decoder in the app and against synthetic / ffmpeg-made frames in tests.
 */
import {
  ballPresence,
  coarseFrames,
  findCandidates,
  fitTrack,
  impactBracket,
  locateBall,
  measureTrack,
  pixelsPerMeterFromRadius,
  type BallFix,
  type GrayFrame,
  type ShotMeasurement,
  type Track,
} from './tracking';

export interface AnalyzerSetup {
  /** The ball at address in analysis-frame pixels (from setup or the previous shot). */
  ball: BallFix;
  direction: 1 | -1;
  /**
   * Pixels per metre in analysis-frame pixels from a reference object (e.g. alignment stick).
   * When omitted, the ball's own measured size calibrates each shot.
   */
  pixelsPerMeter?: number;
}

export interface AnalyzerInput {
  fps: number;
  /** Total frames in the clip. */
  frameCount: number;
  /** Best guess of the impact frame (e.g. from the impact sound). */
  impactGuessFrame: number;
  /** How far either side of the guess to look, in frames. */
  halfWindowFrames: number;
  setup: AnalyzerSetup;
  /** Decode these frame indices into analysis-space grayscale frames, in the same order. */
  loadFrames: (frames: number[]) => Promise<GrayFrame[]>;
  /** Frames between coarse samples. */
  coarseStep?: number;
  /** Frames to decode after the ball has gone, to follow its flight. */
  followFrames?: number;
}

export type ShotAnalysis =
  | {
      status: 'ok';
      measurement: ShotMeasurement;
      /** Where the ball sat this time; use it as the starting point for the next shot. */
      ball: BallFix;
      track: Track;
      pixelsPerMeter: number;
      impactFrame: number;
      framesDecoded: number;
    }
  | { status: 'ball-not-found' | 'no-shot' | 'no-track'; reason: string; framesDecoded: number; ball?: BallFix };

export async function analyzeShot(input: AnalyzerInput): Promise<ShotAnalysis> {
  const { fps, setup } = input;
  const step = input.coarseStep ?? 6;
  const follow = input.followFrames ?? 14;
  let decoded = 0;
  const load = async (frames: number[]) => {
    decoded += frames.length;
    return input.loadFrames(frames);
  };

  // 1. Coarse scan around the expected impact.
  const coarse = coarseFrames(input.impactGuessFrame, input.halfWindowFrames, step, input.frameCount - 1);
  if (coarse.length < 3) return { status: 'no-shot', reason: 'Clip too short', framesDecoded: decoded };
  const coarseImgs = await load(coarse);

  // 2. Find the ball near where it was last time (it may have been re-teed a little away).
  const r = setup.ball.radius;
  let ball: BallFix | undefined;
  for (const img of coarseImgs) {
    ball = locateBall(img, setup.ball, r * 6, { minRadius: r * 0.6, maxRadius: r * 1.6 });
    if (ball) break;
  }
  if (!ball) {
    return {
      status: 'ball-not-found',
      reason: "Couldn't see a ball where you set up. Re-aim on the ball.",
      framesDecoded: decoded,
    };
  }

  // 3. When did it leave?
  const presence = coarseImgs.map((img, i) => ({ frame: coarse[i], presence: ballPresence(img, ball!) }));
  const bracket = impactBracket(presence);
  if (!bracket) {
    return { status: 'no-shot', reason: 'The ball never left — practice swing?', framesDecoded: decoded, ball };
  }

  // 4. Decode every frame from just before it left, through its flight.
  const fine: number[] = [];
  for (let f = bracket.lastPresent; f <= Math.min(input.frameCount - 1, bracket.firstGone + follow); f++) fine.push(f);
  const fineImgs = await load(fine);

  // Reference = the latest frame where the ball is still clearly at address.
  let refIdx = 0;
  for (let i = 0; i < fineImgs.length; i++) {
    if (ballPresence(fineImgs[i], ball) > 0.6) refIdx = i;
    else break;
  }
  const ref = fineImgs[refIdx];
  // Motion blur spreads the ball's light out, so a flying ball is much dimmer than one at rest.
  const threshold = Math.max(14, (ball.ballLuma - ball.surroundLuma) * 0.18);
  const perFrame = [];
  for (let i = refIdx + 1; i < fineImgs.length; i++) {
    const blobs = findCandidates(fineImgs[i], fineImgs[i - 1], ref, {
      radius: ball.radius,
      threshold,
      address: ball,
      direction: setup.direction,
    });
    perFrame.push({ t: fine[i] / fps, blobs });
  }

  // 5. Fit the flight and convert to real units.
  const pixelsPerMeter = setup.pixelsPerMeter ?? pixelsPerMeterFromRadius(ball.radius);
  const track = fitTrack(perFrame, {
    radius: ball.radius,
    address: ball,
    direction: setup.direction,
    pixelsPerMeter,
  });
  if (!track) {
    return {
      status: 'no-track',
      reason: "Saw the ball leave but couldn't follow it. Try more light or a plainer background.",
      framesDecoded: decoded,
      ball,
    };
  }
  return {
    status: 'ok',
    measurement: measureTrack(track, pixelsPerMeter, setup.direction, ball.radius),
    ball,
    track,
    pixelsPerMeter,
    impactFrame: fine[refIdx],
    framesDecoded: decoded,
  };
}
