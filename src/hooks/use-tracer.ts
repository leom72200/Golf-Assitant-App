import { useMemo } from 'react';

import { tracerById, unlockContext, unlockedTracerIds, type TracerStyle } from '@/domain/tracerStyles';
import { useAppState } from '@/state/store';

/** Unlocked tracer ids, derived from the player's rounds, range sessions and shots. */
export function useUnlockedTracers(): string[] {
  const rounds = useAppState((s) => s.rounds);
  const attempts = useAppState((s) => s.attempts);
  const shots = useAppState((s) => s.shots);
  return useMemo(() => unlockedTracerIds(unlockContext(rounds, attempts, shots)), [rounds, attempts, shots]);
}

/** The selected tracer style, falling back to Classic if it's (no longer) unlocked. */
export function useTracerStyle(): TracerStyle {
  const selected = useAppState((s) => s.preferences.tracerStyle);
  const unlocked = useUnlockedTracers();
  return tracerById(unlocked.includes(selected) ? selected : 'classic');
}
