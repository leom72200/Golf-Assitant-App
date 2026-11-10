import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { ShotTracer } from '@/components/shot-tracer';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, Row, Screen } from '@/components/ui';
import { simulateFlight } from '@/domain/launch';
import { TRACER_STYLES } from '@/domain/tracerStyles';
import { useTracerStyle, useUnlockedTracers } from '@/hooks/use-tracer';
import { useTheme } from '@/hooks/use-theme';
import { dispatch } from '@/state/store';

/** The tracer locker: every style, how to unlock it, and which one is in use. */
export default function TracersScreen() {
  const theme = useTheme();
  const unlocked = useUnlockedTracers();
  const current = useTracerStyle();
  const [replay, setReplay] = useState(0);
  // A nice 7-iron with a little draw for the previews.
  const demo = useMemo(() => simulateFlight({ ballSpeedMph: 122, launchAngleDeg: 17, spinRpm: 6800 }), []);

  return (
    <Screen>
      <ThemedText themeColor="textSecondary">
        Complete challenges, break personal records and level up to unlock new shot tracer styles. Your pick is used in
        practice mode, the Shot Lab and shot replays.
      </ThemedText>
      <ThemedText type="smallBold">
        {unlocked.length} of {TRACER_STYLES.length} unlocked
      </ThemedText>

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <ThemedText type="smallBold">In use: {current.name}</ThemedText>
          <Button title="Replay" variant="secondary" onPress={() => setReplay((r) => r + 1)} />
        </Row>
        <ShotTracer flight={demo} style={current} offlineYards={-6} height={180} replayKey={`${current.id}-${replay}`} />
      </Card>

      {TRACER_STYLES.map((style) => {
        const isUnlocked = unlocked.includes(style.id);
        const inUse = current.id === style.id;
        return (
          <Card key={style.id} style={{ borderWidth: 2, borderColor: inUse ? theme.tint : 'transparent' }}>
            <View style={{ opacity: isUnlocked ? 1 : 0.35 }}>
              <ShotTracer flight={demo} style={style} offlineYards={-6} height={90} animate={false} showLabels={false} />
            </View>
            <Row style={{ justifyContent: 'space-between' }}>
              <ThemedText style={{ flex: 1 }}>
                <ThemedText type="smallBold">
                  {isUnlocked ? '' : '🔒 '}
                  {style.name}
                </ThemedText>
                {'\n'}
                <ThemedText type="small" themeColor="textSecondary">
                  {isUnlocked ? 'Unlocked' : style.hint}
                </ThemedText>
              </ThemedText>
              {isUnlocked && !inUse ? (
                <Button title="Use" onPress={() => dispatch({ type: 'prefs/tracer', id: style.id })} />
              ) : inUse ? (
                <ThemedText type="smallBold" themeColor="tint">
                  In use ✓
                </ThemedText>
              ) : null}
            </Row>
          </Card>
        );
      })}
    </Screen>
  );
}
