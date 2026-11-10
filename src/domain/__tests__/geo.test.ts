import { bearing, centroid, distanceYards, greenDistances, regionFor } from '../geo';

describe('geo', () => {
  it('measures distance in yards', () => {
    // 0.001° of latitude ≈ 111.2 m ≈ 121.6 yd
    const d = distanceYards({ latitude: 40, longitude: -75 }, { latitude: 40.001, longitude: -75 });
    expect(d).toBeGreaterThan(121);
    expect(d).toBeLessThan(122.5);
  });

  it('computes compass bearings', () => {
    expect(bearing({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 })).toBeCloseTo(0);
    expect(bearing({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 })).toBeCloseTo(90);
  });

  it('finds a polygon centroid', () => {
    const square = [
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 2 },
      { latitude: 2, longitude: 2 },
      { latitude: 2, longitude: 0 },
    ];
    const c = centroid(square)!;
    expect(c.latitude).toBeCloseTo(1);
    expect(c.longitude).toBeCloseTo(1);
  });

  it('gives front/center/back of a green', () => {
    const from = { latitude: 40, longitude: -75 };
    const green = [
      { latitude: 40.0012, longitude: -75.0001 },
      { latitude: 40.0012, longitude: -74.9999 },
      { latitude: 40.0016, longitude: -74.9999 },
      { latitude: 40.0016, longitude: -75.0001 },
    ];
    const g = greenDistances(from, centroid(green)!, green);
    expect(g.front).toBeLessThan(g.center);
    expect(g.center).toBeLessThan(g.back);
    expect(g.back - g.front).toBeGreaterThan(40); // ~0.0004° ≈ 48 yd deep
  });

  it('builds a padded map region', () => {
    const r = regionFor([
      { latitude: 1, longitude: 1 },
      { latitude: 1.01, longitude: 1.02 },
    ])!;
    expect(r.latitude).toBeCloseTo(1.005);
    expect(r.longitudeDelta).toBeGreaterThan(0.02);
  });
});
