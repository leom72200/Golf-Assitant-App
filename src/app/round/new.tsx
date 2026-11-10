import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Chips, Row, Screen, SectionTitle } from '@/components/ui';
import { CHALLENGES, dailyChallenges } from '@/domain/challenges';
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
      {CHALLENGES.map((c) => {
        const on = picked.includes(c.id);
        return (
          <Pressable key={c.id} onPress={() => toggle(c.id)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
            <Card style={{ borderWidth: 2, borderColor: on ? theme.tint : 'transparent' }}>
              <Row>
                <ThemedText style={{ fontSize: 24 }}>{c.emoji}</ThemedText>
                <ThemedText style={{ flex: 1 }}>
                  <ThemedText type="smallBold">{c.title}</ThemedText>
                  {'\n'}
                  <ThemedText type="small" themeColor="textSecondary">
                    {c.description}
                  </ThemedText>
                </ThemedText>
                <ThemedText type="smallBold" themeColor={on ? 'tint' : 'textSecondary'}>
                  {on ? '✓' : `+${c.points}`}
                </ThemedText>
              </Row>
            </Card>
          </Pressable>
        );
      })}

      <Button title="Tee off" onPress={start} />
    </Screen>
  );
}
