/**
 * Network access to public OpenStreetMap services for finding and downloading courses.
 *  - Overpass API: nearby search + full course geometry.
 *  - Nominatim: search by course name.
 * Both are free community services with fair-use policies; keep requests user-initiated.
 */
import {
  courseDetailQuery,
  nearbyCoursesQuery,
  parseCourseDetail,
  parseCourseSearch,
  type OverpassResponse,
} from '@/domain/osm';
import { distanceMiles } from '@/domain/geo';
import type { Course, CourseSummary, LatLng } from '@/domain/types';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const CLIENT_HEADERS = { 'User-Agent': 'GolfAssistantApp/0.1 (open-source golf companion)' };

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function overpass(query: string, timeoutMs = 45_000): Promise<OverpassResponse> {
  let lastError: unknown;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetchWithTimeout(
        endpoint,
        {
          method: 'POST',
          headers: { ...CLIENT_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(query)}`,
        },
        timeoutMs,
      );
      if (!res.ok) throw new Error(`Overpass returned ${res.status}`);
      return (await res.json()) as OverpassResponse;
    } catch (e) {
      lastError = e; // try the next mirror
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Course service unavailable');
}

export async function findCoursesNear(center: LatLng, radiusMiles = 15): Promise<CourseSummary[]> {
  const res = await overpass(nearbyCoursesQuery(center, radiusMiles * 1609.344), 30_000);
  return parseCourseSearch(res, center);
}

interface NominatimHit {
  osm_type: 'node' | 'way' | 'relation';
  osm_id: number;
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  type: string;
  category?: string;
  class?: string;
}

export async function searchCoursesByName(query: string, near?: LatLng): Promise<CourseSummary[]> {
  const params = new URLSearchParams({ q: `${query} golf`, format: 'jsonv2', limit: '20' });
  const res = await fetchWithTimeout(`${NOMINATIM}?${params}`, { headers: CLIENT_HEADERS }, 20_000);
  if (!res.ok) throw new Error(`Search returned ${res.status}`);
  const hits = (await res.json()) as NominatimHit[];
  return hits
    .filter((h) => h.type === 'golf_course' && h.osm_type !== 'node')
    .map((h) => {
      const location = { latitude: Number(h.lat), longitude: Number(h.lon) };
      return {
        source: `openstreetmap:${h.osm_type}/${h.osm_id}`,
        name: h.name || h.display_name.split(',')[0],
        location,
        distanceMiles: near ? Math.round(distanceMiles(near, location) * 10) / 10 : undefined,
      };
    });
}

export async function downloadCourse(source: string): Promise<Course> {
  const res = await overpass(courseDetailQuery(source));
  return parseCourseDetail(res, source);
}
