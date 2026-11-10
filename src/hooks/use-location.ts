import * as Location from 'expo-location';
import { useEffect, useState } from 'react';

import type { LatLng } from '@/domain/types';

export type LocationStatus = 'idle' | 'requesting' | 'denied' | 'watching' | 'error';

/**
 * Foreground GPS position, updated as the player walks. Only active while the screen using it is
 * mounted, so the app never tracks location in the background.
 */
export function useLiveLocation(enabled = true) {
  const [position, setPosition] = useState<LatLng & { accuracy?: number | null }>();
  const [status, setStatus] = useState<LocationStatus>('idle');

  useEffect(() => {
    if (!enabled) return;
    let sub: Location.LocationSubscription | undefined;
    let cancelled = false;
    (async () => {
      setStatus('requesting');
      const perm = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (!perm.granted) {
        setStatus('denied');
        return;
      }
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 1, timeInterval: 2000 },
        (loc) =>
          setPosition({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            accuracy: loc.coords.accuracy,
          }),
      );
      if (cancelled) sub.remove();
      else setStatus('watching');
    })().catch(() => !cancelled && setStatus('error'));
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [enabled]);

  return { position, status };
}

/** One-off position fix, e.g. to search for nearby courses. */
export async function getCurrentLocation(): Promise<LatLng | undefined> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) return undefined;
  const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
}
