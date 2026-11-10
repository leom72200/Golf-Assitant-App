/**
 * Shot tracers: an animated line that follows the ball, drawn in the player's chosen style.
 *
 *  - <ShotTracer>: TV-style view from behind the golfer, the flight drawn as it happens.
 *  - <CameraTracer>: the ball's measured path over a real frame from the practice-mode camera.
 */
import { useEffect, useId, useMemo, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Polygon, Polyline, Rect, Stop, Text as SvgText } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import type { FlightResult } from '@/domain/launch';
import type { TracerStyle } from '@/domain/tracerStyles';
import {
  downTheLineView,
  extendToEdge,
  flightPath3d,
  partialPolyline,
  toSvgPoints,
  type Point2,
} from '@/domain/tracerProjection';

/** 0 → 1 over `durationMs`, restarting whenever `runKey` changes (always 1 when disabled). */
function useProgress(durationMs: number, runKey: unknown, enabled: boolean): number {
  const [state, setState] = useState<{ key: unknown; p: number }>({ key: undefined, p: 0 });
  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    const start = Date.now();
    const step = () => {
      const t = Math.min(1, (Date.now() - start) / durationMs);
      setState({ key: runKey, p: t });
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [durationMs, runKey, enabled]);
  if (!enabled) return 1;
  // A new run starts from 0 until its first frame arrives.
  return state.key === runKey ? state.p : 0;
}

/** The styled line itself: glow, main stroke (solid / gradient / comet / dashed), core. */
function TracerLine({ points, style, head }: { points: Point2[]; style: TracerStyle; head?: boolean }) {
  // Unique gradient ids per instance, since several tracers can be on screen at once.
  const id = `tr${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  if (points.length < 2) return null;
  const start = points[0];
  const end = points[points.length - 1];
  const pts = toSvgPoints(points);
  const multi = style.colors.length > 1;
  const stroke = style.comet ? `url(#${id}c)` : multi ? `url(#${id}g)` : style.colors[0];
  return (
    <G>
      <Defs>
        <LinearGradient id={`${id}g`} x1={start.x} y1={start.y} x2={end.x} y2={end.y} gradientUnits="userSpaceOnUse">
          {style.colors.map((c, i) => (
            <Stop key={i} offset={style.colors.length === 1 ? 0 : i / (style.colors.length - 1)} stopColor={c} />
          ))}
        </LinearGradient>
        <LinearGradient id={`${id}c`} x1={start.x} y1={start.y} x2={end.x} y2={end.y} gradientUnits="userSpaceOnUse">
          <Stop offset={0} stopColor={style.colors[0]} stopOpacity={0.05} />
          <Stop offset={0.7} stopColor={style.colors[Math.floor(style.colors.length / 2)]} stopOpacity={0.55} />
          <Stop offset={1} stopColor={style.colors[style.colors.length - 1]} stopOpacity={1} />
        </LinearGradient>
      </Defs>
      {style.glow ? (
        <Polyline points={pts} fill="none" stroke={style.glow} strokeWidth={style.width * 4} strokeLinecap="round" strokeLinejoin="round" />
      ) : null}
      <Polyline
        points={pts}
        fill="none"
        stroke={stroke}
        strokeWidth={style.width}
        strokeDasharray={style.dash}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {style.core ? (
        <Polyline points={pts} fill="none" stroke={style.core} strokeWidth={Math.max(1, style.width * 0.35)} strokeLinecap="round" strokeLinejoin="round" />
      ) : null}
      {head ? <Circle cx={end.x} cy={end.y} r={style.width * 0.9 + 1} fill="#FFFFFF" /> : null}
    </G>
  );
}

function LandingMarker({ at, style, size = 8 }: { at: Point2; style: TracerStyle; size?: number }) {
  const color = style.colors[style.colors.length - 1];
  switch (style.landing) {
    case 'ring':
      return <Circle cx={at.x} cy={at.y} r={size} fill="none" stroke={color} strokeWidth={2} />;
    case 'star': {
      const pts = Array.from({ length: 10 }, (_, i) => {
        const r = i % 2 === 0 ? size : size * 0.45;
        const a = (Math.PI / 5) * i - Math.PI / 2;
        return `${at.x + r * Math.cos(a)},${at.y + r * Math.sin(a) * 0.6}`;
      }).join(' ');
      return <Polygon points={pts} fill={color} />;
    }
    case 'burst':
      return (
        <G>
          {Array.from({ length: 8 }, (_, i) => {
            const a = (Math.PI / 4) * i;
            return (
              <Line
                key={i}
                x1={at.x + Math.cos(a) * size * 0.4}
                y1={at.y + Math.sin(a) * size * 0.25}
                x2={at.x + Math.cos(a) * size * 1.3}
                y2={at.y + Math.sin(a) * size * 0.8}
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
              />
            );
          })}
          <Circle cx={at.x} cy={at.y} r={size * 0.35} fill="#FFFFFF" />
        </G>
      );
    default:
      return <Circle cx={at.x} cy={at.y} r={size * 0.6} fill={color} />;
  }
}

export interface ShotTracerProps {
  flight: FlightResult;
  style: TracerStyle;
  /** Yards left (-) / right (+) where the ball finished, if known. */
  offlineYards?: number;
  height?: number;
  /** Animate the flight (false = draw it complete, e.g. for previews). */
  animate?: boolean;
  /** Change to replay the animation. */
  replayKey?: unknown;
  showLabels?: boolean;
}

export function ShotTracer({ flight, style, offlineYards = 0, height = 200, animate = true, replayKey, showLabels = true }: ShotTracerProps) {
  const [width, setWidth] = useState(0);
  const path = useMemo(() => flightPath3d(flight, offlineYards), [flight, offlineYards]);
  const view = useMemo(
    () => (width > 0 ? downTheLineView([...path.air, ...path.roll], width, height) : undefined),
    [path, width, height],
  );
  // Real hang time, sped up a little so it doesn't drag; the roll gets the last 15%.
  const duration = Math.max(1200, Math.min(3500, flight.flightTimeSec * 600));
  const p = useProgress(duration, `${replayKey}-${flight.carryYards}-${width}`, animate && width > 0);

  const scene = useMemo(() => {
    if (!view) return undefined;
    const far = Math.max(150, Math.ceil((flight.totalYards + 30) / 50) * 50);
    const fairway = [
      view.project({ d: 0, h: 0, l: -18 }),
      view.project({ d: 0, h: 0, l: 18 }),
      view.project({ d: far, h: 0, l: 14 }),
      view.project({ d: far, h: 0, l: -14 }),
    ];
    const markers = [];
    let lastY = Infinity;
    for (let d = 50; d <= far; d += 50) {
      const a = view.project({ d, h: 0, l: -16 });
      const b = view.project({ d, h: 0, l: 16 });
      // Skip markers that would bunch up near the horizon.
      if (lastY - a.y < 12) continue;
      lastY = a.y;
      markers.push({ d, a, b });
    }
    const air = path.air.map(view.project);
    const roll = [air[air.length - 1], ...path.roll.map(view.project)];
    return { fairway, markers, air, roll };
  }, [view, path, flight.totalYards]);

  const airDone = p >= 0.85;
  const drawnAir = scene ? partialPolyline(scene.air, Math.min(1, p / 0.85)) : [];
  const drawnRoll = scene && airDone ? partialPolyline(scene.roll, (p - 0.85) / 0.15) : [];

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={[styles.box, { height }]}>
      {view && scene ? (
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#6FA8DC" />
              <Stop offset="1" stopColor="#D6EAF8" />
            </LinearGradient>
            <LinearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#3D6B3A" />
              <Stop offset="1" stopColor="#24461F" />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={width} height={view.horizonY} fill="url(#sky)" />
          <Rect x={0} y={view.horizonY} width={width} height={height - view.horizonY} fill="url(#ground)" />
          <Polygon points={toSvgPoints(scene.fairway)} fill="#4E9A43" />
          {scene.markers.map((m) => (
            <G key={m.d}>
              <Line x1={m.a.x} y1={m.a.y} x2={m.b.x} y2={m.b.y} stroke="rgba(255,255,255,0.35)" strokeWidth={1} />
              <SvgText x={m.b.x + 4} y={m.b.y + 3} fontSize={9} fill="rgba(255,255,255,0.8)">
                {m.d}
              </SvgText>
            </G>
          ))}
          <TracerLine points={drawnAir} style={style} head={!airDone} />
          {drawnRoll.length > 1 ? (
            <Polyline points={toSvgPoints(drawnRoll)} fill="none" stroke={style.colors[style.colors.length - 1]} strokeWidth={2} strokeOpacity={0.7} strokeDasharray={[3, 3]} />
          ) : null}
          {airDone ? <LandingMarker at={scene.air[scene.air.length - 1]} style={style} /> : null}
        </Svg>
      ) : null}
      {showLabels && airDone ? (
        <View style={styles.labels} pointerEvents="none">
          <ThemedText type="smallBold" style={styles.labelText}>
            Carry {Math.round(flight.carryYards)} · Total {Math.round(flight.totalYards)} · Apex {Math.round(flight.apexYards)} yds
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

export interface CameraTracerProps {
  imageUri: string;
  /** Image size in the same pixels as the points. */
  imageWidth: number;
  imageHeight: number;
  /** Ball at address and its measured positions (oldest first). */
  address: Point2;
  points: Point2[];
  /** Velocity in pixels/second, to extend the line to the frame edge. */
  vx: number;
  vy: number;
  style: TracerStyle;
  replayKey?: unknown;
}

/** The measured ball path drawn over a real frame, extended until it leaves the picture. */
export function CameraTracer({ imageUri, imageWidth, imageHeight, address, points, vx, vy, style, replayKey }: CameraTracerProps) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  const p = useProgress(700, replayKey, box.width > 0);
  const k = box.width / imageWidth;
  const last = points[points.length - 1] ?? address;
  const exit = extendToEdge(last, vx, vy, imageWidth, imageHeight);
  const full = [address, ...points, exit].map((q) => ({ x: q.x * k, y: q.y * k }));
  const drawn = partialPolyline(full, p);
  return (
    <View
      style={{ width: '100%', aspectRatio: imageWidth / imageHeight, borderRadius: 12, overflow: 'hidden' }}
      onLayout={(e) => setBox(e.nativeEvent.layout)}>
      <Image source={{ uri: imageUri }} style={StyleSheet.absoluteFill} resizeMode="stretch" />
      {box.width > 0 ? (
        <Svg width={box.width} height={box.height} style={StyleSheet.absoluteFill}>
          <TracerLine points={drawn} style={style} head={p < 1} />
          {points.map((q, i) => (
            <Circle key={i} cx={q.x * k} cy={q.y * k} r={2} fill="#FFFFFF" fillOpacity={p >= 1 ? 0.8 : 0} />
          ))}
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: '100%', borderRadius: 12, overflow: 'hidden', backgroundColor: '#24461F' },
  labels: { position: 'absolute', left: 10, top: 8 },
  labelText: { color: '#fff', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3 },
});
