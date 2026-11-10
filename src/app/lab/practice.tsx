/**
 * Camera practice mode: the phone films side-on at 240 fps, listens for the sound of impact,
 * and measures each shot automatically. Nothing is kept unless you choose to save it.
 *
 * Flow: Aim (record a moment, tap the ball) -> Armed (rolling clips + impact listener)
 *       -> on impact: stop, analyse ~40 frames, show ball speed / launch / carry, re-arm.
 */
import { requestRecordingPermissionsAsync, RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { router, Stack } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Image, Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { TrajectoryChart } from '@/components/trajectory-chart';
import { Button, Card, Chips, Row, Screen, Stat, StatGrid, ToggleRow } from '@/components/ui';
import { ImpactDetector } from '@/domain/impactDetector';
import { simulateFlight, typicalSpinForLoft, type FlightResult } from '@/domain/launch';
import type { BallFix, GrayFrame, ShotMeasurement } from '@/domain/tracking';
import { useTheme } from '@/hooks/use-theme';
import { analysisSize, ClipFrames, deleteQuietly, type ClipGeometry } from '@/services/clipFrames';
import { analyzeClip, calibrateOnBall, type PracticeSetup } from '@/services/practiceAnalysis';
import { dispatch, newId, useAppState } from '@/state/store';

import {
  getHighSpeedCapabilities,
  HighSpeedCameraView,
  isHighSpeedCameraAvailable,
  uprightRotation,
  type CameraReadyEvent,
  type HighSpeedCameraRef,
  type RecordingResult,
} from '../../../modules/highspeed-camera';

/** Restart the rolling clip this often when nothing happens, so files stay small. */
const ROLL_MS = 12_000;
/** Keep recording this long after the impact sound so the ball's flight is in the clip. */
const AFTER_IMPACT_MS = 350;
const METER_POLL_MS = 30;
const HEAT_WARNING_MIN = 20;

type Phase = 'idle' | 'aiming' | 'confirm' | 'armed';

interface SessionShot {
  id: string;
  clubId: string;
  measurement: ShotMeasurement;
  flight: FlightResult;
  saved: boolean;
  analysisMs: number;
}

export default function PracticeScreen() {
  const caps = useMemo(() => getHighSpeedCapabilities(), []);
  if (!isHighSpeedCameraAvailable) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Practice mode' }} />
        <Card>
          <ThemedText type="smallBold">Needs the Golf Assistant app build</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Practice mode uses custom 240 fps camera code that isn&apos;t included in Expo Go. Install the
            development build of this app (see the README: &quot;Build for your phone&quot;) and open it from there.
          </ThemedText>
        </Card>
        <Button title="Use the manual clip analyzer instead" variant="secondary" onPress={() => router.replace('/lab')} />
      </Screen>
    );
  }
  if (!caps.supported) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Practice mode' }} />
        <Card>
          <ThemedText type="smallBold">No high-speed camera mode</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            This phone doesn&apos;t let apps record at 120 or 240 fps. You can still film in your camera app&apos;s
            slow-motion mode and use the manual clip analyzer.
          </ThemedText>
        </Card>
        <Button title="Back to Shot Lab" variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }
  return <PracticeSession />;
}

function PracticeSession() {
  useKeepAwake();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const clubs = useAppState((s) => s.clubs);
  const clubOptions = useMemo(
    () => clubs.filter((c) => c.inBag && c.category !== 'putter').map((c) => ({ value: c.id, label: c.name })),
    [clubs],
  );

  // ---- Permissions & orientation ----
  const [camPerm, requestCam] = useCameraPermissions();
  const [micGranted, setMicGranted] = useState<boolean>();
  useEffect(() => {
    requestRecordingPermissionsAsync().then((p) => setMicGranted(p.granted));
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, []);

  // ---- Camera ----
  const camera = useRef<HighSpeedCameraRef>(null);
  const [cameraInfo, setCameraInfo] = useState<CameraReadyEvent>();
  const [cameraError, setCameraError] = useState<string>();
  // Android takes the camera away in the background: release it, and reopen on return.
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      setAppActive(state === 'active');
      if (state !== 'active') setCameraInfo(undefined);
    });
    return () => sub.remove();
  }, []);

  // ---- Session state ----
  const [phase, setPhase] = useState<Phase>('idle');
  const [setup, setSetup] = useState<PracticeSetup>();
  const [clubId, setClubId] = useState(() => clubOptions.find((o) => o.value === '7i')?.value ?? clubOptions[0]?.value);
  const [autoSave, setAutoSave] = useState(false);
  const [shots, setShots] = useState<SessionShot[]>([]);
  const [status, setStatus] = useState<string>();
  const [analyzing, setAnalyzing] = useState(false);
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Values read inside async loops.
  const setupRef = useRef(setup);
  const clubRef = useRef(clubId);
  const autoSaveRef = useRef(autoSave);
  useEffect(() => {
    setupRef.current = setup;
    clubRef.current = clubId;
    autoSaveRef.current = autoSave;
  }, [setup, clubId, autoSave]);

  const audio = useAudioRecorder({ ...RecordingPresets.LOW_QUALITY, isMeteringEnabled: true });

  // ---- Aim: record a moment, show a still, tap the ball ----
  const [aim, setAim] = useState<{
    clip: ClipFrames;
    geometry: ClipGeometry;
    still: { uri: string; gray: GrayFrame };
    frame: number;
    ball?: BallFix;
    pixelsPerMeter?: number;
    direction: 1 | -1;
  }>();

  const loadStill = useCallback(async (clip: ClipFrames, geometry: ClipGeometry, frame: number) => {
    const still = await clip.still(frame);
    setAim((prev) => {
      if (prev && prev.still.uri !== still.uri) deleteQuietly(prev.still.uri);
      return { clip, geometry, still, frame, direction: 1 };
    });
  }, []);

  const startAim = async () => {
    if (!camera.current) return;
    setStatus(undefined);
    setPhase('aiming');
    try {
      await camera.current.startRecording();
      await new Promise((r) => setTimeout(r, 500));
      const rec = await camera.current.stopRecording();
      const geometry: ClipGeometry = {
        width: rec.width,
        height: rec.height,
        fps: rec.fps,
        rotation: uprightRotation(rec.sensorOrientation, rec.displayRotation),
      };
      aim?.clip.release(true);
      const clip = new ClipFrames(rec.uri, geometry);
      await loadStill(clip, geometry, Math.round(rec.fps * 0.25));
      setPhase('confirm');
    } catch (e) {
      setStatus(`Couldn't capture a frame: ${e instanceof Error ? e.message : String(e)}`);
      setPhase('idle');
    }
  };

  const rotateAim = async () => {
    if (!aim) return;
    const geometry = { ...aim.geometry, rotation: (aim.geometry.rotation + 90) % 360 };
    await loadStill(aim.clip, geometry, aim.frame);
  };

  const [stillLayout, setStillLayout] = useState({ width: 1, height: 1 });
  const onTapStill = async (x: number, y: number) => {
    if (!aim) return;
    const size = analysisSize(aim.geometry);
    const tap = { x: (x / stillLayout.width) * size.width, y: (y / stillLayout.height) * size.height };
    const found = await calibrateOnBall(aim.clip, aim.still.gray, aim.frame, tap, aim.geometry);
    if (!found) {
      setStatus("Couldn't find a ball there. Tap right on the ball (it needs to stand out from the ground).");
      return;
    }
    setStatus(undefined);
    // Guess the flight direction: away from the nearer edge.
    const direction: 1 | -1 = found.ball.x < size.width / 2 ? 1 : -1;
    setAim({ ...aim, ball: found.ball, pixelsPerMeter: found.pixelsPerMeter, direction });
  };

  const confirmAim = () => {
    if (!aim?.ball || !aim.pixelsPerMeter) return;
    setSetup({ geometry: aim.geometry, ball: aim.ball, direction: aim.direction, pixelsPerMeter: aim.pixelsPerMeter });
    aim.clip.release(true);
    deleteQuietly(aim.still.uri);
    setAim(undefined);
    setPhase('armed');
  };

  // Clean up an abandoned aim clip.
  const aimRef = useRef(aim);
  useEffect(() => {
    aimRef.current = aim;
  }, [aim]);
  useEffect(
    () => () => {
      aimRef.current?.clip.release(true);
      deleteQuietly(aimRef.current?.still.uri);
    },
    [],
  );

  const saveShot = useCallback((shot: SessionShot, spinRpm?: number) => {
    const club = clubs.find((c) => c.id === shot.clubId);
    dispatch({
      type: 'shot/add',
      shot: {
        id: shot.id,
        clubId: shot.clubId,
        createdAt: new Date().toISOString(),
        source: 'camera',
        ballSpeedMph: Math.round(shot.measurement.ballSpeedMph * 10) / 10,
        launchAngleDeg: Math.round(shot.measurement.launchAngleDeg * 10) / 10,
        spinRpm: spinRpm ?? typicalSpinForLoft(club?.loft ?? 31),
        carryYards: Math.round(shot.flight.carryYards),
        totalYards: Math.round(shot.flight.totalYards),
        notes: 'Practice mode (spin estimated)',
      },
    });
  }, [clubs]);

  // ---- Handling one recorded shot ----
  const handleClip = useCallback(async (clip: RecordingResult, heardAt: number, stopAt: number) => {
    const s = setupRef.current;
    if (!s) {
      deleteQuietly(clip.uri);
      return;
    }
    setAnalyzing(true);
    setStatus('Analysing shot…');
    try {
      const res = await analyzeClip(clip, s, heardAt, stopAt);
      if (res.ball) setSetup((prev) => (prev ? { ...prev, ball: res.ball! } : prev));
      if (res.status !== 'ok') {
        setStatus(res.reason);
        return;
      }
      const club = clubs.find((c) => c.id === clubRef.current);
      const spinRpm = typicalSpinForLoft(club?.loft ?? 31);
      const flight = simulateFlight({
        ballSpeedMph: res.measurement.ballSpeedMph,
        launchAngleDeg: res.measurement.launchAngleDeg,
        spinRpm,
      });
      const shot: SessionShot = {
        id: newId(),
        clubId: clubRef.current ?? '7i',
        measurement: res.measurement,
        flight,
        saved: false,
        analysisMs: res.elapsedMs,
      };
      if (autoSaveRef.current) {
        saveShot(shot, spinRpm);
        shot.saved = true;
      }
      setShots((prev) => [shot, ...prev].slice(0, 50));
      setStatus(undefined);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) {
      setStatus(`Analysis failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAnalyzing(false);
    }
  }, [clubs, saveShot]);

  // ---- Armed loop: rolling 240 fps clips + impact listener ----
  useEffect(() => {
    if (phase !== 'armed' || !cameraInfo) return;
    const cam = camera.current;
    if (!cam) return;
    let cancelled = false;
    let busy = false;
    let recordingSince = 0;
    let interval: ReturnType<typeof setInterval> | undefined;
    const detector = new ImpactDetector();

    const startClip = async () => {
      await cam.startRecording();
      recordingSince = Date.now();
    };
    const stopClip = async (): Promise<RecordingResult | undefined> => {
      try {
        return await cam.stopRecording();
      } catch {
        return undefined;
      }
    };

    const tick = async () => {
      if (cancelled || busy) return;
      const level = audio.getStatus().metering;
      const t = Date.now();
      if (level !== undefined && detector.push(level, t)) {
        busy = true;
        const heardAt = t;
        setTimeout(async () => {
          const stopAt = Date.now();
          const clip = await stopClip();
          if (cancelled) {
            deleteQuietly(clip?.uri);
            return;
          }
          if (clip) await handleClip(clip, heardAt, stopAt);
          if (!cancelled) await startClip().catch((e) => setStatus(`Camera: ${String(e)}`));
          busy = false;
        }, AFTER_IMPACT_MS);
        return;
      }
      if (t - recordingSince > ROLL_MS) {
        busy = true;
        const clip = await stopClip();
        deleteQuietly(clip?.uri);
        if (!cancelled) await startClip().catch((e) => setStatus(`Camera: ${String(e)}`));
        busy = false;
      }
    };

    (async () => {
      try {
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await audio.prepareToRecordAsync();
        audio.record();
        await startClip();
        if (!cancelled) interval = setInterval(tick, METER_POLL_MS);
      } catch (e) {
        setStatus(`Couldn't start listening: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      stopClip().then((c) => deleteQuietly(c?.uri));
      audio
        .stop()
        .then(() => deleteQuietly(audio.uri ?? undefined))
        .catch(() => {});
    };
  }, [phase, cameraInfo, audio, handleClip]);

  // ---- Render ----
  const latest = shots[0];
  const minutes = Math.floor((now - startedAt) / 60_000);
  const avg = (key: 'ballSpeedMph' | 'launchAngleDeg') =>
    shots.length ? shots.reduce((s, x) => s + x.measurement[key], 0) / shots.length : undefined;

  const permsMissing = camPerm && !camPerm.granted;
  if (permsMissing || micGranted === false) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Practice mode' }} />
        <ThemedText themeColor="textSecondary">
          Practice mode needs the camera to film your shots and the microphone to hear the moment of impact. Audio is
          only used for timing and is never saved.
        </ThemedText>
        <Button
          title="Allow access"
          onPress={async () => {
            if (permsMissing) await requestCam();
            const p = await requestRecordingPermissionsAsync();
            setMicGranted(p.granted);
          }}
        />
      </Screen>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Camera / aim image */}
      <View style={styles.cameraPane}>
        {camPerm?.granted ? (
          <HighSpeedCameraView
            ref={camera}
            style={StyleSheet.absoluteFill}
            active={appActive}
            fps={240}
            preferredHeight={1080}
            onCameraReady={(e) => setCameraInfo(e.nativeEvent)}
            onCameraError={(e) => setCameraError(e.nativeEvent.message)}
          />
        ) : null}

        {phase === 'confirm' && aim ? (
          <View style={styles.aimOverlay}>
            <View
              style={{ width: '100%', aspectRatio: analysisSize(aim.geometry).width / analysisSize(aim.geometry).height, maxHeight: '100%' }}
              onLayout={(e: LayoutChangeEvent) => setStillLayout(e.nativeEvent.layout)}>
              <Image source={{ uri: aim.still.uri }} style={StyleSheet.absoluteFill} resizeMode="stretch" />
              <Pressable
                style={StyleSheet.absoluteFill}
                onPress={(e) => onTapStill(e.nativeEvent.locationX, e.nativeEvent.locationY)}
                accessibilityLabel="Tap the ball">
                {aim.ball ? (
                  <View
                    pointerEvents="none"
                    style={[
                      styles.ballRing,
                      {
                        left: (aim.ball.x / analysisSize(aim.geometry).width) * stillLayout.width - 14,
                        top: (aim.ball.y / analysisSize(aim.geometry).height) * stillLayout.height - 14,
                      },
                    ]}
                  />
                ) : null}
              </Pressable>
            </View>
          </View>
        ) : null}

        <Pressable onPress={() => router.back()} style={[styles.close, { top: insets.top + 8, left: insets.left + 12 }]} hitSlop={12}>
          <ThemedText style={styles.overlayText}>✕ Close</ThemedText>
        </Pressable>
        {phase === 'armed' ? (
          <View style={[styles.badge, { top: insets.top + 8 }]}>
            <ThemedText type="smallBold" style={styles.overlayText}>
              {analyzing ? '⏳ Analysing…' : '● Listening — hit when ready'}
            </ThemedText>
          </View>
        ) : null}
      </View>

      {/* Side panel */}
      <ScrollView
        style={styles.panel}
        contentContainerStyle={{ padding: 12, gap: 10, paddingRight: insets.right + 12, paddingBottom: insets.bottom + 12 }}>
        {cameraError ? <ThemedText themeColor="danger">{cameraError}</ThemedText> : null}
        {!cameraInfo && !cameraError ? (
          <Row>
            <ActivityIndicator />
            <ThemedText type="small">Starting the 240 fps camera…</ThemedText>
          </Row>
        ) : null}
        {cameraInfo ? (
          <ThemedText type="small" themeColor="textSecondary">
            {cameraInfo.width}×{cameraInfo.height} at {cameraInfo.fps} fps
          </ThemedText>
        ) : null}

        {phase === 'idle' || phase === 'aiming' ? (
          <Card>
            <ThemedText type="smallBold">1. Set up</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Phone on a tripod or the ground, sideways (landscape), about 2 m / 7 ft from the ball, side-on so the ball
              flies across the screen. Ball in the left or right third. Bright light helps a lot.
            </ThemedText>
            <Button title={phase === 'aiming' ? 'Capturing…' : 'Aim on the ball'} onPress={startAim} disabled={!cameraInfo || phase === 'aiming'} />
          </Card>
        ) : null}

        {phase === 'confirm' && aim ? (
          <Card>
            <ThemedText type="smallBold">2. Tap the ball</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {aim.ball
                ? `Found it. Ball flies ${aim.direction === 1 ? 'left → right' : 'right → left'}.`
                : 'Tap the ball in the picture. If the picture is sideways, rotate it.'}
            </ThemedText>
            <Row style={{ flexWrap: 'wrap' }}>
              <Button title="Rotate picture" variant="secondary" onPress={rotateAim} />
              {aim.ball ? (
                <Button
                  title={aim.direction === 1 ? 'Flies → (flip)' : 'Flies ← (flip)'}
                  variant="secondary"
                  onPress={() => setAim({ ...aim, direction: aim.direction === 1 ? -1 : 1 })}
                />
              ) : null}
              <Button title="Retake" variant="secondary" onPress={startAim} />
            </Row>
            <Button title="Start practising" onPress={confirmAim} disabled={!aim.ball} />
          </Card>
        ) : null}

        {phase === 'armed' ? (
          <>
            <Chips options={clubOptions} selected={clubId} onSelect={setClubId} />
            {latest ? (
              <Card>
                <StatGrid>
                  <Stat label="Ball speed" value={latest.measurement.ballSpeedMph.toFixed(0)} unit="mph" />
                  <Stat label="Launch" value={latest.measurement.launchAngleDeg.toFixed(1)} unit="°" />
                  <Stat label="Carry" value={latest.flight.carryYards.toFixed(0)} unit="yds" />
                  <Stat label="Total" value={latest.flight.totalYards.toFixed(0)} unit="yds" />
                </StatGrid>
                <TrajectoryChart points={latest.flight.trajectory} height={110} />
                <ThemedText type="small" themeColor="textSecondary">
                  Confidence {Math.round(latest.measurement.confidence * 100)}% · {latest.measurement.pointsUsed} frames ·
                  analysed in {(latest.analysisMs / 1000).toFixed(1)}s. Carry assumes typical spin; direction (left/right)
                  isn&apos;t measured from side-on.
                </ThemedText>
                {!latest.saved ? (
                  <Button
                    title="Save to My Bag"
                    variant="secondary"
                    onPress={() => {
                      saveShot(latest);
                      setShots((prev) => prev.map((s) => (s.id === latest.id ? { ...s, saved: true } : s)));
                    }}
                  />
                ) : (
                  <ThemedText type="small" themeColor="tint">
                    Saved ✓
                  </ThemedText>
                )}
              </Card>
            ) : (
              <Card>
                <ThemedText type="small" themeColor="textSecondary">
                  Hit a ball. The app hears the impact, measures the shot and shows it here in a few seconds.
                </ThemedText>
              </Card>
            )}
            {status ? <ThemedText type="small" themeColor="warning">{status}</ThemedText> : null}
            {shots.length > 1 ? (
              <ThemedText type="small" themeColor="textSecondary">
                {shots.length} shots · avg {avg('ballSpeedMph')!.toFixed(0)} mph · avg launch {avg('launchAngleDeg')!.toFixed(1)}°
              </ThemedText>
            ) : null}
            <ToggleRow label="Save every shot" hint="Adds them to My Bag stats" value={autoSave} onChange={setAutoSave} />
            <Button title="Re-aim" variant="secondary" onPress={() => { setPhase('idle'); setSetup(undefined); }} />
            {minutes >= HEAT_WARNING_MIN ? (
              <ThemedText type="small" themeColor="warning">
                {minutes} min of 240 fps filming — if the phone gets hot, take a break.
              </ThemedText>
            ) : null}
          </>
        ) : null}

        {status && phase !== 'armed' ? <ThemedText type="small" themeColor="warning">{status}</ThemedText> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  cameraPane: { flex: 3, backgroundColor: '#000', overflow: 'hidden' },
  aimOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  ballRing: { position: 'absolute', width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: '#FFD54F' },
  panel: { flex: 2 },
  close: { position: 'absolute' },
  badge: { position: 'absolute', right: 12, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  overlayText: { color: '#fff', textShadowColor: '#000', textShadowRadius: 4 },
});
