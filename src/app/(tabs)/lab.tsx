import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ShotTracer } from '@/components/shot-tracer';
import { useTracerStyle } from '@/hooks/use-tracer';
import { Button, Card, Chips, NumberField, num, Row, Screen, SectionTitle, Stat, StatGrid } from '@/components/ui';
import { airDensity, simulateFlight, typicalSpinForLoft } from '@/domain/launch';
import { useAppState } from '@/state/store';

export default function ShotLabScreen() {
  const clubs = useAppState((s) => s.clubs);
  const options = useMemo(
    () => clubs.filter((c) => c.inBag && c.category !== 'putter').map((c) => ({ value: c.id, label: c.name })),
    [clubs],
  );
  const [clubId, setClubId] = useState<string | undefined>('7i');
  const club = clubs.find((c) => c.id === clubId);

  const [ballSpeed, setBallSpeed] = useState('120');
  const [launch, setLaunch] = useState('17');
  const [spin, setSpin] = useState('');
  const [temp, setTemp] = useState('70');
  const [altitude, setAltitude] = useState('0');
  const tracerStyle = useTracerStyle();

  const spinRpm = num(spin) ?? typicalSpinForLoft(club?.loft ?? 31);
  const flight = useMemo(() => {
    const v = num(ballSpeed);
    const l = num(launch);
    if (v === undefined || l === undefined || v <= 0 || v > 250) return undefined;
    return simulateFlight({
      ballSpeedMph: v,
      launchAngleDeg: l,
      spinRpm,
      airDensity: airDensity(num(temp) ?? 70, num(altitude) ?? 0),
    });
  }, [ballSpeed, launch, spinRpm, temp, altitude]);

  const pickClip = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsEditing: false,
      // Keep the original file so slow-motion frames aren't re-encoded away.
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
    });
    if (res.canceled || !res.assets[0]) return;
    router.push({ pathname: '/lab/analyze', params: { uri: res.assets[0].uri, clubId: clubId ?? '' } });
  };

  return (
    <Screen tab headerless title="Shot Lab" subtitle="Use your phone's camera as a simple launch monitor.">
      <Card>
        <ThemedText type="smallBold">⚡ Live practice mode</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Keep the camera open and just hit balls. The phone films at 240 fps, hears each impact, and measures ball
          speed, launch angle and carry automatically — nothing is saved unless you want it. Android phones with a
          high-speed camera mode (e.g. Galaxy S21 and newer); needs the app build, not Expo Go.
        </ThemedText>
        <Button title="Start practice mode" onPress={() => router.push('/lab/practice')} />
      </Card>

      <Card>
        <ThemedText type="smallBold">Analyze a clip by hand</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          1. Set your phone on the ground or a tripod about 2 m (7 ft) away, side-on to the ball so it flies across the
          screen.{'\n'}2. Film the swing in <ThemedText type="smallBold">slow motion</ThemedText> (240 fps if your phone
          offers it). Normal 30 fps video is too slow to catch the ball after impact.{'\n'}3. In the analyzer, tap the
          ball&apos;s edges to calibrate, then mark the ball in two frames just after impact. The app works out ball
          speed and launch angle, then estimates carry.
        </ThemedText>
        <Row>
          <Button title="Record swing" onPress={() => router.push('/lab/record')} style={{ flex: 1 }} />
          <Button title="Analyze slow-mo clip" variant="secondary" onPress={() => pickClip().catch((e) => Alert.alert('Could not open clip', String(e)))} style={{ flex: 1 }} />
        </Row>
      </Card>

      <SectionTitle>Ball flight calculator</SectionTitle>
      <ThemedText type="small" themeColor="textSecondary">
        Got numbers from a range launch monitor or the analyzer? See how far that shot carries.
      </ThemedText>
      <Chips options={options} selected={clubId} onSelect={setClubId} />
      <Row style={{ flexWrap: 'wrap' }}>
        <NumberField label="Ball speed" value={ballSpeed} onChange={setBallSpeed} unit="mph" />
        <NumberField label="Launch angle" value={launch} onChange={setLaunch} unit="°" />
        <NumberField label="Spin" value={spin} onChange={setSpin} unit="rpm" placeholder={`~${spinRpm}`} />
        <NumberField label="Temperature" value={temp} onChange={setTemp} unit="°F" allowNegative />
        <NumberField label="Altitude" value={altitude} onChange={setAltitude} unit="ft" />
      </Row>

      {flight ? (
        <Card>
          <ShotTracer flight={flight} style={tracerStyle} height={190} />
          <Button title={`🎨 Tracer: ${tracerStyle.name}`} variant="secondary" onPress={() => router.push('/tracers')} />
          <StatGrid>
            <Stat label="Carry" value={flight.carryYards.toFixed(0)} unit="yds" />
            <Stat label="Total" value={flight.totalYards.toFixed(0)} unit="yds" />
            <Stat label="Apex" value={flight.apexYards.toFixed(0)} unit="yds" />
            <Stat label="Land angle" value={flight.descentAngleDeg.toFixed(0)} unit="°" />
            <Stat label="Hang time" value={flight.flightTimeSec.toFixed(1)} unit="s" />
            <Stat label="Spin used" value={spinRpm} unit="rpm" />
          </StatGrid>
          <ThemedText type="small" themeColor="textSecondary">
            Estimate from a physics model (drag + lift from backspin), no wind. Typically within ~7% of real carries.
          </ThemedText>
          <Button
            title="Save as a shot"
            variant="secondary"
            onPress={() =>
              router.push({
                pathname: '/shot/new',
                params: {
                  clubId: clubId ?? '',
                  ballSpeed,
                  launch,
                  spin: String(spinRpm),
                  carry: flight.carryYards.toFixed(0),
                  total: flight.totalYards.toFixed(0),
                },
              })
            }
          />
        </Card>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          Enter a ball speed and launch angle.
        </ThemedText>
      )}
    </Screen>
  );
}
