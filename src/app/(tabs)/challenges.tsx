import { router } from 'expo-router';
import { useMemo, type ReactNode } from 'react';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, ProgressBar, Row, Screen, SectionTitle, Stat, StatGrid } from '@/components/ui';
import {
  challengeText,
  dailyChallenges,
  evaluateAttempt,
  RANGE_CHALLENGES,
  rangeChallengeById,
  ROUND_CHALLENGES,
  roundChallengeById,
  totalPoints,
  type Challenge,
  type Difficulty,
} from '@/domain/challenges';
import { useTheme } from '@/hooks/use-theme';
import { dispatch, useAppState } from '@/state/store';

const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

export default function ChallengesScreen() {
  const theme = useTheme();
  const rounds = useAppState((s) => s.rounds);
  const attempts = useAppState((s) => s.attempts);
  const shots = useAppState((s) => s.shots);
  const clubs = useAppState((s) => s.clubs);
  const daily = useMemo(() => dailyChallenges(new Date()), []);
  const clubName = (id?: string) => clubs.find((c) => c.id === id)?.name;

  // Per-challenge history: how often tried and completed.
  const record = useMemo(() => {
    const counts: Record<string, { tried: number; won: number }> = {};
    const bump = (id: string, tried: boolean, won: boolean) => {
      counts[id] ??= { tried: 0, won: 0 };
      if (tried || won) counts[id].tried += 1;
      if (won) counts[id].won += 1;
    };
    for (const r of rounds) {
      const pastRounds = rounds.filter((p) => p.startedAt < r.startedAt);
      for (const id of r.challengeIds) {
        const status = roundChallengeById(id)?.evaluate(r, { pastRounds }).status;
        if (status) bump(id, !!r.finishedAt, status === 'completed');
      }
    }
    for (const a of attempts) {
      const status = evaluateAttempt(a, shots)?.status;
      if (status) bump(a.challengeId, !!a.endedAt, status === 'completed');
    }
    return counts;
  }, [rounds, attempts, shots]);

  const active = attempts.filter((a) => !a.endedAt);
  const won = Object.values(record).reduce((s, c) => s + c.won, 0);
  const points = useMemo(() => totalPoints(rounds, attempts, shots), [rounds, attempts, shots]);
  const level = Math.floor(points / 100) + 1;

  return (
    <Screen tab headerless title="Challenges" subtitle="Add a goal to any round or range session.">
      <StatGrid>
        <Stat label="Level" value={level} />
        <Stat label="Points" value={points} />
        <Stat label="Completed" value={won} />
      </StatGrid>
      <Button title="🏆 Personal records" variant="secondary" onPress={() => router.push('/records')} />

      {active.length > 0 ? <SectionTitle>Active range sessions</SectionTitle> : null}
      {active.map((a) => {
        const c = rangeChallengeById(a.challengeId);
        const p = evaluateAttempt(a, shots);
        if (!c || !p) return null;
        const done = p.status === 'completed';
        return (
          <Card key={a.id}>
            <Row style={{ justifyContent: 'space-between' }}>
              <ThemedText type="smallBold" style={{ flex: 1 }}>
                {c.emoji} {challengeText(c.title, { clubName: clubName(a.clubId) })} · {clubName(a.clubId)}
              </ThemedText>
              <ThemedText type="smallBold" style={{ color: done ? theme.success : theme.textSecondary }}>
                {done ? `+${c.points} ✓` : `+${c.points}`}
              </ThemedText>
            </Row>
            <ProgressBar progress={p.progress} color={done ? theme.success : undefined} />
            <ThemedText type="small" themeColor="textSecondary">
              {p.detail}
            </ThemedText>
            <Row>
              <Button
                title={`Log ${clubName(a.clubId) ?? ''} shot`}
                style={{ flex: 1 }}
                onPress={() => router.push({ pathname: '/shot/new', params: { clubId: a.clubId } })}
              />
              <Button
                title={done ? 'Finish' : 'End session'}
                variant="secondary"
                style={{ flex: 1 }}
                onPress={() => dispatch({ type: 'attempt/end', id: a.id, endedAt: new Date().toISOString() })}
              />
            </Row>
          </Card>
        );
      })}

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

      <SectionTitle>Range challenges</SectionTitle>
      <ThemedText type="small" themeColor="textSecondary">
        Pick a club, then hit balls. Every shot you log with that club counts until you end the session.
      </ThemedText>
      {RANGE_CHALLENGES.map((c) => (
        <ChallengeCard
          key={c.id}
          c={c}
          record={record[c.id]}
          action={<Button title="Start session" variant="secondary" onPress={() => router.push({ pathname: '/challenge/start', params: { id: c.id } })} />}
        />
      ))}

      <SectionTitle>Round challenges</SectionTitle>
      <ThemedText type="small" themeColor="textSecondary">
        Add up to 3 when you start a round. They update live as you fill in the scorecard.
      </ThemedText>
      {ROUND_CHALLENGES.map((c) => (
        <ChallengeCard key={c.id} c={c} record={record[c.id]} />
      ))}
    </Screen>
  );
}

function ChallengeCard({
  c,
  record,
  action,
}: {
  c: Challenge;
  record?: { tried: number; won: number };
  action?: ReactNode;
}) {
  const theme = useTheme();
  const color = c.difficulty === 'easy' ? theme.success : c.difficulty === 'medium' ? theme.warning : theme.danger;
  return (
    <Card>
      <Row>
        <ThemedText style={{ fontSize: 28 }}>{c.emoji}</ThemedText>
        <ThemedText style={{ flex: 1 }}>
          <ThemedText type="smallBold">{challengeText(c.title)}</ThemedText>
          {'\n'}
          <ThemedText type="small" themeColor="textSecondary">
            {challengeText(c.description)}
          </ThemedText>
        </ThemedText>
      </Row>
      <Row style={{ justifyContent: 'space-between' }}>
        <ThemedText type="small" style={{ color }}>
          {DIFFICULTY_LABEL[c.difficulty]} · +{c.points} pts
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {record ? `${record.won}/${record.tried} completed` : 'Not tried yet'}
        </ThemedText>
      </Row>
      {action}
    </Card>
  );
}
