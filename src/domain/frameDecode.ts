/**
 * Turns a JPEG (as base64, which is what the image manipulator hands back) into a grayscale
 * frame for the tracker. Pure JS, so it behaves the same on the phone and in tests.
 */
import { decode } from 'jpeg-js';

import type { GrayFrame } from './tracking';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = (() => {
  const t = new Uint8Array(256).fill(255);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  t['-'.charCodeAt(0)] = 62; // url-safe variants
  t['_'.charCodeAt(0)] = 63;
  return t;
})();

/** Base64 -> bytes without relying on atob/Buffer (not guaranteed in every JS engine). */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^,]*,/, '').replace(/[^A-Za-z0-9+/\-_]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = LOOKUP[clean.charCodeAt(i)];
    if (v === 255) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

/** Decode a JPEG into luma (Rec. 601 weights). */
export function jpegToGray(bytes: Uint8Array): GrayFrame {
  const img = decode(bytes, { useTArray: true, formatAsRGBA: false, maxMemoryUsageInMB: 256 });
  const n = img.width * img.height;
  const data = new Uint8Array(n);
  const src = img.data;
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    data[i] = (src[j] * 77 + src[j + 1] * 150 + src[j + 2] * 29) >> 8;
  }
  return { width: img.width, height: img.height, data };
}
