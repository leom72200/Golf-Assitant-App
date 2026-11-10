/**
 * Pulls individual frames out of a recorded clip and turns them into small grayscale images
 * for the tracker, using only stock Expo modules:
 *
 *   expo-video  generateThumbnailsAsync  (exact frame, scaled down natively)
 *   -> expo-image-manipulator  rotate upright + crop to the analysis region
 *   -> JPEG (base64) -> jpeg-js -> luma
 *
 * Coordinates: "analysis space" is the upright frame scaled so its width is ANALYSIS_WIDTH.
 */
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { createVideoPlayer, type VideoPlayer } from 'expo-video';

import { base64ToBytes, jpegToGray } from '@/domain/frameDecode';
import type { GrayFrame, Rect } from '@/domain/tracking';

/** Analysis frames are this wide (upright). ~640 keeps a ball ~6 px in radius at 2 m. */
export const ANALYSIS_WIDTH = 640;

export interface ClipGeometry {
  /** Recorded (sensor-orientation) size. */
  width: number;
  height: number;
  /** Degrees clockwise to make frames upright. */
  rotation: number;
  fps: number;
}

/** Size of the upright analysis-space frame. */
export function analysisSize(g: ClipGeometry) {
  const sideways = g.rotation % 180 !== 0;
  const uprightW = sideways ? g.height : g.width;
  const uprightH = sideways ? g.width : g.height;
  const scale = ANALYSIS_WIDTH / uprightW;
  return { width: ANALYSIS_WIDTH, height: Math.round(uprightH * scale), scale };
}

export class ClipFrames {
  private player: VideoPlayer;

  constructor(
    private uri: string,
    private geometry: ClipGeometry,
  ) {
    this.player = createVideoPlayer(uri);
  }

  /** Thumbnail size limits in the recorded orientation, so rotation then gives analysis size. */
  private thumbLimits() {
    const { scale } = analysisSize(this.geometry);
    return {
      maxWidth: Math.round(this.geometry.width * scale),
      maxHeight: Math.round(this.geometry.height * scale),
    };
  }

  /**
   * Decode frames (by index) cropped to `region`. The region is in analysis space, or in
   * full-resolution upright pixels when `fullRes` is set (used for precise calibration).
   */
  async gray(frames: number[], region: Rect, fullRes = false): Promise<GrayFrame[]> {
    const times = frames.map((f) => f / this.geometry.fps);
    const thumbs = await this.player.generateThumbnailsAsync(times, fullRes ? undefined : this.thumbLimits());
    const out: GrayFrame[] = [];
    for (const thumb of thumbs) {
      const ctx = ImageManipulator.manipulate(thumb);
      if (this.geometry.rotation) ctx.rotate(this.geometry.rotation);
      ctx.crop({ originX: region.x, originY: region.y, width: region.width, height: region.height });
      const img = await ctx.renderAsync();
      const saved = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.92, base64: true });
      out.push(jpegToGray(base64ToBytes(saved.base64 ?? '')));
      img.release();
      ctx.release();
      thumb.release();
      // The saved JPEG file isn't needed; only the base64 data is used.
      deleteQuietly(saved.uri);
    }
    return out;
  }

  /**
   * A full upright frame in analysis space, as an image file to show the user (setup / aim)
   * and as grayscale for finding the ball.
   */
  async still(frame: number): Promise<{ uri: string; gray: GrayFrame }> {
    const [thumb] = await this.player.generateThumbnailsAsync([frame / this.geometry.fps], this.thumbLimits());
    const ctx = ImageManipulator.manipulate(thumb);
    if (this.geometry.rotation) ctx.rotate(this.geometry.rotation);
    const img = await ctx.renderAsync();
    const saved = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.9, base64: true });
    img.release();
    ctx.release();
    thumb.release();
    return { uri: saved.uri, gray: jpegToGray(base64ToBytes(saved.base64 ?? '')) };
  }

  /** Clip length in seconds (0 until the player has read the file). */
  get duration(): number {
    return this.player.duration || 0;
  }

  release(deleteFile = true) {
    this.player.release();
    if (deleteFile) deleteQuietly(this.uri);
  }
}

export function deleteQuietly(uri: string | undefined) {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Already gone, or not ours to delete.
  }
}
