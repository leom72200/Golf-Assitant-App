import { router } from 'expo-router';
import { useMemo } from 'react';

import { ThemedText } from '@/components/themed-text';
import { Card, Empty, Row, Screen, SectionTitle } from '@/components/ui';
import { clubRecords, roundRecords, SHOT_METRICS, type RecordEntry } from '@/domain/records';
import { formatToPar } from '@/domain/scoring';
import { useAppState } from '@/state/store';

const when = (e: RecordEntry) => new Date(e.date).toLocaleDateString();

function RecordRow({
  label,
  entry,
  format,
  onPress,
}: {
  label: string;
  entry?: RecordEntry;
  format: (v: number) => string;
  onPress?: () => void;
}) {
  if (!entry) return null;
  return (
    <Card onPress={onPress}>
      <Row style={{ justifyContent: 'space-between' }}>
        <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>
          {label}
        </ThemedText>
        <ThemedText type="smallBold" style={{ fontSize: 18 }}>
          {format(entry.value)}
        </ThemedText>
      </Row>
      <ThemedText type="small" themeColor="textSecondary">
        {[entry.label, when(entry)].filter(Boolean).join(' · ')}
      </ThemedText>
    </Card>
  );
}

export default function RecordsScreen() {
  const rounds = useAppState((s) => s.rounds);
  const shots = useAppState((s) => s.shots);
  const clubs = useAppState((s) => s.clubs);

  const rr = useMemo(() => roundRecords(rounds), [rounds]);
  const byClub = useMemo(
    () =>
      clubs
        .filter((c) => c.category !== 'putter')
        .map((c) => ({ club: c, records: clubRecords(shots.filter((s) => s.clubId === c.id)) }))
        .filter((x) => Object.keys(x.records).length > 0),
    [clubs, shots],
  );

  const openRound = (e?: RecordEntry) => (e?.roundId ? () => router.push(`/round/${e.roundId}`) : undefined);
  const hasRoundRecords = rr.best18 || rr.best9 || rr.mostBirdies || rr.longestParStreak || rr.mostFairways;

  return (
    <Screen>
      <SectionTitle>Rounds</SectionTitle>
      {!hasRoundRecords ? (
        <Empty title="No round records yet" body="Finish a round to start your record book." />
      ) : (
        <>
          <RecordRow label="Best 18-hole score" entry={rr.best18} format={formatToPar} onPress={openRound(rr.best18)} />
          <RecordRow label="Best 9-hole score" entry={rr.best9} format={formatToPar} onPress={openRound(rr.best9)} />
          <RecordRow label="Fewest putts (18)" entry={rr.fewestPutts18} format={String} onPress={openRound(rr.fewestPutts18)} />
          <RecordRow label="Most birdies in a round" entry={rr.mostBirdies} format={String} onPress={openRound(rr.mostBirdies)} />
          <RecordRow
            label="Longest par-or-better streak"
            entry={rr.longestParStreak}
            format={(v) => `${v} holes`}
            onPress={openRound(rr.longestParStreak)}
          />
          <RecordRow label="Most fairways hit" entry={rr.mostFairways} format={String} onPress={openRound(rr.mostFairways)} />
          <RecordRow label="Most greens in regulation" entry={rr.mostGreens} format={String} onPress={openRound(rr.mostGreens)} />
        </>
      )}

      {rr.courseBests.length > 0 ? (
        <>
          <SectionTitle>Course bests</SectionTitle>
          {rr.courseBests.map((b) => (
            <RecordRow key={b.roundId} label={b.courseName} entry={{ ...b, label: undefined }} format={formatToPar} onPress={openRound(b)} />
          ))}
        </>
      ) : null}

      <SectionTitle>Clubs</SectionTitle>
      {byClub.length === 0 ? (
        <Empty title="No club records yet" body="Log shots in My Bag or the Shot Lab and your bests show up here." />
      ) : (
        byClub.map(({ club, records }) => (
          <Card key={club.id} onPress={() => router.push(`/club/${club.id}`)}>
            <ThemedText type="smallBold">{club.name}</ThemedText>
            {SHOT_METRICS.map((m) => {
              const e = records[m.key];
              if (!e) return null;
              return (
                <Row key={m.key} style={{ justifyContent: 'space-between' }}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {m.label}
                  </ThemedText>
                  <ThemedText type="small">
                    <ThemedText type="smallBold">
                      {e.value.toFixed(m.digits)}
                      {m.unit ? ` ${m.unit}` : ''}
                    </ThemedText>{' '}
                    · {when(e)}
                  </ThemedText>
                </Row>
              );
            })}
          </Card>
        ))
      )}
    </Screen>
  );
}
