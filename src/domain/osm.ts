/**
 * Turns public OpenStreetMap golf data into the app's Course model.
 *
 * Golf courses in OSM are mapped with `leisure=golf_course` for the course boundary and
 * `golf=*` for the features inside it: `golf=hole` (a line from tee to green, tagged with
 * `ref` = hole number, `par`, `handicap`), `golf=green`, `golf=tee`, `golf=bunker`,
 * `golf=water_hazard` / `golf=lateral_water_hazard`, `golf=fairway`, and so on.
 * See https://wiki.openstreetmap.org/wiki/Tag:leisure%3Dgolf_course
 *
 * OSM data is © OpenStreetMap contributors and licensed under the ODbL, so the app must show
 * that attribution wherever course data is displayed.
 */
import { centroid, distanceMeters, distanceMiles, pathLengthYards } from './geo';
import type { Course, CourseSummary, Hazard, Hole, LatLng } from './types';

// ---- Overpass JSON shapes (only the fields we use) ----

interface OverpassGeomPoint {
  lat: number;
  lon: number;
}

export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags?: Record<string, string>;
  lat?: number;
  lon?: number;
  center?: OverpassGeomPoint;
  geometry?: OverpassGeomPoint[];
  members?: { type: string; role: string; geometry?: OverpassGeomPoint[] }[];
}

export interface OverpassResponse {
  elements: OverpassElement[];
}

// ---- Queries ----

export function nearbyCoursesQuery(center: LatLng, radiusMeters: number): string {
  const { latitude: lat, longitude: lon } = center;
  const r = Math.round(radiusMeters);
  return `[out:json][timeout:25];
(
  way["leisure"="golf_course"](around:${r},${lat},${lon});
  relation["leisure"="golf_course"](around:${r},${lat},${lon});
);
out center tags;`;
}

/** `source` is "openstreetmap:way/123" or "openstreetmap:relation/456". */
export function parseSource(source: string): { type: 'way' | 'relation'; id: number } | undefined {
  const m = /^openstreetmap:(way|relation)\/(\d+)$/.exec(source);
  if (!m) return undefined;
  return { type: m[1] as 'way' | 'relation', id: Number(m[2]) };
}

export function courseDetailQuery(source: string): string {
  const ref = parseSource(source);
  if (!ref) throw new Error(`Unsupported course source: ${source}`);
  return `[out:json][timeout:60];
${ref.type}(${ref.id})->.course;
.course out center tags;
.course map_to_area->.area;
(
  way["golf"](area.area);
  node["golf"](area.area);
  relation["golf"](area.area);
);
out geom tags;`;
}

// ---- Parsing ----

const toLatLng = (p: OverpassGeomPoint): LatLng => ({ latitude: p.lat, longitude: p.lon });

function elementPoint(el: OverpassElement): LatLng | undefined {
  if (el.lat !== undefined && el.lon !== undefined) return { latitude: el.lat, longitude: el.lon };
  if (el.center) return toLatLng(el.center);
  const shape = elementShape(el);
  return shape.length > 0 ? centroid(shape) : undefined;
}

function elementShape(el: OverpassElement): LatLng[] {
  if (el.geometry) return el.geometry.map(toLatLng);
  if (el.members) {
    const outer = el.members.find((m) => m.role === 'outer' && m.geometry) ?? el.members.find((m) => m.geometry);
    if (outer?.geometry) return outer.geometry.map(toLatLng);
  }
  if (el.lat !== undefined && el.lon !== undefined) return [{ latitude: el.lat, longitude: el.lon }];
  return [];
}

/** URL-safe id for a course source, e.g. "osm-way-123", so it can be used in routes. */
export function courseIdFor(source: string): string {
  return source.replace(/^openstreetmap:/, 'osm-').replace(/[^A-Za-z0-9]+/g, '-');
}

export function sourceFor(el: Pick<OverpassElement, 'type' | 'id'>): string {
  return `openstreetmap:${el.type}/${el.id}`;
}

function formatAddress(tags: Record<string, string>): string | undefined {
  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  const parts = [street, tags['addr:city'], tags['addr:state']].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

export function parseCourseSearch(res: OverpassResponse, from?: LatLng): CourseSummary[] {
  const out: CourseSummary[] = [];
  for (const el of res.elements) {
    if (el.tags?.leisure !== 'golf_course') continue;
    const location = elementPoint(el);
    if (!location) continue;
    out.push({
      source: sourceFor(el),
      name: el.tags.name ?? 'Unnamed golf course',
      location,
      distanceMiles: from ? Math.round(distanceMiles(from, location) * 10) / 10 : undefined,
    });
  }
  return out.sort((a, b) => (a.distanceMiles ?? 0) - (b.distanceMiles ?? 0));
}

/** Local planar projection (metres) around a reference point. Good enough within a course. */
function projector(ref: LatLng) {
  const kx = 111_320 * Math.cos((ref.latitude * Math.PI) / 180);
  const ky = 110_540;
  return (p: LatLng) => ({ x: (p.longitude - ref.longitude) * kx, y: (p.latitude - ref.latitude) * ky });
}

/** Shortest distance in metres from a point to a polyline. */
export function distanceToPathMeters(p: LatLng, path: LatLng[]): number {
  if (path.length === 0) return Infinity;
  if (path.length === 1) return distanceMeters(p, path[0]);
  const proj = projector(p);
  const P = proj(p);
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const A = proj(path[i - 1]);
    const B = proj(path[i]);
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((P.x - A.x) * dx + (P.y - A.y) * dy) / len2));
    const cx = A.x + t * dx - P.x;
    const cy = A.y + t * dy - P.y;
    best = Math.min(best, Math.sqrt(cx * cx + cy * cy));
  }
  return best;
}

export function pointInPolygon(p: LatLng, polygon: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].longitude;
    const yi = polygon[i].latitude;
    const xj = polygon[j].longitude;
    const yj = polygon[j].latitude;
    const intersects =
      yi > p.latitude !== yj > p.latitude && p.longitude < ((xj - xi) * (p.latitude - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** How far (m) a feature may be from a hole's line and still belong to that hole. */
const GREEN_MATCH_M = 45;
const TEE_MATCH_M = 60;
const HAZARD_MATCH_M = 40;

interface Feature {
  shape: LatLng[];
  point: LatLng;
}

function nearestFeature(target: LatLng, features: Feature[], maxMeters: number): Feature | undefined {
  let best: Feature | undefined;
  let bestD = Infinity;
  for (const f of features) {
    const d =
      f.shape.length >= 3 && pointInPolygon(target, f.shape) ? 0 : distanceToPathMeters(target, f.shape);
    if (d < bestD) {
      best = f;
      bestD = d;
    }
  }
  return bestD <= maxMeters ? best : undefined;
}

function toInt(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Build a Course from an Overpass `courseDetailQuery` response.
 * Holes are taken from `golf=hole` lines; greens, tees and hazards are attached to the hole
 * whose line they sit closest to.
 */
export function parseCourseDetail(res: OverpassResponse, source: string, now = new Date()): Course {
  const ref = parseSource(source);
  const courseEl = res.elements.find((e) => ref && e.type === ref.type && e.id === ref.id);
  const tags = courseEl?.tags ?? {};

  const features = (pred: (t: Record<string, string>) => boolean): Feature[] =>
    res.elements
      .filter((e) => e.tags && pred(e.tags))
      .map((e) => ({ shape: elementShape(e), point: elementPoint(e) }))
      .filter((f): f is Feature => f.point !== undefined && f.shape.length > 0);

  const greens = features((t) => t.golf === 'green');
  const tees = features((t) => t.golf === 'tee');
  const bunkers = features((t) => t.golf === 'bunker');
  const water = features((t) => t.golf === 'water_hazard' || t.golf === 'lateral_water_hazard');

  const holeEls = res.elements.filter((e) => e.tags?.golf === 'hole' && e.geometry && e.geometry.length >= 2);
  const holes: Hole[] = [];
  for (const el of holeEls) {
    const t = el.tags!;
    const number = toInt(t.ref);
    if (number === undefined) continue;
    const path = el.geometry!.map(toLatLng);
    const start = path[0];
    const end = path[path.length - 1];

    const green = nearestFeature(end, greens, GREEN_MATCH_M);
    const holeTees = tees.filter((f) => distanceToPathMeters(start, f.shape) <= TEE_MATCH_M).map((f) => f.point);
    const near = (f: Feature) => f.shape.some((p) => distanceToPathMeters(p, path) <= HAZARD_MATCH_M);
    const hazards: Hazard[] = [
      ...bunkers.filter(near).map((f) => ({ kind: 'bunker' as const, outline: f.shape })),
      ...water.filter(near).map((f) => ({ kind: 'water' as const, outline: f.shape })),
    ];

    holes.push({
      number,
      par: toInt(t.par),
      handicap: toInt(t.handicap),
      yards: Math.round(pathLengthYards(path)),
      tees: holeTees.length > 0 ? holeTees : [start],
      green: green && green.shape.length >= 3 ? green.shape : undefined,
      greenCenter: green?.point ?? end,
      path,
      hazards,
    });
  }

  // Some courses map the same hole twice (e.g. two nines sharing numbers); keep the first.
  const seen = new Set<number>();
  const unique = holes
    .sort((a, b) => a.number - b.number)
    .filter((h) => (seen.has(h.number) ? false : (seen.add(h.number), true)));

  const location =
    (courseEl && elementPoint(courseEl)) ?? unique[0]?.tees[0] ?? { latitude: 0, longitude: 0 };

  return {
    id: courseIdFor(source),
    name: tags.name ?? 'Unnamed golf course',
    source,
    location,
    address: formatAddress(tags),
    holes: unique,
    importedAt: now.toISOString(),
  };
}
