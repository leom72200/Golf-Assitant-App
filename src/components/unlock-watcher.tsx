import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Alert } from 'react-native';

import { tracerById } from '@/domain/tracerStyles';
import { useUnlockedTracers } from '@/hooks/use-tracer';
import { dispatch, useAppState } from '@/state/store';

/** Announces newly unlocked tracer styles, wherever in the app they were earned. */
export function UnlockWatcher() {
  const unlocked = useUnlockedTracers();
  const seen = useAppState((s) => s.preferences.seenTracers);

  useEffect(() => {
    const fresh = unlocked.filter((id) => !seen.includes(id));
    if (fresh.length === 0) return;
    dispatch({ type: 'prefs/seenTracers', ids: fresh });
    const names = fresh.map((id) => tracerById(id).name);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    Alert.alert(
      fresh.length === 1 ? '🎨 New shot tracer unlocked!' : `🎨 ${fresh.length} new shot tracers unlocked!`,
      names.join('\n'),
      [
        { text: 'Later', style: 'cancel' },
        {
          text: 'Use it',
          onPress: () => {
            dispatch({ type: 'prefs/tracer', id: fresh[fresh.length - 1] });
            router.push('/tracers');
          },
        },
      ],
    );
  }, [unlocked, seen]);

  return null;
}
