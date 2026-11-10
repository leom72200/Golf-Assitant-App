import { base64ToBytes } from '../frameDecode';
import { analyzeShot } from '../shotAnalyzer';
import { impactBracket, locateBall, otsuThreshold } from '../tracking';
import { defaultScene, renderFrame, scenePixelsPerMeter, type SwingScene } from './helpers/syntheticSwing';

/** Run the analyzer against a synthetic scene, with the impact "heard" `audioOffset` frames off. */
async function analyze(scene: SwingScene, audioOffset = 0, frameCount = 400) {
  const setupFrame = renderFrame({ ...scene, practiceSwing: true }, 0);
  const ball = locateBall(setupFrame, { x: scene.ball.x + 3, y: scene.ball.y - 2 }, 30)!;
  return analyzeShot({
    fps: scene.fps,
    frameCount,
    impactGuessFrame: scene.impactFrame + audioOffset,
    halfWindowFrames: 48,
    setup: { ball, direction: scene.direction },
    loadFrames: async (frames) => frames.map((f) => renderFrame(scene, f)),
  });
}

describe('locateBall', () => {
  it('finds the ball centre and size from a rough tap', () => {
    const scene = defaultScene();
    const fix = locateBall(renderFrame(scene, 0), { x: 156, y: 294 }, 30);
    expect(fix).toBeDefined();
    expect(fix!.x).toBeCloseTo(150, 0);
    expect(fix!.y).toBeCloseTo(300, 0);
    expect(fix!.radius).toBeGreaterThan(6.5 * 0.9);
    expect(fix!.radius).toBeLessThan(6.5 * 1.1);
  });

  it('returns nothing when there is no ball', () => {
    const scene = defaultScene({ noBall: true });
    expect(locateBall(renderFrame(scene, 0), { x: 150, y: 300 }, 20)).toBeUndefined();
  });
});

describe('analyzeShot on synthetic swings', () => {
  const cases: [string, Partial<SwingScene>][] = [
    ['driver', { ballSpeedMph: 150, launchDeg: 12 }],
    ['7 iron', { ballSpeedMph: 115, launchDeg: 18 }],
    ['wedge', { ballSpeedMph: 75, launchDeg: 30 }],
    ['heavy blur driver', { ballSpeedMph: 165, launchDeg: 10, exposure: 0.6 }],
    ['ball flying right-to-left', { ballSpeedMph: 120, launchDeg: 16, direction: -1, ball: { x: 490, y: 300, radius: 6.5 } }],
  ];

  it.each(cases)('%s: speed within 4%% and launch within 1.5°', async (_, over) => {
    const scene = defaultScene(over);
    const res = await analyze(scene);
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(Math.abs(res.measurement.ballSpeedMph / scene.ballSpeedMph - 1)).toBeLessThan(0.04);
    expect(Math.abs(res.measurement.launchAngleDeg - scene.launchDeg)).toBeLessThan(1.5);
    expect(res.measurement.confidence).toBeGreaterThan(0.4);
    // Calibration came from the ball's measured size.
    expect(Math.abs(res.pixelsPerMeter / scenePixelsPerMeter(scene) - 1)).toBeLessThan(0.08);
  });

  it('copes with the impact sound being off by ~100 ms', async () => {
    const scene = defaultScene({ ballSpeedMph: 130, launchDeg: 14 });
    for (const offset of [-24, 24]) {
      const res = await analyze(scene, offset);
      expect(res.status).toBe('ok');
    }
  });

  it('only decodes a few dozen frames per shot', async () => {
    const res = await analyze(defaultScene());
    expect(res.framesDecoded).toBeLessThan(45);
  });

  it('reports a practice swing when the ball never leaves', async () => {
    const res = await analyze(defaultScene({ practiceSwing: true }));
    expect(res.status).toBe('no-shot');
  });

  it('asks to re-aim when the ball is missing', async () => {
    const scene = defaultScene();
    const res = await analyzeShot({
      fps: 240,
      frameCount: 400,
      impactGuessFrame: 120,
      halfWindowFrames: 48,
      setup: { ball: { x: 150, y: 300, radius: 6.5, ballLuma: 238, surroundLuma: 90 }, direction: 1 },
      loadFrames: async (frames) => frames.map((f) => renderFrame({ ...scene, noBall: true }, f)),
    });
    expect(res.status).toBe('ball-not-found');
  });
});

describe('helpers', () => {
  it('impactBracket needs the ball present, then gone for good', () => {
    const s = (pairs: [number, number][]) => pairs.map(([frame, presence]) => ({ frame, presence }));
    expect(impactBracket(s([[0, 1], [6, 1], [12, 0.1], [18, 0]]))).toEqual({ lastPresent: 6, firstGone: 12 });
    expect(impactBracket(s([[0, 1], [6, 1], [12, 1]]))).toBeUndefined();
    // Briefly hidden by the club, then visible again = not hit yet.
    expect(impactBracket(s([[0, 1], [6, 0.1], [12, 1], [18, 0.1], [24, 0]]))).toEqual({ lastPresent: 12, firstGone: 18 });
  });

  it('otsu splits two clusters', () => {
    const v = [...Array(100).fill(40), ...Array(20).fill(220)];
    const t = otsuThreshold(v);
    expect(t).toBeGreaterThanOrEqual(40);
    expect(t).toBeLessThan(220);
  });

  it('decodes base64', () => {
    expect(Array.from(base64ToBytes('SGVsbG8='))).toEqual([72, 101, 108, 108, 111]);
    expect(Array.from(base64ToBytes('data:image/jpeg;base64,AAEC'))).toEqual([0, 1, 2]);
  });
});
