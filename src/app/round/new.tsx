import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Chips, Row, Screen, SectionTitle } from '@/components/ui';
import { challengeText, dailyChallenges, ROUND_CHALLENGES } from '@/domain/challenges';
import { useTheme } from '@/hooks/use-theme';
import { activeRound } from '@/state/reducer';
import { dispatch, newId, useAppState } from '@/state/store';

const CASUAL_9 = 'casual-9';
const CASUAL_18 = 'casual-18';
const MAX_CHALLENGES = 3;

export default function NewRoundScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ courseId?: string; challenges?: string }>();
  const courses = useAppState((s) => s.courses);
  const rounds = useAppState((s) => s.rounds);
  const clubs = useAppState((s) => s.clubs);
  const clubOptions = useMemo(
    () => clubs.filter((c) => c.inBag && c.category !== 'putter').map((c) => ({ value: c.id, label: c.name })),
    [clubs],
  );
  const defaultClub = clubOptions.find((o) => o.value === '7i')?.value ?? clubOptions[0]?.value;
  const [challengeClubs, setChallengeClubs] = useState<Record<string, string>>({});
  const live = activeRound({ rounds });

  const [courseId, setCourseId] = useState(params.courseId ?? courses[0]?.id ?? CASUAL_18);
  const [picked, setPicked] = useState<string[]>(
    () => params.challenges?.split(',').filter(Boolean) ?? dailyChallenges(new Date()).map((c) => c.id),
  );

  const courseOptions = useMemo(
    () => [
      ...courses.filter((c) => c.holes.length > 0).map((c) => ({ value: c.id, label: c.name })),
      { value: CASUAL_18, label: 'No course · 18 holes' },
      { value: CASUAL_9, label: 'No course · 9 holes' },
    ],
    [courses],
  );

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_CHALLENGES ? p : [...p, id]));

  const start = () => {
    const course = courses.find((c) => c.id === courseId);
    const id = newId();
    dispatch({
      type: 'round/start',
      id,
      startedAt: new Date().toISOString(),
      course,
      holeCount: courseId === CASUAL_9 ? 9 : 18,
      challengeIds: picked,
      // Club-specific challenges fall back to the default club if none was picked.
      challengeClubs: Object.fromEntries(
        picked
          .filter((cid) => ROUND_CHALLENGES.find((c) => c.id === cid)?.needsClub)
          .map((cid) => [cid, challengeClubs[cid] ?? defaultClub]),
      ),
    });
    router.replace(`/round/${id}`);
  };

  return (
    <Screen>
      {live ? (
        <Card onPress={() => router.replace(`/round/${live.id}`)}>
          <ThemedText type="small" themeColor="warning">
            You already have a round in progress at {live.courseName}. Tap to resume it, or start a new one below.
          </ThemedText>
        </Card>
      ) : null}

      <SectionTitle>Course</SectionTitle>
      <Chips options={courseOptions} selected={courseId} onSelect={setCourseId} />

      <SectionTitle right={<ThemedText type="small" themeColor="textSecondary">{picked.length}/{MAX_CHALLENGES}</ThemedText>}>
        Challenges
      </SectionTitle>
      <ThemedText type="small" themeColor="textSecondary">
        Pick up to {MAX_CHALLENGES}. Today&apos;s picks are pre-selected.
      </ThemedText>
      {ROUND_CHALLENGES.map((c) => {
        const on = picked.includes(c.id);
        const chosenClub = challengeClubs[c.id] ?? defaultClub;
        const clubName = clubs.find((x) => x.id === chosenClub)?.name;
        return (
          <Pressable key={c.id} onPress={() => toggle(c.id)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
            <Card style={{ borderWidth: 2, borderColor: on ? theme.tint : 'transparent' }}>
              <Row>
                <ThemedText style={{ fontSize: 24 }}>{c.emoji}</ThemedText>
                <ThemedText style={{ flex: 1 }}>
                  <ThemedText type="smallBold">{c.title}</ThemedText>
                  {'\n'}
                  <ThemedText type="small" themeColor="textSecondary">
                    {challengeText(c.description, { clubName: c.needsClub && on ? clubName : undefined })}
                  </ThemedText>
                </ThemedText>
                <ThemedText type="smallBold" themeColor={on ? 'tint' : 'textSecondary'}>
                  {on ? '✓' : `+${c.points}`}
                </ThemedText>
              </Row>
              {c.needsClub && on ? (
                <>
                  <ThemedText type="small" themeColor="textSecondary">
                    Which club? On the scorecard, flag a hole as &quot;one club only&quot; when you play it with just this club.
                  </ThemedText>
                  <Chips
                    options={clubOptions}
                    selected={chosenClub}
                    onSelect={(v) => setChallengeClubs((m) => ({ ...m, [c.id]: v }))}
                  />
                </>
              ) : null}
            </Card>
          </Pressable>
        );
      })}

      <Button title="Tee off" onPress={start} />
    </Screen>
  );
}
