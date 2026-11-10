import { Stack, useLocalSearchParams, router } from 'expo-router';
import { useMemo, useState } from 'react';

import { ShotTracer } from '@/components/shot-tracer';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, Empty, fmt, Row, Screen, Stat, StatGrid } from '@/components/ui';
import { flightForShot } from '@/domain/shotFlight';
import { useTracerStyle } from '@/hooks/use-tracer';
import { useAppState } from '@/state/store';

/** Replay a logged shot with the shot tracer. */
export default function ShotReplayScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const shot = useAppState((s) => s.shots.find((x) => x.id === id));
  const clubs = useAppState((s) => s.clubs);
  const club = clubs.find((c) => c.id === shot?.clubId);
  const style = useTracerStyle();
  const [replay, setReplay] = useState(0);
  const flight = useMemo(() => (shot ? flightForShot(shot, club) : undefined), [shot, club]);

  if (!shot) return <Empty title="Shot not found" />;
  return (
    <Screen>
      <Stack.Screen options={{ title: `${club?.name ?? 'Shot'} replay` }} />
      {flight ? (
        <ShotTracer flight={flight} style={style} offlineYards={shot.offlineYards} height={240} replayKey={replay} />
      ) : (
        <Empty title="Nothing to replay" body="This shot has no distance or launch data." />
      )}
      <Row>
        <Button title="▶ Replay" onPress={() => setReplay((r) => r + 1)} style={{ flex: 1 }} disabled={!flight} />
        <Button title={`🎨 ${style.name}`} variant="secondary" onPress={() => router.push('/tracers')} style={{ flex: 1 }} />
      </Row>
      <StatGrid>
        <Stat label="Carry" value={fmt(shot.carryYards ?? flight?.carryYards)} unit="yds" />
        <Stat label="Total" value={fmt(shot.totalYards ?? flight?.totalYards)} unit="yds" />
        <Stat label="Apex" value={fmt(flight?.apexYards)} unit="yds" />
        <Stat label="Ball speed" value={fmt(shot.ballSpeedMph)} unit="mph" />
        <Stat label="Launch" value={fmt(shot.launchAngleDeg, 1)} unit="°" />
        <Stat label="Land angle" value={fmt(flight?.descentAngleDeg)} unit="°" />
      </StatGrid>
      <Card>
        <ThemedText type="small" themeColor="textSecondary">
          {new Date(shot.createdAt).toLocaleString()} ·{' '}
          {shot.source === 'camera' ? 'Practice mode' : shot.source === 'course' ? 'On course' : 'Logged by hand'}
          {shot.ballSpeedMph ? '' : ' · flight shape estimated from carry'}
          {shot.offlineYards ? '' : ' · drawn straight (no left/right data)'}
        </ThemedText>
      </Card>
    </Screen>
  );
}
