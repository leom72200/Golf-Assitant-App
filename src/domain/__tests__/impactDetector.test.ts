import { ImpactDetector, impactFrameInClip } from '../impactDetector';

describe('ImpactDetector', () => {
  it('fires on a sharp spike above the background, once', () => {
    const d = new ImpactDetector();
    const levels = [-50, -48, -51, -49, -50, -12, -15, -45, -50];
    const hits = levels.map((db, i) => d.push(db, i * 30));
    expect(hits).toEqual([false, false, false, false, false, true, false, false, false]);
  });

  it('ignores gradual noise like talking or wind', () => {
    const d = new ImpactDetector();
    let hit = false;
    for (let i = 0; i < 100; i++) hit = d.push(-50 + i * 0.4, i * 30) || hit; // rises to -10 dB slowly
    expect(hit).toBe(false);
  });

  it('ignores quiet blips and respects the cooldown', () => {
    const d = new ImpactDetector({ cooldownMs: 1000 });
    d.push(-70, 0);
    expect(d.push(-40, 30)).toBe(false); // big jump but still quiet
    expect(d.push(-10, 60)).toBe(true);
    for (let t = 90; t < 600; t += 30) d.push(-60, t);
    expect(d.push(-10, 600)).toBe(false); // within cooldown
    for (let t = 630; t < 1200; t += 30) d.push(-60, t);
    expect(d.push(-10, 1200)).toBe(true);
  });
});

describe('impactFrameInClip', () => {
  it('works back from the end of the clip', () => {
    // 3 s clip; impact heard 400 ms before stop; 60 ms mic latency -> at 2.54 s.
    expect(impactFrameInClip({ clipDurationMs: 3000, heardAtMs: 10_000, stopRequestedAtMs: 10_400, fps: 240 })).toBe(610);
  });
});
