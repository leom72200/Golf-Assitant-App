import { useMemo, useState } from 'react';
import { Alert, Pressable } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Empty, Row, Screen, SectionTitle, Stat, StatGrid } from '@/components/ui';
import { summarizeTracerTests } from '@/domain/tracerTests';
import { deleteTestClip, shareClip, shareReport } from '@/services/tracerTestStore';
import { dispatch, useAppState } from '@/state/store';

/** Shot Tracer field tests: what was kept, how detection is doing, and exporting it all. */
export default function TracerTestsScreen() {
  const records = useAppState((s) => s.tracerTests);
  const clubs = useAppState((s) => s.clubs);
  const summary = useMemo(() => summarizeTracerTests(records), [records]);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      Alert.alert('Sharing failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const pct = (x: number) => `${Math.round(x * 100)}%`;

  return (
    <Screen>
      <ThemedText themeColor="textSecondary">
        Each test keeps the shot&apos;s video, what the app detected (impact time, where the ball was first seen, start
        line) and your notes on what really happened. Share the report and a few clips so the tracer can be tuned on
        real footage.
      </ThemedText>

      <StatGrid>
        <Stat label="Tests" value={summary.shots} />
        <Stat label="Ball found" value={summary.shots ? pct(summary.ballFoundRate) : undefined} />
        <Stat label="Start line seen" value={summary.shots ? pct(summary.startDetectedRate) : undefined} />
        <Stat label="Sound vs video" value={summary.meanAudioOffsetMs} unit="ms" />
        <Stat label="Start corrected" value={summary.meanStartCorrectionDeg} unit="°" />
        <Stat label="Matched / close / off" value={summary.shots ? `${summary.matched.yes}/${summary.matched.close}/${summary.matched.no}` : undefined} />
      </StatGrid>

      <Button title="Share report (all tests, JSON)" onPress={() => run(() => shareReport(records))} disabled={busy || records.length === 0} />

      <Card>
        <ThemedText type="smallBold">Getting good test data</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          • Mix clubs: a few wedges, mid irons and drivers.{'\n'}• Mix conditions: sunny and cloudy, trees and open sky
          behind.{'\n'}• Fill in where it landed and the shape every time, even roughly.{'\n'}• Note the phone&apos;s distance
          behind the ball and its height once — they&apos;re remembered.{'\n'}• 10–20 shots is a great first batch.
        </ThemedText>
      </Card>

      <SectionTitle>Tests</SectionTitle>
      {records.length === 0 ? (
        <Empty title="No tests yet" body="Turn on Test mode in Shot Tracer, then hit some shots." />
      ) : (
        records.map((r) => (
          <Card key={r.id}>
            <Row style={{ justifyContent: 'space-between' }}>
              <ThemedText type="smallBold">
                {clubs.find((c) => c.id === r.final.clubId)?.name ?? 'Shot'} · {new Date(r.createdAt).toLocaleString()}
              </ThemedText>
            </Row>
            <ThemedText type="small" themeColor="textSecondary">
              {r.detection.ballFound ? 'Ball found' : 'Ball not found'} ·{' '}
              {r.detection.startDeg !== undefined ? `start ${r.detection.startDeg.toFixed(1)}° → ${r.final.startDeg.toFixed(1)}°` : 'start not seen'} ·
              carry {r.final.carryYards}
              {r.notes.landedYards !== undefined ? ` (landed ${r.notes.landedYards})` : ''}
              {r.notes.shape ? ` · ${r.notes.shape}` : ''}
              {r.notes.matched ? ` · ${r.notes.matched === 'yes' ? 'matched' : r.notes.matched === 'close' ? 'close' : 'off'}` : ''}
            </ThemedText>
            <Row>
              <Pressable onPress={() => run(() => shareClip(r.videoFile))} disabled={busy}>
                <ThemedText type="small" themeColor="tint">
                  Share clip
                </ThemedText>
              </Pressable>
              <Pressable
                onPress={() =>
                  Alert.alert('Delete this test?', 'The clip is removed from the app.', [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: () => {
                        deleteTestClip(r.videoFile);
                        dispatch({ type: 'tracerTest/delete', id: r.id });
                      },
                    },
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
