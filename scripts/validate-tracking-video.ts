/**
 * End-to-end check of the practice-mode analysis on a REAL encoded video, closer to what the
 * phone does than the unit tests:
 *
 *   render 1080p 240 fps swings -> H.264 encode (ffmpeg, phone-like bitrate) -> decode single
 *   frames -> downscale -> crop to the analysis region -> JPEG -> jpeg-js -> tracker
 *
 * Run with:  npx tsx scripts/validate-tracking-video.ts
 * Needs ffmpeg with libx264 on PATH.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defaultScene, renderFrame, type SwingScene } from '../src/domain/__tests__/helpers/syntheticSwing';
import { jpegToGray } from '../src/domain/frameDecode';
import { analyzeShot } from '../src/domain/shotAnalyzer';
import { analysisRegion, locateBall, type BallFix } from '../src/domain/tracking';

const FULL_W = 1920;
const FULL_H = 1080;
// Same downscale the app uses: analysis frames are at most ~640 px wide.
const SCALE = 1 / 3;

function encode(scene: SwingScene, dir: string, frames: number): string {
  const out = join(dir, 'clip.mp4');
  const raw = Buffer.alloc(FULL_W * FULL_H * frames);
  for (let f = 0; f < frames; f++) Buffer.from(renderFrame(scene, f).data).copy(raw, f * FULL_W * FULL_H);
  const res = spawnSync(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${FULL_W}x${FULL_H}`, '-r', '240', '-i', '-',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-b:v', '40M', '-g', '240', out],
    { input: raw, maxBuffer: 1 << 30 },
  );
  if (res.status !== 0) throw new Error(`ffmpeg encode failed: ${res.stderr}`);
  return out;
}

/** Like the app: exact frame -> scaled -> cropped to the region -> JPEG -> gray. */
function extract(clip: string, dir: string, frame: number, region: { x: number; y: number; width: number; height: number }) {
  const file = join(dir, `f${frame}.jpg`);
  const sw = Math.round(FULL_W * SCALE);
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-i', clip,
    '-vf', `select=eq(n\\,${frame}),scale=${sw}:-2,crop=${region.width}:${region.height}:${region.x}:${region.y}`,
    '-frames:v', '1', '-q:v', '3', file,
  ]);
  return jpegToGray(new Uint8Array(readFileSync(file)));
}

async function run(name: string, over: Partial<SwingScene>) {
  const scene = defaultScene({ width: FULL_W, height: FULL_H, ball: { x: 480, y: 880, radius: 18.6 }, ...over });
  const dir = mkdtempSync(join(tmpdir(), 'swing-'));
  try {
    const frameCount = 240;
    const clip = encode(scene, dir, frameCount);

    // Setup: user taps the ball on a full-frame still (scaled like the app's setup image).
    const full = { x: scene.ball.x * SCALE, y: scene.ball.y * SCALE, radius: scene.ball.radius * SCALE };
    const region = analysisRegion(full, Math.round(FULL_W * SCALE), Math.round(FULL_H * SCALE), scene.direction);
    const setupImg = extract(clip, dir, 10, region);
    const ball = locateBall(setupImg, { x: full.x - region.x + 2, y: full.y - region.y - 2 }, 20) as BallFix;
    if (!ball) throw new Error('setup: ball not found');

    const t0 = Date.now();
    const res = await analyzeShot({
      fps: 240,
      frameCount,
      impactGuessFrame: scene.impactFrame + 10, // the sound is a bit late
      halfWindowFrames: 48,
      setup: { ball, direction: scene.direction },
      loadFrames: async (frames) => frames.map((f) => extract(clip, dir, f, region)),
    });
    const ms = Date.now() - t0;
    if (res.status !== 'ok') {
      console.log(`✗ ${name}: ${res.status} — ${res.reason}`);
      return false;
    }
    const speedErr = (res.measurement.ballSpeedMph / scene.ballSpeedMph - 1) * 100;
    const angleErr = res.measurement.launchAngleDeg - scene.launchDeg;
    const ok = Math.abs(speedErr) < 4 && Math.abs(angleErr) < 1.5;
    console.log(
      `${ok ? '✓' : '✗'} ${name.padEnd(18)} speed ${res.measurement.ballSpeedMph.toFixed(1)} mph (true ${scene.ballSpeedMph}, ${speedErr >= 0 ? '+' : ''}${speedErr.toFixed(1)}%)` +
        `  launch ${res.measurement.launchAngleDeg.toFixed(1)}° (true ${scene.launchDeg})  conf ${res.measurement.confidence}` +
        `  ${res.track.points.length} pts, ${res.framesDecoded} frames decoded, ${ms} ms incl. ffmpeg`,
    );
    return ok;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

(async () => {
  const cases: [string, Partial<SwingScene>][] = [
    ['driver', { ballSpeedMph: 150, launchDeg: 12 }],
    ['7 iron', { ballSpeedMph: 115, launchDeg: 18 }],
    ['pitching wedge', { ballSpeedMph: 95, launchDeg: 25 }],
    ['blurry driver', { ballSpeedMph: 160, launchDeg: 11, exposure: 0.6 }],
    ['left-handed view', { ballSpeedMph: 120, launchDeg: 16, direction: -1, ball: { x: 1440, y: 880, radius: 18.6 } }],
  ];
  let pass = 0;
  for (const [name, over] of cases) if (await run(name, over)) pass++;
  console.log(`\n${pass}/${cases.length} passed`);
  process.exit(pass === cases.length ? 0 : 1);
})();
