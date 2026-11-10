import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { Alert, Pressable } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Empty, fmt, Row, Screen, SectionTitle, Stat, StatGrid } from '@/components/ui';
import { clubStats } from '@/domain/clubs';
import { clubRecords, SHOT_METRICS } from '@/domain/records';
import { dispatch, useAppState } from '@/state/store';

export default function ClubScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const clubs = useAppState((s) => s.clubs);
  const allShots = useAppState((s) => s.shots);
  const club = clubs.find((c) => c.id === id);
  const shots = useMemo(() => allShots.filter((s) => s.clubId === id), [allShots, id]);
  const s = useMemo(() => clubStats(shots), [shots]);
  const prs = useMemo(() => clubRecords(shots), [shots]);

  if (!club) return <Empty title="Club not found" />;

  const offline =
    s.avgOffline === undefined
      ? undefined
      : s.avgOffline === 0
        ? 'Straight'
        : `${Math.abs(s.avgOffline).toFixed(0)} ${s.avgOffline < 0 ? 'L' : 'R'}`;

  return (
    <Screen>
      <Stack.Screen options={{ title: club.name }} />
      <StatGrid>
        <Stat label="Stock carry" value={fmt(s.stockCarry)} unit="yds" />
        <Stat label="Avg total" value={fmt(s.avgTotal)} unit="yds" />
        <Stat label="Consistency ±" value={fmt(s.carrySpread)} unit="yds" />
        <Stat label="Ball speed" value={fmt(s.avgBallSpeed)} unit="mph" />
        <Stat label="Club speed" value={fmt(s.avgClubSpeed)} unit="mph" />
        <Stat label="Smash" value={fmt(s.smashFactor, 2)} />
        <Stat label="Launch" value={fmt(s.avgLaunch, 1)} unit="°" />
        <Stat label="Spin" value={fmt(s.avgSpin)} unit="rpm" />
        <Stat label="Miss" value={offline} />
      </StatGrid>
      {s.carryRange && s.usedCount >= 3 ? (
        <ThemedText type="small" themeColor="textSecondary">
          80% of your good {club.name} shots carry {s.carryRange[0]}–{s.carryRange[1]} yards ({s.usedCount} shots,
          mishits excluded).
        </ThemedText>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          Log at least 3 shots to see a reliable stock yardage.
        </ThemedText>
      )}

      <Button title={`Log a ${club.name} shot`} onPress={() => router.push({ pathname: '/shot/new', params: { clubId: club.id } })} />

      {Object.keys(prs).length > 0 ? (
        <>
          <SectionTitle>Personal records</SectionTitle>
          <Card>
            {SHOT_METRICS.map((m) => {
              const e = prs[m.key];
              if (!e) return null;
              return (
                <Row key={m.key} style={{ justifyContent: 'space-between' }}>
                  <ThemedText type="small" themeColor="textSecondary">
                    🏆 {m.label}
                  </ThemedText>
                  <ThemedText type="smallBold">
                    {e.value.toFixed(m.digits)}
                    {m.unit ? ` ${m.unit}` : ''}
                  </ThemedText>
                </Row>
              );
            })}
          </Card>
        </>
      ) : null}

      <SectionTitle>Shot history</SectionTitle>
      {shots.length === 0 ? (
        <Empty title="No shots yet" body="Log shots from the range, a launch monitor, or the Shot Lab." />
      ) : (
        shots.map((shot) => (
          <Card key={shot.id}>
            <Row style={{ justifyContent: 'space-between' }}>
              <ThemedText type="smallBold" style={{ opacity: shot.mishit ? 0.5 : 1 }}>
                {shot.carryYards !== undefined ? `${Math.round(shot.carryYards)} yds carry` : 'No carry'}
                {shot.totalYards !== undefined ? ` · ${Math.round(shot.totalYards)} total` : ''}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {new Date(shot.createdAt).toLocaleDateString()}
              </ThemedText>
            </Row>
            <ThemedText type="small" themeColor="textSecondary">
              {[
                shot.ballSpeedMph !== undefined && `${shot.ballSpeedMph.toFixed(0)} mph ball`,
                shot.clubSpeedMph !== undefined && `${shot.clubSpeedMph.toFixed(0)} mph club`,
                shot.launchAngleDeg !== undefined && `${shot.launchAngleDeg.toFixed(1)}° launch`,
                shot.spinRpm !== undefined && `${shot.spinRpm} rpm`,
                shot.source === 'camera' && 'via Shot Lab',
              ]
                .filter(Boolean)
                .join(' · ') || 'Manual entry'}
            </ThemedText>
            {shot.notes ? <ThemedText type="small">{shot.notes}</ThemedText> : null}
            <Row>
              <Pressable onPress={() => dispatch({ type: 'shot/update', shot: { ...shot, mishit: !shot.mishit } })}>
                <ThemedText type="small" themeColor="tint">
                  {shot.mishit ? 'Count this shot' : 'Mark as mishit'}
                </ThemedText>
              </Pressable>
              <Pressable
                onPress={() =>
                  Alert.alert('Delete shot?', undefined, [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => dispatch({ type: 'shot/delete', id: shot.id }) },
                  ])
                }>
                <ThemedText type="small" themeColor="danger">
                  Delete
                </ThemedText>
              </Pressable>
            </Row>
          </Card>
        ))
      )}
    </Screen>
  );
}
