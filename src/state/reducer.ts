import { DEFAULT_BAG } from '@/domain/clubs';
import { blankScorecard } from '@/domain/scoring';
import type { ChallengeAttempt, Club, Course, HoleScore, Round, Shot } from '@/domain/types';

export interface AppState {
  clubs: Club[];
  shots: Shot[];
  courses: Course[];
  rounds: Round[];
  /** Range-session challenges, active and finished. */
  attempts: ChallengeAttempt[];
  preferences: Preferences;
}

export interface Preferences {
  /** Selected shot tracer style id. */
  tracerStyle: string;
  /** Tracer styles the player has already been told were unlocked. */
  seenTracers: string[];
}

export const initialState: AppState = {
  clubs: DEFAULT_BAG,
  shots: [],
  courses: [],
  rounds: [],
  attempts: [],
  preferences: { tracerStyle: 'classic', seenTracers: ['classic'] },
};

export type Action =
  | { type: 'club/update'; club: Club }
  | { type: 'club/add'; club: Club }
  | { type: 'shot/add'; shot: Shot }
  | { type: 'shot/update'; shot: Shot }
  | { type: 'shot/delete'; id: string }
  | { type: 'course/save'; course: Course }
  | { type: 'course/delete'; id: string }
  | {
      type: 'round/start';
      id: string;
      startedAt: string;
      course?: Course;
      challengeIds: string[];
      challengeClubs?: Record<string, string>;
      holeCount?: number;
    }
  | { type: 'round/score'; roundId: string; score: HoleScore }
  | { type: 'round/finish'; roundId: string; finishedAt: string }
  | { type: 'round/delete'; id: string }
  | { type: 'attempt/start'; attempt: ChallengeAttempt }
  | { type: 'attempt/end'; id: string; endedAt: string }
  | { type: 'attempt/delete'; id: string }
  | { type: 'prefs/tracer'; id: string }
  | { type: 'prefs/seenTracers'; ids: string[] };

const replaceById = <T extends { id: string }>(list: T[], item: T) =>
  list.map((x) => (x.id === item.id ? item : x));

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'club/update':
      return { ...state, clubs: replaceById(state.clubs, action.club) };
    case 'club/add':
      return { ...state, clubs: [...state.clubs, action.club].sort((a, b) => a.order - b.order) };
    case 'shot/add':
      return { ...state, shots: [action.shot, ...state.shots] };
    case 'shot/update':
      return { ...state, shots: replaceById(state.shots, action.shot) };
    case 'shot/delete':
      return { ...state, shots: state.shots.filter((s) => s.id !== action.id) };
    case 'course/save': {
      const exists = state.courses.some((c) => c.id === action.course.id);
      return {
        ...state,
        courses: exists ? replaceById(state.courses, action.course) : [action.course, ...state.courses],
      };
    }
    case 'course/delete':
      return { ...state, courses: state.courses.filter((c) => c.id !== action.id) };
    case 'round/start': {
      const round: Round = {
        id: action.id,
        courseId: action.course?.id,
        courseName: action.course?.name ?? 'Casual round',
        startedAt: action.startedAt,
        scores: blankScorecard(action.course, action.holeCount),
        challengeIds: action.challengeIds,
        challengeClubs: action.challengeClubs,
      };
      return { ...state, rounds: [round, ...state.rounds] };
    }
    case 'round/score':
      return {
        ...state,
        rounds: state.rounds.map((r) =>
          r.id === action.roundId
            ? { ...r, scores: r.scores.map((h) => (h.hole === action.score.hole ? action.score : h)) }
            : r,
        ),
      };
    case 'round/finish':
      return {
        ...state,
        rounds: state.rounds.map((r) => (r.id === action.roundId ? { ...r, finishedAt: action.finishedAt } : r)),
      };
    case 'round/delete':
      return { ...state, rounds: state.rounds.filter((r) => r.id !== action.id) };
    case 'attempt/start':
      return { ...state, attempts: [action.attempt, ...state.attempts] };
    case 'attempt/end':
      return {
        ...state,
        attempts: state.attempts.map((a) => (a.id === action.id && !a.endedAt ? { ...a, endedAt: action.endedAt } : a)),
      };
    case 'attempt/delete':
      return { ...state, attempts: state.attempts.filter((a) => a.id !== action.id) };
    case 'prefs/tracer':
      return { ...state, preferences: { ...state.preferences, tracerStyle: action.id } };
    case 'prefs/seenTracers':
      return {
        ...state,
        preferences: {
          ...state.preferences,
          seenTracers: [...new Set([...state.preferences.seenTracers, ...action.ids])],
        },
      };
  }
}

/** The round in progress, if any (most recent unfinished). */
export const activeRound = (state: Pick<AppState, 'rounds'>) => state.rounds.find((r) => !r.finishedAt);

/** Range sessions still running. */
export const activeAttempts = (state: Pick<AppState, 'attempts'>) => state.attempts.filter((a) => !a.endedAt);

export const finishedRounds = (state: Pick<AppState, 'rounds'>) => state.rounds.filter((r) => r.finishedAt);
