import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, Polygon, Polyline, type MapPressEvent } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button, Row } from '@/components/ui';
import { clubStats, suggestClub, type ClubStats } from '@/domain/clubs';
import { bearing, distanceMeters, distanceYards, greenDistances } from '@/domain/geo';
import type { LatLng } from '@/domain/types';
import { useLiveLocation } from '@/hooks/use-location';
import { useTheme } from '@/hooks/use-theme';
import { useAppState } from '@/state/store';

/** Ignore GPS for distances when the player is clearly not on this hole (e.g. at home). */
const ON_COURSE_MAX_YARDS = 800;

export default function HoleScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { id, hole: holeParam } = useLocalSearchParams<{ id: string; hole: string }>();
  const course = useAppState((s) => s.courses.find((c) => c.id === id));
  const clubs = useAppState((s) => s.clubs);
  const shots = useAppState((s) => s.shots);
  const { position, status } = useLiveLocation();
  const [target, setTarget] = useState<LatLng>();

  const holeIndex = course?.holes.findIndex((h) => String(h.number) === holeParam) ?? -1;
  const hole = course?.holes[holeIndex];

  const stats = useMemo(() => {
    const byClub: Record<string, ClubStats> = {};
    for (const c of clubs) byClub[c.id] = clubStats(shots.filter((s) => s.clubId === c.id));
    return byClub;
  }, [clubs, shots]);

  const camera = useMemo(() => {
    if (!hole?.greenCenter) return undefined;
    const tee = hole.tees[0] ?? hole.path?.[0] ?? hole.greenCenter;
    const lengthM = Math.max(80, distanceMeters(tee, hole.greenCenter));
    return {
      center: {
        latitude: (tee.latitude + hole.greenCenter.latitude) / 2,
        longitude: (tee.longitude + hole.greenCenter.longitude) / 2,
      },
      // Rotate so the hole plays "up" the screen, like a yardage book.
      heading: bearing(tee, hole.greenCenter),
      pitch: 0,
      zoom: Math.max(15, Math.min(19, 17.6 - Math.log2(lengthM / 160))),
      altitude: lengthM * 2.4,
    };
  }, [hole]);

  if (!course || !hole || !camera) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ThemedText>Hole not found</ThemedText>
      </View>
    );
  }

  // Use GPS if it's plausibly on this hole; otherwise measure from the tee.
  const tee = hole.tees[0] ?? hole.path?.[0] ?? hole.greenCenter!;
  const gpsUsable = position && distanceYards(position, hole.greenCenter!) < ON_COURSE_MAX_YARDS;
  const from = gpsUsable ? position : tee;
  const green = greenDistances(from, hole.greenCenter!, hole.green);
  const club = suggestClub(green.center, clubs, stats);
  const toTarget = target ? distanceYards(from, target) : undefined;
  const targetToGreen = target ? distanceYards(target, hole.greenCenter!) : undefined;

  const goTo = (offset: number) => {
    const next = course.holes[holeIndex + offset];
    if (next) router.replace(`/course/${course.id}/hole/${next.number}`);
  };

  const onPress = (e: MapPressEvent) => setTarget(e.nativeEvent.coordinate);

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{ title: `Hole ${hole.number}${hole.par ? ` · Par ${hole.par}` : ''}${hole.yards ? ` · ${hole.yards} yds` : ''}` }}
      />
      <MapView
        key={hole.number}
        style={StyleSheet.absoluteFill}
        mapType="satellite"
        initialCamera={camera}
        showsUserLocation
        showsCompass={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        onPress={onPress}>
        {hole.path ? (
          <Polyline coordinates={hole.path} strokeColor="rgba(255,255,255,0.8)" strokeWidth={2} lineDashPattern={[6, 6]} />
        ) : null}
        {hole.green ? <Polygon coordinates={hole.green} fillColor="rgba(76,194,122,0.35)" strokeColor="#4CC27A" strokeWidth={2} /> : null}
        {hole.hazards.map((h, i) => (
          <Polygon
            key={i}
            coordinates={h.outline}
            fillColor={h.kind === 'water' ? 'rgba(33,150,243,0.35)' : 'rgba(255,224,130,0.4)'}
            strokeColor={h.kind === 'water' ? '#2196F3' : '#FFE082'}
            strokeWidth={1}
          />
        ))}
        {hole.tees.map((t, i) => (
          <Marker key={`tee-${i}`} coordinate={t} title="Tee" pinColor="blue" />
        ))}
        <Marker coordinate={hole.greenCenter!} title="Green" pinColor="green" />
        {target ? (
          <>
            <Polyline coordinates={[from, target, hole.greenCenter!]} strokeColor="#FFD54F" strokeWidth={2} />
            <Marker coordinate={target} title={`${Math.round(toTarget!)} yds`} pinColor="gold" />
          </>
        ) : null}
      </MapView>

      {/* Yardage panel */}
      <View style={[styles.panel, { backgroundColor: theme.background, paddingBottom: insets.bottom + 12 }]}>
        <Row style={{ justifyContent: 'space-around' }}>
          <Yardage label="Front" value={green.front} />
          <Yardage label="Center" value={green.center} big />
          <Yardage label="Back" value={green.back} />
        </Row>
        <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
          {gpsUsable
            ? `From your position${position?.accuracy ? ` (±${Math.round(position.accuracy * 1.094)} yds GPS)` : ''}`
            : status === 'denied'
              ? 'Location off — showing distances from the tee'
              : 'Not on this hole — showing distances from the tee'}
          {club ? ` · Club: ${club.name}` : ''}
        </ThemedText>
        {target ? (
          <ThemedText type="small" style={{ textAlign: 'center' }}>
            Target: {Math.round(toTarget!)} yds out, then {Math.round(targetToGreen!)} yds to the green
          </ThemedText>
        ) : (
          <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
            Tap the map to measure to any point (layup, bunker, dogleg)
          </ThemedText>
        )}
        <Row>
          <Button title="‹ Prev" variant="secondary" onPress={() => goTo(-1)} disabled={holeIndex <= 0} style={{ flex: 1 }} />
          {target ? <Button title="Clear" variant="secondary" onPress={() => setTarget(undefined)} style={{ flex: 1 }} /> : null}
          <Button
            title="Next ›"
            variant="secondary"
            onPress={() => goTo(1)}
            disabled={holeIndex >= course.holes.length - 1}
            style={{ flex: 1 }}
          />
        </Row>
        <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center', fontSize: 11 }}>
          © OpenStreetMap contributors
        </ThemedText>
      </View>
    </View>
  );
}

function Yardage({ label, value, big }: { label: string; value: number; big?: boolean }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText style={{ fontSize: big ? 40 : 24, lineHeight: big ? 46 : 30, fontWeight: 800 }}>
        {Math.round(value)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 12,
    paddingHorizontal: 16,
    gap: 8,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
});
