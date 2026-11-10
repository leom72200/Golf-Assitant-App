import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Chips, Empty, Row, Screen, SectionTitle } from '@/components/ui';
import { challengeText, priorShots, rangeChallengeById } from '@/domain/challenges';
import { dispatch, newId, useAppState } from '@/state/store';

/** Pick a club and start a range-session challenge. */
export default function StartChallengeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const challenge = rangeChallengeById(id);
  const clubs = useAppState((s) => s.clubs);
  const shots = useAppState((s) => s.shots);
  const options = useMemo(
    () => clubs.filter((c) => c.inBag && c.category !== 'putter').map((c) => ({ value: c.id, label: c.name })),
    [clubs],
  );
  const [clubId, setClubId] = useState(options.find((o) => o.value === '7i')?.value ?? options[0]?.value);
  const club = clubs.find((c) => c.id === clubId);

  // Computed with "now" as the start, exactly as it will be snapshotted.
  const preview = useMemo(() => {
    if (!challenge || !club) return undefined;
    const prior = priorShots(club.id, new Date().toISOString(), shots);
    const blocked = challenge.cannotStart?.(prior, club);
    const baseline = challenge.baseline?.(prior, club);
    const target = baseline !== undefined ? challenge.formatTarget?.(baseline) : undefined;
    return { blocked, baseline, target };
  }, [challenge, club, shots]);

  if (!challenge) return <Empty title="Challenge not found" />;

  const start = () => {
    if (!club || !preview || preview.blocked) return;
    dispatch({
      type: 'attempt/start',
      attempt: {
        id: newId(),
        challengeId: challenge.id,
        clubId: club.id,
        startedAt: new Date().toISOString(),
        baseline: preview.baseline,
      },
    });
    router.replace({ pathname: '/shot/new', params: { clubId: club.id } });
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: challenge.title }} />
      <Card>
        <Row>
          <ThemedText style={{ fontSize: 32 }}>{challenge.emoji}</ThemedText>
          <ThemedText style={{ flex: 1 }}>
            <ThemedText type="smallBold">{challengeText(challenge.title, { clubName: club?.name })}</ThemedText>
            {'\n'}
            <ThemedText type="small" themeColor="textSecondary">
              {challengeText(challenge.description, { clubName: club?.name, target: preview?.target })}
            </ThemedText>
          </ThemedText>
        </Row>
        <ThemedText type="small" themeColor="tint">
          +{challenge.points} points
        </ThemedText>
      </Card>

      <SectionTitle>Choose your club</SectionTitle>
      <Chips options={options} selected={clubId} onSelect={setClubId} />

      {preview?.blocked ? (
        <ThemedText themeColor="warning">{preview.blocked}</ThemedText>
      ) : preview?.target === undefined && challenge.baseline ? (
        <ThemedText type="small" themeColor="textSecondary">
          No record with this club yet — your first logged shot sets it.
        </ThemedText>
      ) : null}

      <ThemedText type="small" themeColor="textSecondary">
        Every {club?.name ?? 'club'} shot you log from now until you end the session counts — enter them by hand, from a
        launch monitor, or through the Shot Lab.
      </ThemedText>
      <Button title="Start session" onPress={start} disabled={!club || !!preview?.blocked} />
    </Screen>
  );
}
