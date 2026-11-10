import { activeAttempts, activeRound, initialState, reducer } from '../reducer';

describe('reducer', () => {
  it('starts, scores and finishes a round', () => {
    let s = reducer(initialState, {
      type: 'round/start',
      id: 'r1',
      startedAt: '2026-06-01T10:00:00Z',
      challengeIds: ['clean-card'],
      holeCount: 9,
    });
    expect(activeRound(s)?.scores).toHaveLength(9);

    s = reducer(s, { type: 'round/score', roundId: 'r1', score: { hole: 3, par: 4, strokes: 5, putts: 2 } });
    expect(s.rounds[0].scores[2].strokes).toBe(5);
    expect(s.rounds[0].scores[0].strokes).toBeUndefined();

    s = reducer(s, { type: 'round/finish', roundId: 'r1', finishedAt: '2026-06-01T14:00:00Z' });
    expect(activeRound(s)).toBeUndefined();
  });

  it('adds and removes shots', () => {
    const shot = { id: 's1', clubId: '7i', createdAt: '', source: 'manual' as const, carryYards: 150 };
    let s = reducer(initialState, { type: 'shot/add', shot });
    expect(s.shots).toHaveLength(1);
    s = reducer(s, { type: 'shot/delete', id: 's1' });
    expect(s.shots).toHaveLength(0);
  });

  it('replaces a re-imported course instead of duplicating it', () => {
    const course = { id: 'c', name: 'A', source: 'c', location: { latitude: 0, longitude: 0 }, holes: [], importedAt: '' };
    let s = reducer(initialState, { type: 'course/save', course });
    s = reducer(s, { type: 'course/save', course: { ...course, name: 'B' } });
    expect(s.courses).toHaveLength(1);
    expect(s.courses[0].name).toBe('B');
  });

  it('starts and ends a range session', () => {
    const attempt = { id: 'a1', challengeId: 'distance-pr', clubId: '7i', startedAt: '2026-01-01T10:00:00Z', baseline: 160 };
    let s = reducer(initialState, { type: 'attempt/start', attempt });
    expect(activeAttempts(s)).toHaveLength(1);
    s = reducer(s, { type: 'attempt/end', id: 'a1', endedAt: '2026-01-01T11:00:00Z' });
    expect(activeAttempts(s)).toHaveLength(0);
    // Ending twice keeps the original end time.
    s = reducer(s, { type: 'attempt/end', id: 'a1', endedAt: '2026-01-02T11:00:00Z' });
    expect(s.attempts[0].endedAt).toBe('2026-01-01T11:00:00Z');
  });

  it('remembers the club chosen for club challenges', () => {
    const s = reducer(initialState, {
      type: 'round/start',
      id: 'r1',
      startedAt: '',
      challengeIds: ['one-club-par'],
      challengeClubs: { 'one-club-par': '7i' },
    });
    expect(s.rounds[0].challengeClubs).toEqual({ 'one-club-par': '7i' });
  });
});
