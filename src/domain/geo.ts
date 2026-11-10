import type { LatLng } from './types';

const EARTH_RADIUS_M = 6_371_008.8;
export const METERS_PER_YARD = 0.9144;

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Great-circle distance in metres (haversine). Accurate to well under a yard at golf scales. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function distanceYards(a: LatLng, b: LatLng): number {
  return distanceMeters(a, b) / METERS_PER_YARD;
}

export function distanceMiles(a: LatLng, b: LatLng): number {
  return distanceMeters(a, b) / 1609.344;
}

/** Initial bearing from a to b in degrees, 0 = north, clockwise. */
export function bearing(a: LatLng, b: LatLng): number {
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Area-weighted centroid of a small polygon (treated as planar, fine for a green or bunker). */
export function centroid(points: LatLng[]): LatLng | undefined {
  if (points.length === 0) return undefined;
  const pts = closeRing(points);
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const x0 = pts[i].longitude;
    const y0 = pts[i].latitude;
    const x1 = pts[i + 1].longitude;
    const y1 = pts[i + 1].latitude;
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(area) < 1e-14) {
    // Degenerate (a line or a single point): fall back to the vertex average.
    const unique = points;
    return {
      latitude: unique.reduce((s, p) => s + p.latitude, 0) / unique.length,
      longitude: unique.reduce((s, p) => s + p.longitude, 0) / unique.length,
    };
  }
  area /= 2;
  return { latitude: cy / (6 * area), longitude: cx / (6 * area) };
}

function closeRing(points: LatLng[]): LatLng[] {
  const first = points[0];
  const last = points[points.length - 1];
  if (first.latitude === last.latitude && first.longitude === last.longitude) return points;
  return [...points, first];
}

export interface GreenDistances {
  front: number;
  center: number;
  back: number;
}

/**
 * Front / centre / back yardages to a green from the player's position.
 * Front and back are the nearest and farthest points of the green outline; without an outline
 * all three equal the centre distance.
 */
export function greenDistances(from: LatLng, center: LatLng, outline?: LatLng[]): GreenDistances {
  const c = distanceYards(from, center);
  if (!outline || outline.length < 3) return { front: c, center: c, back: c };
  const ds = outline.map((p) => distanceYards(from, p));
  return { front: Math.min(...ds), center: c, back: Math.max(...ds) };
}

/** Total length of a polyline in yards. */
export function pathLengthYards(path: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += distanceYards(path[i - 1], path[i]);
  return total;
}

/** Bounding box that fits all points, padded by a fraction of its size. */
export function regionFor(points: LatLng[], padding = 0.25) {
  if (points.length === 0) return undefined;
  const lats = points.map((p) => p.latitude);
  const lons = points.map((p) => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const latDelta = Math.max((maxLat - minLat) * (1 + padding * 2), 0.002);
  const lonDelta = Math.max((maxLon - minLon) * (1 + padding * 2), 0.002);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta: latDelta,
    longitudeDelta: lonDelta,
  };
}
