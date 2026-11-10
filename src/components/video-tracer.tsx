/**
 * Plays a recorded shot with the tracer drawn on top, in time with the ball: the line starts at
 * impact and follows the projected flight; if the video ends before the ball lands, the tracer
 * carries on over the last frame.
 */
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';

import { LandingMarker, TracerLine } from '@/components/shot-tracer';
import { ThemedText } from '@/components/themed-text';
import { airIndexAt, projectBehind, type BehindCalibration, type TracerFlight } from '@/domain/behindCamera';
import { partialPolyline, toSvgPoints } from '@/domain/tracerProjection';
import type { TracerStyle } from '@/domain/tracerStyles';

export interface VideoTracerProps {
  uri: string;
  calibration: BehindCalibration;
  tracer: TracerFlight;
  /** Seconds into the video when the ball was struck. */
  impactSec: number;
  style: TracerStyle;
  /** Change to replay from just before impact. */
  replayKey: number;
}

const LEAD_IN_SEC = 1.5;
const ROLL_SEC = 0.8;

export function VideoTracer({ uri, calibration, tracer, impactSec, style, replayKey }: VideoTracerProps) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.muted = true;
  });
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [t, setT] = useState(-1);

  // (Re)start from shortly before impact.
  useEffect(() => {
    player.replay();
    player.seekBy(Math.max(0, impactSec - LEAD_IN_SEC));
  }, [player, impactSec, replayKey]);

  // Follow the video clock; once the video has ended, keep the flight going on the wall clock.
  useEffect(() => {
    let raf = 0;
    let endedAt: number | undefined;
    let last = -99;
    const step = () => {
      const dur = player.duration;
      const cur = player.currentTime;
      let tt: number;
      if (dur > 0 && cur >= dur - 0.06 && !player.playing) {
        endedAt ??= Date.now();
        tt = dur - impactSec + (Date.now() - endedAt) / 1000;
      } else {
        endedAt = undefined;
        tt = cur - impactSec;
      }
      if (Math.abs(tt - last) > 0.015) {
        last = tt;
        setT(tt);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [player, impactSec, replayKey]);

  const k = box.width / calibration.imageW;
  const air = useMemo(
    () => tracer.air.map((p) => projectBehind(calibration, p)).map((q) => ({ x: q.x * k, y: q.y * k })),
    [tracer, calibration, k],
  );
  const roll = useMemo(
    () => [air[air.length - 1], ...tracer.roll.map((p) => projectBehind(calibration, p)).map((q) => ({ x: q.x * k, y: q.y * k }))],
    [air, tracer, calibration, k],
  );

  const flightTime = tracer.flight.flightTimeSec;
  const landed = t >= flightTime;
  const drawnAir = t > 0 ? partialPolyline(air, airIndexAt(tracer, t) / Math.max(1, air.length - 1)) : [];
  const drawnRoll = landed ? partialPolyline(roll, (t - flightTime) / ROLL_SEC) : [];

  return (
    <View
      style={[
        styles.box,
        calibration.imageH > calibration.imageW
          ? { height: '100%', maxWidth: '100%' }
          : { width: '100%', maxHeight: '100%' },
        { aspectRatio: calibration.imageW / calibration.imageH },
      ]}
      onLayout={(e) => setBox(e.nativeEvent.layout)}>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
      {box.width > 0 ? (
        <Svg width={box.width} height={box.height} style={StyleSheet.absoluteFill} pointerEvents="none">
          {t <= 0 ? <Circle cx={calibration.ball.x * k} cy={calibration.ball.y * k} r={6} fill="none" stroke="#FFD54F" strokeWidth={1.5} /> : null}
          <TracerLine points={drawnAir} style={style} head={t > 0 && !landed} />
          {drawnRoll.length > 1 ? (
            <Polyline points={toSvgPoints(drawnRoll)} fill="none" stroke={style.colors[style.colors.length - 1]} strokeWidth={2} strokeOpacity={0.8} strokeDasharray={[4, 4]} />
          ) : null}
          {landed ? <LandingMarker at={air[air.length - 1]} style={style} size={7} /> : null}
        </Svg>
      ) : null}
      {landed ? (
        <View style={styles.label} pointerEvents="none">
          <ThemedText type="smallBold" style={styles.labelText}>
            Carry {Math.round(tracer.flight.carryYards)} · Total {Math.round(tracer.flight.totalYards)} yds
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: '#000', borderRadius: 12, overflow: 'hidden' },
  label: { position: 'absolute', left: 10, top: 8 },
  labelText: { color: '#fff', textShadowColor: 'rgba(0,0,0,0.7)', textShadowRadius: 3 },
});
