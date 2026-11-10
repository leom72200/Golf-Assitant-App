import { router } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Empty, ProgressBar, Row, Screen, SectionTitle, Stat, StatGrid } from '@/components/ui';
import { dailyChallenges, roundChallengeById, totalPoints } from '@/domain/challenges';
import { roundRecords } from '@/domain/records';
import { formatToPar, summarizeRound } from '@/domain/scoring';
import { activeRound } from '@/state/reducer';
import { useAppState } from '@/state/store';

export default function HomeScreen() {
  const rounds = useAppState((s) => s.rounds);
  const shots = useAppState((s) => s.shots);
  const clubs = useAppState((s) => s.clubs);
  const attempts = useAppState((s) => s.attempts);

  const live = useMemo(() => activeRound({ rounds }), [rounds]);
  const finished = useMemo(() => rounds.filter((r) => r.finishedAt), [rounds]);
  const stats = useMemo(() => {
    const full = finished.map(summarizeRound).filter((s) => s.finished);
    const avg = full.length ? full.reduce((a, s) => a + s.toPar, 0) / full.length : undefined;
    const best = full.length ? Math.min(...full.map((s) => s.toPar)) : undefined;
    return { avg, best, points: totalPoints(rounds, attempts, shots) };
  }, [finished, rounds, attempts, shots]);
  const records = useMemo(() => roundRecords(rounds), [rounds]);
  const activeSessions = attempts.filter((a) => !a.endedAt).length;
  const daily = useMemo(() => dailyChallenges(new Date()), []);
  const liveSummary = live ? summarizeRound(live) : undefined;

  return (
    <Screen tab headerless title="Golf Assistant" subtitle="Track your game, one shot at a time.">
      {live && liveSummary ? (
        <Card onPress={() => router.push(`/round/${live.id}`)}>
          <ThemedText type="smallBold" themeColor="tint">
            ROUND IN PROGRESS
          </ThemedText>
          <ThemedText style={{ fontSize: 20, fontWeight: 700 }}>{live.courseName}</ThemedText>
          <ThemedText themeColor="textSecondary">
            Thru {liveSummary.holesPlayed} · {formatToPar(liveSummary.toPar)} · {liveSummary.strokes} strokes
          </ThemedText>
          {live.challengeIds.map((id) => {
            const c = roundChallengeById(id);
            if (!c) return null;
            const p = c.evaluate(live, { pastRounds: finished });
            return (
              <Row key={id}>
                <ThemedText type="small" style={{ width: 170 }} numberOfLines={1}>
                  {c.emoji} {c.title}
                </ThemedText>
                {/* The bar has no intrinsic width, so give it the rest of the row. */}
                <View style={{ flex: 1 }}>
                  <ProgressBar progress={p.progress} color={p.status === 'failed' ? '#999' : undefined} />
                </View>
              </Row>
            );
          })}
          <Button title="Open scorecard" onPress={() => router.push(`/round/${live.id}`)} />
        </Card>
      ) : (
        <Button title="Start a round" onPress={() => router.push('/round/new')} />
      )}

      <Card onPress={() => router.push('/tracer')}>
        <Row style={{ justifyContent: 'space-between' }}>
          <ThemedText type="smallBold">🎥 Shot Tracer</ThemedText>
          <ThemedText type="small" themeColor="tint">
            Open camera ›
          </ThemedText>
        </Row>
        <ThemedText type="small" themeColor="textSecondary">
          Film from behind and watch every shot back with a tracer following the ball down the fairway.
        </ThemedText>
      </Card>

      <SectionTitle>Your game</SectionTitle>
      <StatGrid>
        <Stat label="Rounds" value={finished.length} />
        <Stat label="Avg to par" value={stats.avg === undefined ? undefined : formatToPar(Math.round(stats.avg))} />
        <Stat label="Best" value={stats.best === undefined ? undefined : formatToPar(stats.best)} />
        <Stat label="Shots logged" value={shots.length} />
        <Stat label="Clubs in bag" value={clubs.filter((c) => c.inBag).length} />
        <Stat label="Challenge pts" value={stats.points} />
      </StatGrid>

      <Card onPress={() => router.push('/records')}>
        <Row style={{ justifyContent: 'space-between' }}>
          <ThemedText type="smallBold">🏆 Personal records</ThemedText>
          <ThemedText type="small" themeColor="tint">
            View all ›
          </ThemedText>
        </Row>
        <ThemedText type="small" themeColor="textSecondary">
          {[
            records.best18 && `Best 18: ${formatToPar(records.best18.value)}`,
            records.best9 && `Best 9: ${formatToPar(records.best9.value)}`,
            records.mostBirdies && `Most birdies: ${records.mostBirdies.value}`,
          ]
            .filter(Boolean)
            .join(' · ') || 'Longest shots per club, best rounds, streaks and more.'}
        </ThemedText>
      </Card>
      {activeSessions > 0 ? (
        <Card onPress={() => router.push('/challenges')}>
          <ThemedText type="smallBold" themeColor="tint">
            {activeSessions} range session{activeSessions > 1 ? 's' : ''} running ›
          </ThemedText>
        </Card>
      ) : null}

      <SectionTitle>Today&apos;s challenges</SectionTitle>
      {daily.map((c) => (
        <Card key={c.id} onPress={() => router.push('/challenges')}>
          <Row>
            <ThemedText style={{ fontSize: 26 }}>{c.emoji}</ThemedText>
            <ThemedText style={{ flex: 1 }}>
              <ThemedText type="smallBold">{c.title}</ThemedText>
              {'\n'}
              <ThemedText type="small" themeColor="textSecondary">
                {c.description}
              </ThemedText>
            </ThemedText>
            <ThemedText type="smallBold" themeColor="tint">
              +{c.points}
            </ThemedText>
          </Row>
        </Card>
      ))}

      <SectionTitle>Recent rounds</SectionTitle>
      {finished.length === 0 ? (
        <Empty title="No rounds yet" body="Start a round to keep score and take on challenges." />
      ) : (
        finished.slice(0, 5).map((r) => {
          const s = summarizeRound(r);
          return (
            <Card key={r.id} onPress={() => router.push(`/round/${r.id}`)}>
              <Row style={{ justifyContent: 'space-between' }}>
                <ThemedText type="smallBold" style={{ flex: 1 }}>
                  {r.courseName}
                </ThemedText>
                <ThemedText type="smallBold">
                  {s.strokes} ({formatToPar(s.toPar)})
                </ThemedText>
              </Row>
              <ThemedText type="small" themeColor="textSecondary">
                {new Date(r.startedAt).toLocaleDateString()} · {s.holesPlayed} holes · {s.putts} putts
              </ThemedText>
            </Card>
          );
        })
      )}
    </Screen>
  );
}
