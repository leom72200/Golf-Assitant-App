import { useEventListener } from 'expo';
import { router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View, type GestureResponderEvent } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Chips, NumberField, num, Row, Screen, Stat, StatGrid } from '@/components/ui';
import {
  calibrateFromBall,
  measureLaunchOverTime,
  simulateFlight,
  typicalSpinForLoft,
  type PixelPoint,
} from '@/domain/launch';
import { useTheme } from '@/hooks/use-theme';
import { useAppState } from '@/state/store';

type Step = 'edgeA' | 'edgeB' | 'ballA' | 'ballB' | 'done';

const PROMPTS: Record<Step, string> = {
  edgeA: 'Pause on a frame before impact and tap the LEFT edge of the ball.',
  edgeB: 'Now tap the RIGHT edge of the same ball.',
  ballA: 'Step forward to the first frame where the ball has left the club, then tap its centre.',
  ballB: 'Step forward a few more frames (keep the ball in view) and tap its centre again.',
  done: 'Done. Adjust the frame rate fields if needed, then save the shot.',
};

/**
 * Manual "sim sensor": the player marks the ball by hand on a slow-motion clip and we compute
 * ball speed + launch angle. Taps are in the video view's own coordinate space, and so is the
 * calibration (ball diameter), so the units cancel and no video-pixel mapping is needed.
 */
export default function AnalyzeScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ uri: string; clubId?: string }>();
  const clubs = useAppState((s) => s.clubs);
  const clubOptions = useMemo(
    () => clubs.filter((c) => c.inBag && c.category !== 'putter').map((c) => ({ value: c.id, label: c.name })),
    [clubs],
  );
  const [clubId, setClubId] = useState(params.clubId || '7i');
  const club = clubs.find((c) => c.id === clubId);

  const player = useVideoPlayer(params.uri ?? null, (p) => {
    p.loop = false;
    p.muted = true;
  });

  const [fileFps, setFileFps] = useState('30');
  const [slowFactor, setSlowFactor] = useState('1');
  const [time, setTime] = useState(0);
  const [step, setStep] = useState<Step>('edgeA');
  const [edgeA, setEdgeA] = useState<PixelPoint>();
  const [edgeB, setEdgeB] = useState<PixelPoint>();
  const [ballA, setBallA] = useState<{ p: PixelPoint; t: number }>();
  const [ballB, setBallB] = useState<{ p: PixelPoint; t: number }>();

  // Pick up the clip's real frame rate once its track is known.
  useEventListener(player, 'videoTrackChange', ({ videoTrack }) => {
    const fps = videoTrack?.frameRate;
    if (fps && fps > 0) setFileFps(String(Math.round(fps)));
  });

  useEffect(() => {
    const id = setInterval(() => setTime(player.currentTime), 100);
    return () => clearInterval(id);
  }, [player]);

  const fps = num(fileFps) ?? 30;
  const frame = Math.round(time * fps);
  const step1 = (frames: number) => {
    player.pause();
    player.seekBy(frames / fps);
  };

  const onTap = (e: GestureResponderEvent) => {
    const p = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY };
    player.pause();
    const t = player.currentTime;
    if (step === 'edgeA') {
      setEdgeA(p);
      setStep('edgeB');
    } else if (step === 'edgeB') {
      setEdgeB(p);
      setStep('ballA');
    } else if (step === 'ballA') {
      setBallA({ p, t });
      setStep('ballB');
    } else if (step === 'ballB') {
      setBallB({ p, t });
      setStep('done');
    }
  };

  const reset = () => {
    setEdgeA(undefined);
    setEdgeB(undefined);
    setBallA(undefined);
    setBallB(undefined);
    setStep('edgeA');
  };

  const result = useMemo(() => {
    if (!edgeA || !edgeB || !ballA || !ballB) return undefined;
    const diameter = Math.hypot(edgeB.x - edgeA.x, edgeB.y - edgeA.y);
    const elapsed = (ballB.t - ballA.t) / (num(slowFactor) ?? 1);
    if (diameter < 2 || elapsed <= 0) return { error: 'Marks are too close together — reset and try again.' };
    const launch = measureLaunchOverTime(ballA.p, ballB.p, elapsed, calibrateFromBall(diameter), ballB.p.x >= ballA.p.x);
    const spinRpm = typicalSpinForLoft(club?.loft ?? 31);
    const flight = simulateFlight({ ...launch, spinRpm });
    const warning =
      launch.ballSpeedMph > 220
        ? 'That speed is higher than any golfer hits. Check the frame rate and slow-motion factor.'
        : launch.ballSpeedMph < 15
          ? 'Very slow — was the second mark on a later frame?'
          : undefined;
    return { launch, flight, spinRpm, warning, frames: Math.round((ballB.t - ballA.t) * fps) };
  }, [edgeA, edgeB, ballA, ballB, slowFactor, club, fps]);

  const marks = [edgeA, edgeB, ballA?.p, ballB?.p].filter((m): m is PixelPoint => !!m);

  return (
    <Screen>
      <View style={styles.videoBox}>
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
        <Pressable style={StyleSheet.absoluteFill} onPress={onTap} accessibilityLabel="Mark position on video">
          {marks.map((m, i) => (
            <View
              key={i}
              pointerEvents="none"
              style={[styles.mark, { left: m.x - 8, top: m.y - 8, borderColor: i < 2 ? '#FFD54F' : theme.tint }]}
            />
          ))}
        </Pressable>
      </View>

      <Row style={{ justifyContent: 'space-between' }}>
        <Button title="−10" variant="secondary" onPress={() => step1(-10)} />
        <Button title="−1" variant="secondary" onPress={() => step1(-1)} />
        <Button title="Play" variant="secondary" onPress={() => (player.playing ? player.pause() : player.play())} />
        <Button title="+1" variant="secondary" onPress={() => step1(1)} />
        <Button title="+10" variant="secondary" onPress={() => step1(10)} />
      </Row>
      <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
        Frame {frame} · {time.toFixed(3)}s
      </ThemedText>

      <Card>
        <ThemedText type="smallBold">
          Step {Math.min(4, ['edgeA', 'edgeB', 'ballA', 'ballB', 'done'].indexOf(step) + 1)} of 4
        </ThemedText>
        <ThemedText type="small">{PROMPTS[step]}</ThemedText>
        <Button title="Start over" variant="secondary" onPress={reset} />
      </Card>

      <Row style={{ flexWrap: 'wrap' }}>
        <NumberField label="File frame rate" value={fileFps} onChange={setFileFps} unit="fps" />
        <NumberField label="Slow-motion factor" value={slowFactor} onChange={setSlowFactor} unit="×" />
      </Row>
      <ThemedText type="small" themeColor="textSecondary">
        If your phone saved the clip as already-slowed video (e.g. filmed at 240 fps but playing at 30 fps), set the
        slow-motion factor to 8. If it plays at normal speed, leave it at 1. Effective capture rate:{' '}
        {Math.round(fps * (num(slowFactor) ?? 1))} fps.
      </ThemedText>

      <Chips options={clubOptions} selected={clubId} onSelect={setClubId} />

      {result && 'error' in result ? (
        <ThemedText themeColor="danger">{result.error}</ThemedText>
      ) : result ? (
        <Card>
          <StatGrid>
            <Stat label="Ball speed" value={result.launch.ballSpeedMph.toFixed(0)} unit="mph" />
            <Stat label="Launch" value={result.launch.launchAngleDeg.toFixed(1)} unit="°" />
            <Stat label="Est. carry" value={result.flight.carryYards.toFixed(0)} unit="yds" />
          </StatGrid>
          <ThemedText type="small" themeColor="textSecondary">
            Measured over {result.frames} frames. Carry assumes ~{result.spinRpm} rpm of spin, typical for a{' '}
            {club?.name ?? 'club'}.
          </ThemedText>
          {result.warning ? <ThemedText themeColor="warning">{result.warning}</ThemedText> : null}
          <Button
            title="Save shot"
            onPress={() =>
              router.push({
                pathname: '/shot/new',
                params: {
                  clubId,
                  source: 'camera',
                  ballSpeed: result.launch.ballSpeedMph.toFixed(1),
                  launch: result.launch.launchAngleDeg.toFixed(1),
                  spin: String(result.spinRpm),
                  carry: result.flight.carryYards.toFixed(0),
                  total: result.flight.totalYards.toFixed(0),
                },
              })
            }
          />
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  videoBox: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', borderRadius: 12, overflow: 'hidden' },
  mark: { position: 'absolute', width: 16, height: 16, borderRadius: 8, borderWidth: 2 },
});
