import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button, Screen } from '@/components/ui';

const MAX_SECONDS = 8;

/**
 * Records a short swing clip. Note: expo-camera records at the device's normal frame rate
 * (usually 30–60 fps). That's great for reviewing your swing, but too slow to measure ball
 * speed; for that, film in the phone's built-in slow-motion mode and use "Analyze clip".
 */
export default function RecordScreen() {
  const insets = useSafeAreaInsets();
  const camera = useRef<CameraView>(null);
  const [cam, requestCam] = useCameraPermissions();
  const [mic, requestMic] = useMicrophonePermissions();
  const [recording, setRecording] = useState(false);
  const [ready, setReady] = useState(false);

  if (!cam || !mic) return <View style={{ flex: 1, backgroundColor: '#000' }} />;

  if (!cam.granted || !mic.granted) {
    return (
      <Screen headerless title="Camera access">
        <ThemedText themeColor="textSecondary">
          Shot Lab needs the camera to film your swing, and the microphone to record the sound of impact (which will
          help pinpoint the moment of contact).
        </ThemedText>
        <Button
          title="Allow access"
          onPress={async () => {
            if (!cam.granted) await requestCam();
            if (!mic.granted) await requestMic();
          }}
        />
        <Button title="Not now" variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  const toggle = async () => {
    if (!camera.current || !ready) return;
    if (recording) {
      camera.current.stopRecording();
      return;
    }
    setRecording(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      const result = await camera.current.recordAsync({ maxDuration: MAX_SECONDS });
      if (result?.uri) router.replace({ pathname: '/lab/analyze', params: { uri: result.uri } });
    } finally {
      setRecording(false);
    }
  };

  return (
    <View style={styles.container}>
      <CameraView
        ref={camera}
        style={StyleSheet.absoluteFill}
        mode="video"
        facing="back"
        videoQuality="1080p"
        onCameraReady={() => setReady(true)}
      />
      {/* Framing guide: ball in the left third, flying left to right. */}
      <View pointerEvents="none" style={[styles.guide, { top: '55%' }]} />
      <View pointerEvents="none" style={styles.ballGuide} />

      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ThemedText style={styles.overlayText}>Close</ThemedText>
        </Pressable>
        <ThemedText type="small" style={styles.overlayText}>
          Side-on · ball in the circle · max {MAX_SECONDS}s
        </ThemedText>
      </View>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 24 }]}>
        <Pressable
          onPress={toggle}
          accessibilityRole="button"
          accessibilityLabel={recording ? 'Stop recording' : 'Start recording'}
          style={[styles.shutter, recording && styles.shutterRecording]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  topBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  overlayText: { color: '#fff', textShadowColor: '#000', textShadowRadius: 4 },
  guide: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.5)' },
  ballGuide: {
    position: 'absolute',
    left: '22%',
    top: '55%',
    width: 36,
    height: 36,
    marginTop: -36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.8)',
  },
  bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  shutter: { width: 74, height: 74, borderRadius: 37, backgroundColor: '#E53935', borderWidth: 5, borderColor: '#fff' },
  shutterRecording: { borderRadius: 12, width: 56, height: 56 },
});
