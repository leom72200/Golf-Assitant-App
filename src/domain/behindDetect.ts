/**
 * Finds the ball's first appearance after impact in behind-the-player video, which gives the
 * shot's start line. Works on consecutive grayscale frames around the impact.
 */
import type { Point2 } from './tracerProjection';
import { ballPresence, findCandidates, impactBracket, type BallFix, type GrayFrame } from './tracking';

export interface LaunchSighting {
  /** Index (into the given frames) of the last frame with the ball still at address. */
  impactIndex: number;
  /** Where the ball was first seen in flight. */
  sighting: Point2;
}

export function detectLaunchBehind(frames: GrayFrame[], ball: BallFix, target: Point2): LaunchSighting | undefined {
  const presence = frames.map((f, i) => ({ frame: i, presence: ballPresence(f, ball) }));
  const bracket = impactBracket(presence);
  if (!bracket) return undefined;
  const ref = frames[bracket.lastPresent];
  const toTarget = Math.atan2(target.y - ball.y, target.x - ball.x);
  const threshold = Math.max(12, (ball.ballLuma - ball.surroundLuma) * 0.25);

  const ballArea = Math.PI * ball.radius * ball.radius;
  const angleTo = (b: { cx: number; cy: number }) => Math.atan2(b.cy - ball.y, b.cx - ball.x);
  const angleDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

  // Candidates in the first few frames after the ball left: small, above the address, and
  // within a cone around the target line.
  const perFrame: { cx: number; cy: number; area: number; dist: number; angle: number }[][] = [];
  for (let i = bracket.lastPresent + 1; i <= Math.min(frames.length - 1, bracket.lastPresent + 4); i++) {
    const blobs = findCandidates(frames[i], frames[i - 1], ref, {
      radius: ball.radius,
      threshold,
      address: ball,
      direction: 1,
      anyDirection: true,
      // Flying away from the camera the ball is a dot of a few pixels within a frame or two.
      minArea: 2,
    });
    perFrame.push(
      blobs
        .map((b) => ({ ...b, dist: Math.hypot(b.cx - ball.x, b.cy - ball.y), angle: angleTo(b) }))
        .filter(
          (b) =>
            b.cy < ball.y - ball.radius &&
            b.dist > ball.radius * 2 &&
            b.dist < frames[i].height * 0.8 &&
            b.area < ballArea * 6 &&
            angleDiff(b.angle, toTarget) < (40 * Math.PI) / 180,
        ),
    );
  }

  // The ball moves AWAY from its address along (nearly) the same direction in consecutive
  // frames; a swinging arm or club head moves around the body instead.
  let best: { p: Point2; score: number } | undefined;
  for (let k = 0; k + 1 < perFrame.length; k++) {
    for (const a of perFrame[k]) {
      for (const b of perFrame[k + 1]) {
        if (b.dist < a.dist * 1.1) continue;
        const bend = angleDiff(a.angle, b.angle);
        if (bend > (10 * Math.PI) / 180) continue;
        const score = k * 0.5 + bend + angleDiff(a.angle, toTarget) * 0.2 + a.area / (ballArea * 30);
        if (!best || score < best.score) best = { p: { x: a.cx, y: a.cy }, score };
      }
    }
    if (best) break; // earliest consistent pair wins
  }
  if (best) return { impactIndex: bracket.lastPresent, sighting: best.p };
  return undefined;
}
