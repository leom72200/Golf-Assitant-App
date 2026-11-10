import {
  courseDetailQuery,
  nearbyCoursesQuery,
  parseCourseDetail,
  parseCourseSearch,
  pointInPolygon,
  type OverpassResponse,
} from '../osm';

const box = (lat: number, lon: number, d = 0.0001) => [
  { lat: lat - d, lon: lon - d },
  { lat: lat - d, lon: lon + d },
  { lat: lat + d, lon: lon + d },
  { lat: lat + d, lon: lon - d },
  { lat: lat - d, lon: lon - d },
];

// A tiny two-hole course in the shape Overpass returns for `out geom tags`.
const detail: OverpassResponse = {
  elements: [
    {
      type: 'way',
      id: 100,
      center: { lat: 40.002, lon: -75.0 },
      tags: { leisure: 'golf_course', name: 'Test Links', 'addr:city': 'Springfield', 'addr:state': 'PA' },
    },
    {
      type: 'way',
      id: 1,
      tags: { golf: 'hole', ref: '1', par: '4', handicap: '5' },
      geometry: [
        { lat: 40.0, lon: -75.0 },
        { lat: 40.002, lon: -75.0 },
        { lat: 40.0035, lon: -75.0 },
      ],
    },
    {
      type: 'way',
      id: 2,
      tags: { golf: 'hole', ref: '2', par: '3' },
      geometry: [
        { lat: 40.004, lon: -75.001 },
        { lat: 40.004, lon: -75.0025 },
      ],
    },
    { type: 'way', id: 10, tags: { golf: 'green' }, geometry: box(40.0035, -75.0) },
    { type: 'way', id: 11, tags: { golf: 'green' }, geometry: box(40.004, -75.0025) },
    { type: 'node', id: 20, tags: { golf: 'tee' }, lat: 40.0, lon: -75.0001 },
    { type: 'way', id: 30, tags: { golf: 'bunker' }, geometry: box(40.0034, -75.0002, 0.00003) },
    { type: 'way', id: 31, tags: { golf: 'water_hazard' }, geometry: box(40.01, -75.01) }, // far away
  ],
};

describe('osm queries', () => {
  it('builds a nearby search query', () => {
    const q = nearbyCoursesQuery({ latitude: 40, longitude: -75 }, 16093.4);
    expect(q).toContain('around:16093,40,-75');
    expect(q).toContain('"leisure"="golf_course"');
  });

  it('builds a detail query from a source id', () => {
    expect(courseDetailQuery('openstreetmap:way/123')).toContain('way(123)');
    expect(() => courseDetailQuery('somewhere-else')).toThrow();
  });
});

describe('parseCourseSearch', () => {
  it('lists courses nearest first', () => {
    const res: OverpassResponse = {
      elements: [
        { type: 'way', id: 1, center: { lat: 40.1, lon: -75 }, tags: { leisure: 'golf_course', name: 'Far' } },
        { type: 'relation', id: 2, center: { lat: 40.01, lon: -75 }, tags: { leisure: 'golf_course', name: 'Near' } },
        { type: 'node', id: 3, lat: 40, lon: -75, tags: { shop: 'golf' } },
      ],
    };
    const list = parseCourseSearch(res, { latitude: 40, longitude: -75 });
    expect(list.map((c) => c.name)).toEqual(['Near', 'Far']);
    expect(list[0].source).toBe('openstreetmap:relation/2');
    expect(list[0].distanceMiles).toBeCloseTo(0.7, 1);
  });
});

describe('parseCourseDetail', () => {
  const course = parseCourseDetail(detail, 'openstreetmap:way/100', new Date('2026-01-01T00:00:00Z'));

  it('reads course metadata', () => {
    expect(course.id).toBe('osm-way-100');
    expect(course.name).toBe('Test Links');
    expect(course.address).toBe('Springfield, PA');
    expect(course.holes.map((h) => h.number)).toEqual([1, 2]);
  });

  it('attaches greens, tees and nearby hazards to the right hole', () => {
    const [h1, h2] = course.holes;
    expect(h1.par).toBe(4);
    expect(h1.handicap).toBe(5);
    expect(h1.green).toHaveLength(5);
    expect(h1.greenCenter!.latitude).toBeCloseTo(40.0035, 4);
    expect(h1.tees[0]).toEqual({ latitude: 40.0, longitude: -75.0001 });
    expect(h1.hazards.map((h) => h.kind)).toEqual(['bunker']);
    expect(h1.yards).toBeGreaterThan(420); // 0.0035° lat ≈ 389 m ≈ 426 yd
    expect(h1.yards).toBeLessThan(432);

    expect(h2.par).toBe(3);
    expect(h2.greenCenter!.longitude).toBeCloseTo(-75.0025, 4);
    // No mapped tee near hole 2, so the start of the hole line is used.
    expect(h2.tees[0]).toEqual({ latitude: 40.004, longitude: -75.001 });
    expect(h2.hazards).toHaveLength(0);
  });
});

describe('pointInPolygon', () => {
  it('detects containment', () => {
    const poly = box(0, 0, 1).map((p) => ({ latitude: p.lat, longitude: p.lon }));
    expect(pointInPolygon({ latitude: 0, longitude: 0 }, poly)).toBe(true);
    expect(pointInPolygon({ latitude: 2, longitude: 0 }, poly)).toBe(false);
  });
});
