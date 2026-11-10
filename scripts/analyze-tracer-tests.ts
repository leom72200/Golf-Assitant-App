/**
 * Offline analysis of Shot Tracer field tests (the report + clips exported from the app's
 * Tracer tests screen). For each test it:
 *   - re-runs start-line detection on the real frames (decoded with ffmpeg, scaled like the app),
 *   - compares it with what the app found and what the player said happened,
 *   - writes a contact sheet of the frames around impact so a human (or Claude) can look.
 *
 * Usage:  npx tsx scripts/analyze-tracer-tests.ts <report.json> [clipsDir] [outDir]
 *         (clipsDir defaults to the report's folder; add --autorotate to let ffmpeg apply
 *          the video's rotation metadata if the coordinates look rotated)
 * Needs ffmpeg on PATH.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { calibrateBehind, startAngleFromSighting } from '../src/domain/behindCamera';
import { detectLaunchBehind } from '../src/domain/behindDetect';
import { jpegToGray } from '../src/domain/frameDecode';
import type { TracerTestRecord } from '../src/domain/tracerTests';
import { locateBall, type GrayFrame } from '../src/domain/tracking';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const autorotate = process.argv.includes('--autorotate');
const [reportPath, clipsArg, outArg] = args;
if (!reportPath) {
  console.error('Usage: npx tsx scripts/analyze-tracer-tests.ts <report.json> [clipsDir] [outDir]');
  process.exit(1);
}
const report = JSON.parse(readFileSync(reportPath, 'utf8')) as { records: TracerTestRecord[]; summary: unknown };
const clipsDir = clipsArg ?? dirname(reportPath);
const outDir = outArg ?? join(dirname(reportPath), 'analysis');
mkdirSync(outDir, { recursive: true });

/** ffmpeg filter that mimics the app: optional rotation, then scale to the analysis size. */
function frameFilter(r: TracerTestRecord): string {
  const rot = r.video.rotation;
  const turn = rot === 90 ? 'transpose=1,' : rot === 180 ? 'hflip,vflip,' : rot === 270 ? 'transpose=2,' : '';
  return `${turn}scale=${r.analysis.width}:${r.analysis.height}`;
}

function frames(r: TracerTestRecord, clip: string, start: number, count: number, tmp: string): GrayFrame[] {
  mkdirSync(tmp, { recursive: true });
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', ...(autorotate ? [] : ['-noautorotate']),
    '-ss', String(Math.max(0, start / r.video.fps)), '-i', clip,
    '-vf', frameFilter(r), '-frames:v', String(count), '-q:v', '3', join(tmp, 'f%03d.jpg'),
  ]);
  const out: GrayFrame[] = [];
  for (let i = 1; i <= count; i++) {
    const f = join(tmp, `f${String(i).padStart(3, '0')}.jpg`);
    if (existsSync(f)) out.push(jpegToGray(new Uint8Array(readFileSync(f))));
  }
  return out;
}

const rows: string[] = [];
for (const r of report.records) {
  const clip = join(clipsDir, r.videoFile);
  const label = `${r.id} (${r.final.clubId})`;
  if (!existsSync(clip)) {
    rows.push(`${label}: clip not found, skipped`);
    continue;
  }
  const center = Math.round(r.detection.impactFromAudioSec * r.video.fps);
  const half = Math.round(0.5 * r.video.fps);
  const imgs = frames(r, clip, center - half, half * 2 + 1, join(outDir, `frames-${r.id}`));

  // Re-run detection with the recorded aim.
  const near = r.aim.ball;
  let ball = undefined as ReturnType<typeof locateBall>;
  for (const img of imgs) {
    ball = locateBall(img, near, Math.max(12, near.radius * 6), { minRadius: 1.5, maxRadius: Math.max(6, near.radius * 2) });
    if (ball) break;
  }
  let redo = 'ball not found';
  if (ball) {
    const res = detectLaunchBehind(imgs, ball, r.aim.target);
    const cal = calibrateBehind(ball, r.aim.target, r.analysis.width, r.analysis.height);
    if (res && cal) {
      const start = startAngleFromSighting(cal, r.final.launchDeg, res.sighting);
      redo = `impact frame ${center - half + res.impactIndex}, sighting (${res.sighting.x.toFixed(0)},${res.sighting.y.toFixed(0)}), start ${start.toFixed(1)}°`;
    } else {
      redo = 'ball found, launch not seen';
    }
  }
  // Contact sheet: 24 frames around impact, straight from the video.
  const sheet = join(outDir, `sheet-${r.id}.jpg`);
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', ...(autorotate ? [] : ['-noautorotate']),
    '-ss', String(Math.max(0, (center - 8) / r.video.fps)), '-i', clip,
    '-vf', `${frameFilter(r)},scale=320:-2,tile=6x4`, '-frames:v', '1', '-q:v', '3', sheet,
  ]);
  rows.push(
    `${label}: app → ${r.detection.startDeg !== undefined ? `${r.detection.startDeg.toFixed(1)}°` : 'no start'}; ` +
      `re-run → ${redo}; player set ${r.final.startDeg.toFixed(1)}°, curve ${r.final.curveYards} yds, carry ${r.final.carryYards}` +
      `${r.notes.landedYards !== undefined ? ` (landed ${r.notes.landedYards})` : ''}${r.notes.shape ? `, ${r.notes.shape}` : ''}` +
      `${r.notes.matched ? `, matched: ${r.notes.matched}` : ''}`,
  );
}

const summaryText = `Summary: ${JSON.stringify(report.summary)}\n\n${rows.join('\n')}\n`;
writeFileSync(join(outDir, 'results.txt'), summaryText);
console.log(summaryText);
console.log(`Contact sheets and frames written to ${outDir}`);
