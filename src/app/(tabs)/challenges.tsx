import { router } from 'expo-router';
import { useMemo } from 'react';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Row, Screen, SectionTitle, Stat, StatGrid } from '@/components/ui';
import { CHALLENGES, dailyChallenges, totalPoints, type Difficulty } from '@/domain/challenges';
import { useTheme } from '@/hooks/use-theme';
import { useAppState } from '@/state/store';

const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

export default function ChallengesScreen() {
  const theme = useTheme();
  const rounds = useAppState((s) => s.rounds);
  const daily = useMemo(() => dailyChallenges(new Date()), []);

  const record = useMemo(() => {
    const counts: Record<string, { tried: number; won: number }> = {};
    for (const r of rounds) {
      const pastRounds = rounds.filter((p) => p.startedAt < r.startedAt);
      for (const id of r.challengeIds) {
        const c = CHALLENGES.find((x) => x.id === id);
        if (!c) continue;
        const status = c.evaluate(r, { pastRounds }).status;
        counts[id] ??= { tried: 0, won: 0 };
        if (r.finishedAt || status === 'completed') counts[id].tried += 1;
        if (status === 'completed') counts[id].won += 1;
      }
    }
    return counts;
  }, [rounds]);

  const won = Object.values(record).reduce((s, c) => s + c.won, 0);
  const points = useMemo(() => totalPoints(rounds), [rounds]);
  const level = Math.floor(points / 100) + 1;

  const difficultyColor = (d: Difficulty) => (d === 'easy' ? theme.success : d === 'medium' ? theme.warning : theme.danger);

  return (
    <Screen tab headerless title="Challenges" subtitle="Add a goal to any round for an extra layer of fun.">
      <StatGrid>
        <Stat label="Level" value={level} />
        <Stat label="Points" value={points} />
        <Stat label="Completed" value={won} />
      </StatGrid>

      <SectionTitle>Today&apos;s picks</SectionTitle>
      <Card>
        {daily.map((c) => (
          <ThemedText key={c.id}>
            {c.emoji} <ThemedText type="smallBold">{c.title}</ThemedText>{' '}
            <ThemedText type="small" themeColor="textSecondary">
              +{c.points}
            </ThemedText>
          </ThemedText>
        ))}
        <Button
          title="Play today's challenges"
          onPress={() => router.push({ pathname: '/round/new', params: { challenges: daily.map((c) => c.id).join(',') } })}
        />
      </Card>

      <SectionTitle>All challenges</SectionTitle>
      {CHALLENGES.map((c) => {
        const r = record[c.id];
        return (
          <Card key={c.id}>
            <Row>
              <ThemedText style={{ fontSize: 28 }}>{c.emoji}</ThemedText>
              <ThemedText style={{ flex: 1 }}>
                <ThemedText type="smallBold">{c.title}</ThemedText>
                {'\n'}
                <ThemedText type="small" themeColor="textSecondary">
                  {c.description}
                </ThemedText>
              </ThemedText>
            </Row>
            <Row style={{ justifyContent: 'space-between' }}>
              <ThemedText type="small" style={{ color: difficultyColor(c.difficulty) }}>
                {DIFFICULTY_LABEL[c.difficulty]} · +{c.points} pts
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {r ? `${r.won}/${r.tried} completed` : 'Not tried yet'}
              </ThemedText>
            </Row>
          </Card>
        );
      })}
    </Screen>
  );
}
