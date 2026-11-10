import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Empty, ProgressBar, Row, Screen, SectionTitle, Stat, StatGrid, ToggleRow } from '@/components/ui';
import { challengeById } from '@/domain/challenges';
import { formatToPar, isPlayed, scoreName, summarizeRound, toPar } from '@/domain/scoring';
import type { HoleScore } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';
import { dispatch, useAppState } from '@/state/store';

export default function ScorecardScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const rounds = useAppState((s) => s.rounds);
  const courses = useAppState((s) => s.courses);
  const round = rounds.find((r) => r.id === id);
  const course = courses.find((c) => c.id === round?.courseId);
  const [current, setCurrent] = useState(() => {
    const next = round?.scores.find((h) => !isPlayed(h));
    return next?.hole ?? 1;
  });

  const pastRounds = useMemo(
    () => rounds.filter((r) => r.finishedAt && round && r.startedAt < round.startedAt),
    [rounds, round],
  );

  if (!round) return <Empty title="Round not found" />;
  const summary = summarizeRound(round);
  // Hole numbers can have gaps (a course may not have every hole mapped), so navigate by index.
  const index = Math.max(0, round.scores.findIndex((h) => h.hole === current));
  const score = round.scores[index];
  const mapped = course?.holes.some((h) => h.number === score.hole);
  const finished = !!round.finishedAt;

  const update = (patch: Partial<HoleScore>) =>
    dispatch({ type: 'round/score', roundId: round.id, score: { ...score, ...patch } });

  const finish = () =>
    Alert.alert(
      'Finish round?',
      summary.finished ? undefined : `Only ${summary.holesPlayed} of ${summary.totalHoles} holes have a score.`,
      [
        { text: 'Keep playing', style: 'cancel' },
        {
          text: 'Finish',
          onPress: () => dispatch({ type: 'round/finish', roundId: round.id, finishedAt: new Date().toISOString() }),
        },
      ],
    );

  return (
    <Screen>
      <Stack.Screen options={{ title: round.courseName }} />

      <StatGrid>
        <Stat label={finished ? 'Final' : `Thru ${summary.holesPlayed}`} value={summary.holesPlayed ? formatToPar(summary.toPar) : undefined} />
        <Stat label="Strokes" value={summary.strokes || undefined} />
        <Stat label="Putts" value={summary.putts || undefined} />
      </StatGrid>

      {/* Hole picker strip, coloured by result. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {round.scores.map((h) => {
          const diff = isPlayed(h) ? toPar(h) : undefined;
          const color =
            diff === undefined ? theme.backgroundElement : diff < 0 ? '#2E7D32' : diff === 0 ? theme.backgroundSelected : diff === 1 ? '#8D6E63' : '#C62828';
          return (
            <Pressable
              key={h.hole}
              onPress={() => setCurrent(h.hole)}
              style={[
                styles.holeChip,
                { backgroundColor: color, borderColor: h.hole === current ? theme.tint : 'transparent' },
              ]}>
              <ThemedText type="small" style={{ fontSize: 11, color: diff !== undefined && diff !== 0 ? '#fff' : theme.textSecondary }}>
                {h.hole}
              </ThemedText>
              <ThemedText type="smallBold" style={{ color: diff !== undefined && diff !== 0 ? '#fff' : theme.text }}>
                {h.strokes ?? '·'}
              </ThemedText>
            </Pressable>
          );
        })}
      </ScrollView>

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <ThemedText type="smallBold">
            Hole {score.hole} · Par {score.par}
          </ThemedText>
          {mapped ? (
            <Pressable onPress={() => router.push(`/course/${course!.id}/hole/${score.hole}`)}>
              <ThemedText type="smallBold" themeColor="tint">
                Hole map & GPS ›
              </ThemedText>
            </Pressable>
          ) : null}
        </Row>
        {!course ? (
          <Stepper label="Par" value={score.par} min={3} max={6} onChange={(par) => update({ par })} />
        ) : null}
        <Stepper
          label="Strokes"
          value={score.strokes}
          min={1}
          max={15}
          placeholder={score.par}
          onChange={(strokes) => update({ strokes })}
          note={isPlayed(score) ? scoreName(toPar(score)) : undefined}
        />
        <Stepper label="Putts" value={score.putts} min={0} max={6} placeholder={2} onChange={(putts) => update({ putts })} />
        <Stepper label="Penalties" value={score.penalties ?? 0} min={0} max={6} onChange={(penalties) => update({ penalties })} />
        {score.par >= 4 ? (
          <ToggleRow label="Fairway hit" value={!!score.fairwayHit} onChange={(fairwayHit) => update({ fairwayHit })} />
        ) : null}
        <ToggleRow label="Played from a bunker" value={!!score.sandShot} onChange={(sandShot) => update({ sandShot })} />
        <Row>
          <Button
            title="‹ Prev"
            variant="secondary"
            style={{ flex: 1 }}
            disabled={index <= 0}
            onPress={() => setCurrent(round.scores[index - 1].hole)}
          />
          <Button
            title="Next ›"
            style={{ flex: 1 }}
            disabled={index >= round.scores.length - 1}
            onPress={() => setCurrent(round.scores[index + 1].hole)}
          />
        </Row>
      </Card>

      {round.challengeIds.length > 0 ? <SectionTitle>Challenges</SectionTitle> : null}
      {round.challengeIds.map((cid) => {
        const c = challengeById(cid);
        if (!c) return null;
        const p = c.evaluate(round, { pastRounds });
        const color = p.status === 'completed' ? theme.success : p.status === 'failed' ? theme.danger : undefined;
        return (
          <Card key={cid}>
            <Row style={{ justifyContent: 'space-between' }}>
              <ThemedText type="smallBold">
                {c.emoji} {c.title}
              </ThemedText>
              <ThemedText type="smallBold" style={{ color: color ?? theme.textSecondary }}>
                {p.status === 'completed' ? `+${c.points} ✓` : p.status === 'failed' ? 'Missed' : `+${c.points}`}
              </ThemedText>
            </Row>
            <ProgressBar progress={p.progress} color={color} />
            <ThemedText type="small" themeColor="textSecondary">
              {p.detail}
            </ThemedText>
          </Card>
        );
      })}

      {finished ? (
        <Button
          title="Delete round"
          variant="danger"
          onPress={() =>
            Alert.alert('Delete this round?', undefined, [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () => {
                  router.back();
                  dispatch({ type: 'round/delete', id: round.id });
                },
              },
            ])
          }
        />
      ) : (
        <Button title="Finish round" variant="secondary" onPress={finish} />
      )}
    </Screen>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
  placeholder,
  note,
}: {
  label: string;
  value: number | undefined;
  min: number;
  max: number;
  onChange: (v: number) => void;
  placeholder?: number;
  note?: string;
}) {
  const theme = useTheme();
  const shown = value ?? placeholder ?? min;
  const set = (v: number) => onChange(Math.max(min, Math.min(max, v)));
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      <View>
        <ThemedText>{label}</ThemedText>
        {note ? (
          <ThemedText type="small" themeColor="tint">
            {note}
          </ThemedText>
        ) : null}
      </View>
      <Row>
        <Pressable
          onPress={() => set((value ?? placeholder ?? min) - 1)}
          accessibilityLabel={`Decrease ${label}`}
          style={[styles.stepBtn, { backgroundColor: theme.backgroundSelected }]}>
          <ThemedText style={styles.stepText}>−</ThemedText>
        </Pressable>
        <Pressable onPress={() => value === undefined && set(shown)}>
          <ThemedText style={[styles.stepValue, { opacity: value === undefined ? 0.35 : 1 }]}>{shown}</ThemedText>
        </Pressable>
        <Pressable
          onPress={() => set(value === undefined ? shown : value + 1)}
          accessibilityLabel={`Increase ${label}`}
          style={[styles.stepBtn, { backgroundColor: theme.backgroundSelected }]}>
          <ThemedText style={styles.stepText}>+</ThemedText>
        </Pressable>
      </Row>
    </Row>
  );
}

const styles = StyleSheet.create({
  holeChip: { width: 40, paddingVertical: 4, borderRadius: 8, alignItems: 'center', borderWidth: 2 },
  stepBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 22, lineHeight: 26, fontWeight: 700 },
  stepValue: { fontSize: 24, fontWeight: 800, minWidth: 36, textAlign: 'center' },
});
