/**
 * Shot Tracer: film from BEHIND the player, looking down the fairway, with the phone upright. The camera stays open and
 * listens for the impact, keeps filming while the ball flies, then plays the shot back with the
 * tracer drawn on the video. Works with the phone's normal camera (no custom build needed).
 *
 * Flow: live camera -> impact heard -> keep filming ~6 s -> (first time: tap ball + target)
 *       -> detect start line -> replay with tracer, adjust if needed -> next shot.
 */
import { requestRecordingPermissionsAsync, RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { Asset, requestPermissionsAsync as requestMediaPermissionsAsync } from 'expo-media-library';
import { router, Stack } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Chips, Row, Screen } from '@/components/ui';
import { VideoTracer } from '@/components/video-tracer';
import { defaultShape, finishOffline, tracerFlight, type TracerShape } from '@/domain/behindCamera';
import { clubStats, typicalCarryForLoft } from '@/domain/clubs';
import { ImpactDetector } from '@/domain/impactDetector';
import type { Point2 } from '@/domain/tracerProjection';
import type { GrayFrame } from '@/domain/tracking';
import { useTheme } from '@/hooks/use-theme';
import { useTracerStyle } from '@/hooks/use-tracer';
import { analysisSize, ClipFrames, deleteQuietly, type ClipGeometry } from '@/services/clipFrames';
import {
  ballNear,
  calibrationFor,
  detectTracerLaunch,
  probeVideo,
  tracerGeometry,
  type Aim,
  type VideoInfo,
} from '@/services/tracerVideo';
import { dispatch, newId, useAppState } from '@/state/store';

/** Keep filming this long after the impact so the whole flight is on video. */
const AFTER_IMPACT_MS = 6500;
/** Restart the rolling clip if nothing happens for this long. */
const ROLL_MS = 25_000;
const METER_POLL_MS = 30;

type Phase = 'live' | 'processing' | 'aim' | 'review';

interface Clip {
  uri: string;
  info: VideoInfo;
  geometry: ClipGeometry;
  frames: ClipFrames;
  impactGuessSec: number;
  impactSec: number;
}

export default function ShotTracerScreen() {
  useKeepAwake();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const tracerStyle = useTracerStyle();
  const clubs = useAppState((s) => s.clubs);
  const shots = useAppState((s) => s.shots);
  const clubOptions = useMemo(
    () => clubs.filter((c) => c.inBag && c.category !== 'putter').map((c) => ({ value: c.id, label: c.name })),
    [clubs],
  );

  // ---- Permissions & orientation ----
  const [camPerm, requestCam] = useCameraPermissions();
  const [micGranted, setMicGranted] = useState<boolean>();
  useEffect(() => {
    requestRecordingPermissionsAsync().then((p) => setMicGranted(p.granted));
    // Portrait: a phone held upright sees far more sky, so high shots stay in the picture.
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

  // ---- State ----
  const camera = useRef<CameraView>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [phase, setPhase] = useState<Phase>('live');
  const [status, setStatus] = useState<string>();
  const [clip, setClip] = useState<Clip>();
  const [aim, setAim] = useState<Aim>();
  const [aimStill, setAimStill] = useState<{ uri: string; gray: GrayFrame }>();
  const [aimTaps, setAimTaps] = useState<{ ball?: Aim['ball']; target?: Point2 }>({});
  const [clubId, setClubId] = useState(() => clubOptions.find((o) => o.value === '7i')?.value ?? clubOptions[0]?.value);
  const [shape, setShape] = useState<TracerShape>();
  const [replayKey, setReplayKey] = useState(0);
  const [saved, setSaved] = useState<{ video?: boolean; shot?: boolean }>({});

  const club = clubs.find((c) => c.id === clubId);
  const carryFor = useCallback(
    (id: string | undefined) => {
      const c = clubs.find((x) => x.id === id);
      const stock = clubStats(shots.filter((s) => s.clubId === id)).stockCarry;
      return Math.round(stock ?? typicalCarryForLoft(c?.loft ?? 31));
    },
    [clubs, shots],
  );

  const tracer = useMemo(() => (shape ? tracerFlight(shape) : undefined), [shape]);
  const calibration = useMemo(() => (aim && clip ? calibrationFor(aim, clip.geometry) : undefined), [aim, clip]);

  // Latest values for async code.
  const aimRef = useRef(aim);
  const clipRef = useRef(clip);
  const clubRef = useRef(clubId);
  useEffect(() => {
    aimRef.current = aim;
    clipRef.current = clip;
    clubRef.current = clubId;
  }, [aim, clip, clubId]);
  useEffect(
    () => () => {
      clipRef.current?.frames.release(true);
    },
    [],
  );

  const audio = useAudioRecorder({ ...RecordingPresets.LOW_QUALITY, isMeteringEnabled: true });

  // ---- After a clip: find the start line and show the replay ----
  const runDetection = useCallback(
    async (c: Clip, a: Aim) => {
      setPhase('processing');
      setStatus('Finding the ball…');
      const loft = clubs.find((x) => x.id === clubRef.current)?.loft ?? 31;
      const base = defaultShape(carryFor(clubRef.current), loft);
      const det = await detectTracerLaunch({
        frames: c.frames,
        geometry: c.geometry,
        aim: a,
        impactGuessSec: c.impactGuessSec,
        launchDeg: base.launchDeg,
      });
      if (det.ball) setAim((prev) => (prev ? { ...prev, ball: det.ball! } : prev));
      setClip({ ...c, impactSec: det.impactSec });
      setShape({ ...base, startDeg: det.startDeg ?? 0 });
      setSaved({});
      setStatus(
        det.startDeg === undefined
          ? "Couldn't follow the ball off the club, so the start line is straight. Adjust it below to match."
          : undefined,
      );
      setReplayKey((k) => k + 1);
      // The live camera unmounts during review; it reports ready again when it comes back.
      setCameraReady(false);
      setPhase('review');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    },
    [clubs, carryFor],
  );

  const handleClip = useCallback(
    async (uri: string, heardAt: number, stopAt: number) => {
      setPhase('processing');
      setStatus('Loading the shot…');
      try {
        const info = await probeVideo(uri);
        const geometry = tracerGeometry(info, aimRef.current?.rotation ?? 0);
        const frames = new ClipFrames(uri, geometry);
        const duration = info.duration || frames.duration || 0;
        const impactGuessSec = Math.max(0, Math.min(duration, duration - (stopAt - heardAt) / 1000 - 0.06));
        const c: Clip = { uri, info, geometry, frames, impactGuessSec, impactSec: impactGuessSec };
        clipRef.current?.frames.release(true);
        setClip(c);
        if (!aimRef.current) {
          // First shot: aim on a frame from just before impact.
          const still = await frames.still(Math.max(0, Math.round((impactGuessSec - 0.6) * info.fps)));
          setAimStill(still);
          setAimTaps({});
          setStatus(undefined);
          setCameraReady(false);
          setPhase('aim');
          return;
        }
        await runDetection(c, aimRef.current);
      } catch (e) {
        deleteQuietly(uri);
        setStatus(`Couldn't read the video: ${e instanceof Error ? e.message : String(e)}`);
        setPhase('live');
      }
    },
    [runDetection],
  );

  // ---- Live: rolling recording + impact listener ----
  const manualTrigger = useRef<() => void>(() => {});
  useEffect(() => {
    if (phase !== 'live' || !cameraReady || !camPerm?.granted) return;
    const cam = camera.current;
    if (!cam) return;
    let cancelled = false;
    let heardAt: number | undefined;
    let stopAt = 0;
    let clipStart = 0;
    let stopTimer: ReturnType<typeof setTimeout> | undefined;
    let interval: ReturnType<typeof setInterval> | undefined;
    const detector = new ImpactDetector();

    const startClip = () => {
      clipStart = Date.now();
      cam
        .recordAsync({ maxDuration: 60 })
        .then((res) => onDone(res?.uri))
        .catch(() => onDone(undefined));
    };
    const onDone = (uri?: string) => {
      if (cancelled) {
        deleteQuietly(uri);
        return;
      }
      if (heardAt !== undefined && uri) {
        const h = heardAt;
        heardAt = undefined;
        handleClip(uri, h, stopAt);
        return;
      }
      deleteQuietly(uri);
      heardAt = undefined;
      startClip();
    };
    const trigger = (at: number) => {
      if (heardAt !== undefined) return;
      heardAt = at;
      setStatus('Shot! Following the ball…');
      stopTimer = setTimeout(() => {
        stopAt = Date.now();
        cam.stopRecording();
      }, AFTER_IMPACT_MS);
    };
    // Fallback if the impact isn't heard: tap right after the shot.
    manualTrigger.current = () => trigger(Date.now() - 500);

    (async () => {
      try {
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await audio.prepareToRecordAsync();
        audio.record();
      } catch {
        setStatus("Can't listen for the impact — tap “I just hit” after each shot.");
      }
      if (cancelled) return;
      setStatus(undefined);
      startClip();
      interval = setInterval(() => {
        const now = Date.now();
        const level = audio.getStatus().metering;
        if (heardAt === undefined && level !== undefined && detector.push(level, now)) trigger(now);
        if (heardAt === undefined && now - clipStart > ROLL_MS) cam.stopRecording();
      }, METER_POLL_MS);
    })();

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      if (stopTimer) clearTimeout(stopTimer);
      manualTrigger.current = () => {};
      cam.stopRecording();
      audio
        .stop()
        .then(() => deleteQuietly(audio.uri ?? undefined))
        .catch(() => {});
    };
  }, [phase, cameraReady, camPerm?.granted, audio, handleClip]);

  // ---- Aim: tap the ball, then the target ----
  const [stillBox, setStillBox] = useState({ width: 1, height: 1 });
  const aimSize = clip ? analysisSize(clip.geometry) : { width: 1, height: 1 };
  const onTapStill = (x: number, y: number) => {
    if (!aimStill) return;
    const p = { x: (x / stillBox.width) * aimSize.width, y: (y / stillBox.height) * aimSize.height };
    if (!aimTaps.ball) {
      const found = ballNear(aimStill.gray, p);
      setAimTaps({ ball: found ?? { ...p, radius: 3 } });
      setStatus(found ? undefined : "Couldn't pick out the ball exactly; using your tap.");
    } else {
      setAimTaps({ ...aimTaps, target: p });
      setStatus(undefined);
    }
  };
  const rotateAim = async () => {
    if (!clip) return;
    const geometry = { ...clip.geometry, rotation: (clip.geometry.rotation + 90) % 360 };
    clip.frames.release(false);
    const frames = new ClipFrames(clip.uri, geometry);
    const next = { ...clip, geometry, frames };
    setClip(next);
    deleteQuietly(aimStill?.uri);
    setAimStill(await frames.still(Math.max(0, Math.round((clip.impactGuessSec - 0.6) * clip.info.fps))));
    setAimTaps({});
  };
  const confirmAim = async () => {
    if (!clip || !aimTaps.ball || !aimTaps.target) return;
    const a: Aim = { ball: aimTaps.ball, target: aimTaps.target, rotation: clip.geometry.rotation };
    if (!calibrationFor(a, clip.geometry)) {
      setStatus('Tap a target further down the fairway, above the ball in the picture.');
      return;
    }
    setAim(a);
    deleteQuietly(aimStill?.uri);
    setAimStill(undefined);
    await runDetection(clip, a);
  };
  const reAim = async () => {
    if (!clip) return;
    setAim(undefined);
    setAimStill(await clip.frames.still(Math.max(0, Math.round((clip.impactSec - 0.6) * clip.info.fps))));
    setAimTaps({});
    setPhase('aim');
  };

  // ---- Review actions ----
  const nextShot = () => {
    clip?.frames.release(true);
    setClip(undefined);
    setShape(undefined);
    setStatus(undefined);
    setPhase('live');
  };
  const saveVideo = async () => {
    if (!clip) return;
    try {
      const perm = await requestMediaPermissionsAsync(true);
      if (!perm.granted) {
        setStatus('Allow access to your photos to save videos.');
        return;
      }
      await Asset.create(clip.uri);
      setSaved((s) => ({ ...s, video: true }));
    } catch (e) {
      setStatus(`Couldn't save the video: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const saveShot = () => {
    if (!tracer || !shape || !clubId) return;
    dispatch({
      type: 'shot/add',
      shot: {
        id: newId(),
        clubId,
        createdAt: new Date().toISOString(),
        source: 'course',
        carryYards: Math.round(tracer.flight.carryYards),
        totalYards: Math.round(tracer.flight.totalYards),
        offlineYards: finishOffline(tracer),
        launchAngleDeg: Math.round(shape.launchDeg * 10) / 10,
        spinRpm: shape.spinRpm,
        notes: 'Shot Tracer (distances from your adjustments)',
      },
    });
    setSaved((s) => ({ ...s, shot: true }));
  };
  const adjust = (patch: Partial<TracerShape>) => {
    setShape((s) => (s ? { ...s, ...patch } : s));
    setReplayKey((k) => k + 1);
  };
  const pickClub = (id: string) => {
    setClubId(id);
    const c = clubs.find((x) => x.id === id);
    if (shape) adjust({ ...defaultShape(carryFor(id), c?.loft ?? 31), startDeg: shape.startDeg, curveYards: shape.curveYards });
  };

  // ---- Render ----
  const permsMissing = camPerm && !camPerm.granted;
  if (permsMissing) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Shot Tracer' }} />
        <ThemedText themeColor="textSecondary">
          Shot Tracer films your shot from behind and draws the ball&apos;s flight on the video. It needs the camera
          {micGranted === false ? ', and the microphone to hear the impact (audio is never saved)' : ''}.
        </ThemedText>
        <Button
          title="Allow camera"
          onPress={async () => {
            await requestCam();
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

      {/* Main view: live camera, aiming still, or replay */}
      <View style={styles.main}>
        {camPerm?.granted && (phase === 'live' || phase === 'processing') ? (
          <CameraView
            ref={camera}
            style={StyleSheet.absoluteFill}
            mode="video"
            facing="back"
            mute
            videoQuality="1080p"
            onCameraReady={() => setCameraReady(true)}
          />
        ) : null}

        {phase === 'aim' && aimStill ? (
          <View style={styles.center}>
            <View
              style={fitBox(aimSize.width, aimSize.height)}
              onLayout={(e: LayoutChangeEvent) => setStillBox(e.nativeEvent.layout)}>
              <Image source={{ uri: aimStill.uri }} style={StyleSheet.absoluteFill} resizeMode="stretch" />
              <Pressable style={StyleSheet.absoluteFill} onPress={(e) => onTapStill(e.nativeEvent.locationX, e.nativeEvent.locationY)}>
                {aimTaps.ball ? (
                  <View
                    pointerEvents="none"
                    style={[styles.ring, { left: (aimTaps.ball.x / aimSize.width) * stillBox.width - 12, top: (aimTaps.ball.y / aimSize.height) * stillBox.height - 12 }]}
                  />
                ) : null}
                {aimTaps.target ? (
                  <View
                    pointerEvents="none"
                    style={[styles.flag, { left: (aimTaps.target.x / aimSize.width) * stillBox.width - 9, top: (aimTaps.target.y / aimSize.height) * stillBox.height - 18 }]}>
                    <ThemedText style={{ fontSize: 18 }}>⛳</ThemedText>
                  </View>
                ) : null}
              </Pressable>
            </View>
          </View>
        ) : null}

        {phase === 'review' && clip && calibration && tracer ? (
          <View style={styles.center}>
            <VideoTracer uri={clip.uri} calibration={calibration} tracer={tracer} impactSec={clip.impactSec} style={tracerStyle} replayKey={replayKey} />
          </View>
        ) : null}

        <Pressable onPress={() => router.back()} style={[styles.close, { top: insets.top + 8, left: insets.left + 12 }]} hitSlop={12}>
          <ThemedText style={styles.overlayText}>✕ Close</ThemedText>
        </Pressable>
        {phase === 'live' ? (
          <>
            {/* Framing guide: ball low in the picture, fairway running up to the horizon. */}
            <View pointerEvents="none" style={styles.horizonGuide} />
            <View style={[styles.badge, { top: insets.top + 8 }]}>
              <ThemedText type="smallBold" style={styles.overlayText}>
                {status ?? '● Recording — hit when ready'}
              </ThemedText>
            </View>
          </>
        ) : null}
        {phase === 'processing' ? (
          <View style={styles.processing}>
            <ActivityIndicator color="#fff" />
            <ThemedText style={styles.overlayText}>{status ?? 'Working…'}</ThemedText>
          </View>
        ) : null}
      </View>

      {/* Side panel */}
      <ScrollView style={styles.panel} contentContainerStyle={{ padding: 12, gap: 10, paddingRight: insets.right + 12, paddingBottom: insets.bottom + 12 }}>
        <ThemedText type="smallBold">🎥 Shot Tracer</ThemedText>

        {phase === 'live' || phase === 'processing' ? (
          <>
            <Card>
              <ThemedText type="small" themeColor="textSecondary">
                Phone upright (portrait) 2–4 m behind the ball, on the target line, at about waist height. Ball near the
                bottom, fairway running up to the horizon in the middle of the picture. Hit when ready — the app hears
                the impact, keeps filming the flight, then replays it with the tracer.
              </ThemedText>
            </Card>
            <Button title="I just hit" variant="secondary" onPress={() => manualTrigger.current()} disabled={phase !== 'live'} />
            <ThemedText type="small" themeColor="textSecondary">
              Use this if a quiet shot isn&apos;t picked up.
            </ThemedText>
          </>
        ) : null}

        {phase === 'aim' ? (
          <Card>
            <ThemedText type="smallBold">{!aimTaps.ball ? '1. Tap the ball' : !aimTaps.target ? '2. Tap your target' : 'Ready'}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {!aimTaps.ball
                ? 'Tap the ball sitting at address. This is done once — keep the phone in the same spot for the next shots.'
                : !aimTaps.target
                  ? 'Tap the flag or the middle of the fairway far away, near the horizon. That sets the target line and perspective.'
                  : 'Looks good. Start the replay.'}
            </ThemedText>
            <Row style={{ flexWrap: 'wrap' }}>
              <Button title="Rotate picture" variant="secondary" onPress={rotateAim} />
              <Button title="Start over" variant="secondary" onPress={() => setAimTaps({})} />
            </Row>
            <Button title="Show the tracer" onPress={confirmAim} disabled={!aimTaps.ball || !aimTaps.target} />
          </Card>
        ) : null}

        {phase === 'review' && shape && tracer ? (
          <>
            <Row>
              <Button title="▶ Replay" onPress={() => setReplayKey((k) => k + 1)} style={{ flex: 1 }} />
              <Button title="Next shot" variant="secondary" onPress={nextShot} style={{ flex: 1 }} />
            </Row>
            <Chips options={clubOptions} selected={clubId} onSelect={pickClub} />
            <Card>
              <ThemedText type="small" themeColor="textSecondary">
                Match the tracer to what you saw:
              </ThemedText>
              <Stepper label="Carry" value={`${Math.round(shape.carryYards)} yds`} onMinus={() => adjust({ carryYards: Math.max(20, shape.carryYards - 5) })} onPlus={() => adjust({ carryYards: shape.carryYards + 5 })} />
              <Stepper
                label="Start line"
                value={shape.startDeg === 0 ? 'Straight' : `${Math.abs(shape.startDeg).toFixed(1)}° ${shape.startDeg < 0 ? 'L' : 'R'}`}
                onMinus={() => adjust({ startDeg: shape.startDeg - 1 })}
                onPlus={() => adjust({ startDeg: shape.startDeg + 1 })}
              />
              <Stepper
                label="Curve"
                value={shape.curveYards === 0 ? 'None' : `${Math.abs(shape.curveYards)} yds ${shape.curveYards < 0 ? 'left' : 'right'}`}
                onMinus={() => adjust({ curveYards: shape.curveYards - 3 })}
                onPlus={() => adjust({ curveYards: shape.curveYards + 3 })}
              />
              <Stepper label="Height" value={`${Math.round(tracer.flight.apexYards)} yds apex`} onMinus={() => adjust({ launchDeg: Math.max(5, shape.launchDeg - 2) })} onPlus={() => adjust({ launchDeg: Math.min(45, shape.launchDeg + 2) })} />
            </Card>
            {status ? <ThemedText type="small" themeColor="warning">{status}</ThemedText> : null}
            <Row>
              <Button title={saved.video ? 'Saved ✓' : 'Save video'} variant="secondary" onPress={saveVideo} disabled={saved.video} style={{ flex: 1 }} />
              <Button title={saved.shot ? 'Saved ✓' : 'Save shot'} variant="secondary" onPress={saveShot} disabled={saved.shot} style={{ flex: 1 }} />
            </Row>
            <Row>
              <Button title={`🎨 ${tracerStyle.name}`} variant="secondary" onPress={() => router.push('/tracers')} style={{ flex: 1 }} />
              <Button title="Re-aim" variant="secondary" onPress={reAim} style={{ flex: 1 }} />
            </Row>
            <ThemedText type="small" themeColor="textSecondary">
              {club?.name ?? 'Club'}: carry starts at your stock yardage. Saved videos are the plain clip; the tracer shows
              in the app.
            </ThemedText>
          </>
        ) : null}

        {status && phase !== 'review' && phase !== 'live' ? <ThemedText type="small" themeColor="warning">{status}</ThemedText> : null}
      </ScrollView>
    </View>
  );
}

/** Largest box with the picture's aspect ratio that fits the space (portrait or landscape). */
function fitBox(w: number, h: number) {
  return h > w
    ? ({ height: '100%', aspectRatio: w / h, maxWidth: '100%' } as const)
    : ({ width: '100%', aspectRatio: w / h, maxHeight: '100%' } as const);
}

function Stepper({ label, value, onMinus, onPlus }: { label: string; value: string; onMinus: () => void; onPlus: () => void }) {
  const theme = useTheme();
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      <ThemedText type="small" style={{ width: 70 }}>
        {label}
      </ThemedText>
      <Row>
        <Pressable onPress={onMinus} accessibilityLabel={`Less ${label}`} style={[styles.step, { backgroundColor: theme.backgroundSelected }]}>
          <ThemedText type="smallBold">−</ThemedText>
        </Pressable>
        <ThemedText type="smallBold" style={{ minWidth: 92, textAlign: 'center' }}>
          {value}
        </ThemedText>
        <Pressable onPress={onPlus} accessibilityLabel={`More ${label}`} style={[styles.step, { backgroundColor: theme.backgroundSelected }]}>
          <ThemedText type="smallBold">+</ThemedText>
        </Pressable>
      </Row>
    </Row>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  main: { flex: 3, backgroundColor: '#000', overflow: 'hidden' },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  panel: { flex: 2 },
  close: { position: 'absolute' },
  badge: { position: 'absolute', right: 12, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, maxWidth: '70%' },
  overlayText: { color: '#fff', textShadowColor: '#000', textShadowRadius: 4 },
  processing: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.45)' },
  horizonGuide: { position: 'absolute', left: 0, right: 0, top: '45%', height: 1, backgroundColor: 'rgba(255,255,255,0.35)' },
  ring: { position: 'absolute', width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#FFD54F' },
  flag: { position: 'absolute' },
  step: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
});
