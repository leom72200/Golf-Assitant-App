import { simulateFlight } from '../launch';
import { downTheLineView, extendToEdge, flightPath3d, partialPolyline } from '../tracerProjection';

describe('down-the-line tracer view', () => {
  const W = 360;
  const H = 220;
  const shots = [
    ['driver', { ballSpeedMph: 165, launchAngleDeg: 11, spinRpm: 2600 }],
    ['wedge', { ballSpeedMph: 90, launchAngleDeg: 30, spinRpm: 9000 }],
  ] as const;

  it.each(shots)('%s stays inside the view and starts near the bottom', (_, input) => {
    const flight = simulateFlight(input);
    const { air, roll } = flightPath3d(flight, 12);
    const view = downTheLineView([...air, ...roll], W, H);
    const pts = [...air, ...roll].map(view.project);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(W);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(H);
    }
    expect(pts[0].y).toBeGreaterThan(H * 0.6); // ball at the bottom
    expect(Math.min(...pts.map((p) => p.y))).toBeLessThan(view.horizonY); // rises above the horizon
    // Lands on the ground, below the horizon, and curves right for a positive offline.
    const landing = view.project(air[air.length - 1]);
    expect(landing.y).toBeGreaterThan(view.horizonY);
    const straight = downTheLineView([...flightPath3d(flight, 0).air], W, H);
    expect(landing.x).toBeGreaterThan(straight.project(flightPath3d(flight, 0).air.at(-1)!).x);
  });

  it('a straight shot heads towards the centre of the view and rises well above the horizon', () => {
    const { air } = flightPath3d(simulateFlight({ ballSpeedMph: 120, launchAngleDeg: 16, spinRpm: 6500 }));
    const view = downTheLineView(air, W, H);
    const pts = air.map(view.project);
    const landing = pts[pts.length - 1];
    expect(Math.abs(landing.x - W / 2)).toBeLessThan(Math.abs(pts[0].x - W / 2));
    // The apex reaches the upper part of the sky.
    expect(Math.min(...pts.map((p) => p.y))).toBeLessThan(view.horizonY * 0.6);
  });
});

describe('helpers', () => {
  it('extends a ray to the frame edge', () => {
    expect(extendToEdge({ x: 100, y: 100 }, 10, -5, 400, 300)).toEqual({ x: 300, y: 0 });
    expect(extendToEdge({ x: 100, y: 100 }, -10, 0, 400, 300)).toEqual({ x: 0, y: 100 });
  });

  it('cuts a polyline part-way', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ];
    expect(partialPolyline(line, 0.75)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 15, y: 0 }]);
    expect(partialPolyline(line, 1)).toEqual(line);
  });
});
