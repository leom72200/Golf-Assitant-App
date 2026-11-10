import { calibrateBehind, defaultShape, projectBehind, startAngleFromSighting, tracerFlight } from '../behindCamera';
import { detectLaunchBehind } from '../behindDetect';
import { locateBall, type GrayFrame } from '../tracking';

interface Scene {
  W: number;
  H: number;
  BALL: { x: number; y: number };
  TARGET: { x: number; y: number };
}
const LANDSCAPE: Scene = { W: 640, H: 360, BALL: { x: 360, y: 320 }, TARGET: { x: 320, y: 150 } };
// Phone upright and close: the ball shrinks to a 1–2 px dot within two frames.
const PORTRAIT: Scene = { W: 640, H: 1138, BALL: { x: 340, y: 1020 }, TARGET: { x: 320, y: 500 } };
let { W, H, BALL, TARGET } = LANDSCAPE;
const use = (s: Scene) => ({ W, H, BALL, TARGET } = s);

/** Behind-the-player frames at 30 fps: grass, a golfer beside the ball, the ball flying away. */
function render(frame: number, impactFrame: number, startDeg: number): GrayFrame {
  const cal = calibrateBehind(BALL, TARGET, W, H)!;
  const tf = tracerFlight({ ...defaultShape(160), startDeg });
  const data = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const base = y < TARGET.y ? 170 : 90 + ((x * 7 + y * 13) % 9);
      data[y * W + x] = base;
    }
  }
  // Golfer: a dark body left of the ball whose bright arms swing a little each frame.
  const swing = (frame - impactFrame) * 6;
  for (let y = 120; y < 330; y++) for (let x = 250; x < 300; x++) data[y * W + x] = 40;
  for (let y = 150; y < 175; y++) for (let x = 290 + swing; x < 320 + swing; x++) if (x >= 0 && x < W) data[y * W + x] = 200;
  const disc = (cx: number, cy: number, r: number, v: number) => {
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++)
      for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const cover = Math.max(0, Math.min(1, r + 0.5 - Math.hypot(x - cx, y - cy)));
        data[y * W + x] = Math.round(data[y * W + x] * (1 - cover) + v * cover);
      }
  };
  const t = (frame - impactFrame) / 30;
  if (t <= 0) disc(BALL.x, BALL.y, 4, 240);
  else {
    // Interpolate between flight samples (they're 0.1 s apart; frames are 1/30 s).
    const i = Math.min(tf.air.length - 1.001, t / tf.dt);
    const lo = tf.air[Math.floor(i)];
    const hi = tf.air[Math.floor(i) + 1];
    const k = i - Math.floor(i);
    const a = { d: lo.d + (hi.d - lo.d) * k, h: lo.h + (hi.h - lo.h) * k, l: lo.l + (hi.l - lo.l) * k };
    const p = projectBehind(cal, a);
    const z = a.d * 0.9144 + cal.backM;
    disc(p.x, p.y, Math.max(1.2, (4 * cal.backM) / z), 235);
  }
  return { width: W, height: H, data };
}

describe('detectLaunchBehind', () => {
  beforeEach(() => use(LANDSCAPE));

  it.each([
    ['landscape', -5],
    ['landscape', 0],
    ['landscape', 6],
    ['portrait, close', -4],
    ['portrait, close', 5],
  ] as const)('%s: recovers a %s° start line', (layout, startDeg) => {
    use(layout === 'landscape' ? LANDSCAPE : PORTRAIT);
    const frames = Array.from({ length: 20 }, (_, i) => render(i, 10, startDeg));
    const ball = locateBall(frames[0], { x: BALL.x + 2, y: BALL.y - 1 }, 15, { minRadius: 1.5 })!;
    expect(ball).toBeDefined();
    const res = detectLaunchBehind(frames, ball, TARGET);
    expect(res).toBeDefined();
    expect(res!.impactIndex).toBe(10);
    const cal = calibrateBehind(ball, TARGET, W, H)!;
    const est = startAngleFromSighting(cal, defaultShape(160).launchDeg, res!.sighting);
    expect(Math.abs(est - startDeg)).toBeLessThan(1.5);
  });

  it('returns nothing when the ball never leaves', () => {
    const frames = Array.from({ length: 20 }, (_, i) => render(i, 99, 0));
    const ball = locateBall(frames[0], BALL, 15, { minRadius: 1.5 })!;
    expect(detectLaunchBehind(frames, ball, TARGET)).toBeUndefined();
  });
});
