/**
 * Core data model for the app. Everything here is plain, serialisable data so it can be
 * persisted as JSON and shared between screens and pure domain functions.
 */

export type ClubCategory = 'wood' | 'hybrid' | 'iron' | 'wedge' | 'putter';

export interface Club {
  id: string;
  /** Short label shown in lists, e.g. "7i", "PW", "3W". */
  name: string;
  category: ClubCategory;
  /** Loft in degrees, optional because many golfers don't know it. */
  loft?: number;
  /** Whether the club is currently in the bag (max 14 by the rules). */
  inBag: boolean;
  /** Sort order from longest to shortest. */
  order: number;
}

/** How a shot's numbers were captured. */
export type ShotSource = 'manual' | 'camera' | 'course';

export interface Shot {
  id: string;
  clubId: string;
  /** ISO timestamp. */
  createdAt: string;
  source: ShotSource;
  /** Carry distance in yards. */
  carryYards?: number;
  /** Total distance (carry + roll) in yards. */
  totalYards?: number;
  /** Ball speed in mph. */
  ballSpeedMph?: number;
  /** Club head speed in mph. */
  clubSpeedMph?: number;
  /** Vertical launch angle in degrees. */
  launchAngleDeg?: number;
  /** Back spin in rpm. */
  spinRpm?: number;
  /** Yards left (-) or right (+) of the target line. */
  offlineYards?: number;
  /** Excluded from stock-yardage stats (a chunk, top, shank...). */
  mishit?: boolean;
  notes?: string;
}

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface Hole {
  number: number;
  par?: number;
  /** Handicap / stroke index. */
  handicap?: number;
  /** Yardage from the default tee, if known. */
  yards?: number;
  /** Tee box position(s). */
  tees: LatLng[];
  /** Polygon outlining the green, if mapped. */
  green?: LatLng[];
  /** Single green centre point (from the polygon centroid or the end of the hole line). */
  greenCenter?: LatLng;
  /** Hole routing line from tee to green (OSM `golf=hole` way). */
  path?: LatLng[];
  hazards: Hazard[];
}

export interface Hazard {
  kind: 'bunker' | 'water' | 'other';
  outline: LatLng[];
}

export interface Course {
  id: string;
  name: string;
  /** Where the data came from, e.g. "openstreetmap:way/123". */
  source: string;
  location: LatLng;
  address?: string;
  holes: Hole[];
  importedAt: string;
}

/** A course search hit before its full hole data has been downloaded. */
export interface CourseSummary {
  source: string;
  name: string;
  location: LatLng;
  distanceMiles?: number;
}

export interface HoleScore {
  hole: number;
  par: number;
  strokes?: number;
  putts?: number;
  /** Tee shot finished in the fairway. Undefined on par 3s. */
  fairwayHit?: boolean;
  /** Penalty strokes taken on the hole. */
  penalties?: number;
  /** Hit from a bunker this hole. */
  sandShot?: boolean;
  /** Played the whole hole (putts included) with one club, for one-club challenges. */
  singleClub?: boolean;
}

export interface Round {
  id: string;
  courseId?: string;
  courseName: string;
  startedAt: string;
  finishedAt?: string;
  scores: HoleScore[];
  /** Challenge ids the player opted into for this round. */
  challengeIds: string[];
  /** The club chosen for club-specific challenges, keyed by challenge id. */
  challengeClubs?: Record<string, string>;
}

/**
 * A range-session challenge in progress or finished, e.g. "beat your longest 7-iron".
 * Only shots logged between `startedAt` and `endedAt` count towards it.
 */
export interface ChallengeAttempt {
  id: string;
  challengeId: string;
  clubId: string;
  startedAt: string;
  endedAt?: string;
  /** Snapshot of the number to beat when the attempt started (e.g. the carry record). */
  baseline?: number;
}
