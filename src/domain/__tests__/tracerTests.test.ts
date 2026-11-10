import { summarizeTracerTests, tracerTestReport, type TracerTestRecord } from '../tracerTests';

const rec = (over: Partial<TracerTestRecord['detection']>, final: Partial<TracerTestRecord['final']> = {}, matched?: 'yes' | 'close' | 'no'): TracerTestRecord => ({
  id: Math.random().toString(36),
  createdAt: '2026-11-11T10:00:00Z',
  videoFile: 'a.mp4',
  device: {},
  video: { width: 1080, height: 1920, fps: 30, duration: 8, rotation: 0 },
  analysis: { width: 640, height: 1138 },
  aim: { ball: { x: 330, y: 1020, radius: 3 }, target: { x: 320, y: 500 } },
  detection: { impactFromAudioSec: 1.5, ballFound: true, elapsedMs: 2000, triggeredBy: 'sound', ...over },
  final: { clubId: '7i', carryYards: 150, launchDeg: 21, startDeg: 0, curveYards: 0, apexYards: 28, ...final },
  notes: matched ? { matched } : {},
});

describe('tracer test summary', () => {
  it('summarises detection quality and corrections', () => {
    const s = summarizeTracerTests([
      rec({ impactFromFramesSec: 1.6, startDeg: 2 }, { startDeg: 3 }, 'yes'),
      rec({ impactFromFramesSec: 1.4, startDeg: -1 }, { startDeg: -1 }, 'close'),
      rec({ ballFound: false }, {}, 'no'),
    ]);
    expect(s.shots).toBe(3);
    expect(s.ballFoundRate).toBeCloseTo(2 / 3);
    expect(s.startDetectedRate).toBeCloseTo(2 / 3);
    expect(s.meanAudioOffsetMs).toBeCloseTo(100);
    expect(s.meanStartCorrectionDeg).toBeCloseTo(0.5);
    expect(s.matched).toEqual({ yes: 1, close: 1, no: 1 });
  });

  it('builds a report with a summary and all records', () => {
    const r = tracerTestReport([rec({})]);
    expect(r.kind).toBe('golf-assistant/tracer-tests');
    expect(r.records).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(r)).summary.shots).toBe(1);
  });
});
