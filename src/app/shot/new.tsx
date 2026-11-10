import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Chips, NumberField, num, Row, Screen, SectionTitle, TextField, ToggleRow } from '@/components/ui';
import { simulateFlight, typicalSpinForLoft } from '@/domain/launch';
import type { ShotSource } from '@/domain/types';
import { dispatch, newId, useAppState } from '@/state/store';

/**
 * Log a shot. Opened empty from the bag, or pre-filled by the Shot Lab with measured
 * ball speed / launch angle (params are strings, as with every route param).
 */
export default function NewShotScreen() {
  const params = useLocalSearchParams<{
    clubId?: string;
    ballSpeed?: string;
    launch?: string;
    spin?: string;
    carry?: string;
    total?: string;
    source?: ShotSource;
  }>();
  const clubs = useAppState((s) => s.clubs);
  const options = useMemo(
    () => clubs.filter((c) => c.inBag && c.category !== 'putter').map((c) => ({ value: c.id, label: c.name })),
    [clubs],
  );

  const [clubId, setClubId] = useState(params.clubId ?? options[0]?.value);
  const [carry, setCarry] = useState(params.carry ?? '');
  const [total, setTotal] = useState(params.total ?? '');
  const [ballSpeed, setBallSpeed] = useState(params.ballSpeed ?? '');
  const [clubSpeed, setClubSpeed] = useState('');
  const [launch, setLaunch] = useState(params.launch ?? '');
  const [spin, setSpin] = useState(params.spin ?? '');
  const [offline, setOffline] = useState('');
  const [mishit, setMishit] = useState(false);
  const [notes, setNotes] = useState('');

  const club = clubs.find((c) => c.id === clubId);
  const canEstimate = num(ballSpeed) !== undefined && num(launch) !== undefined;
  const hasData = [carry, total, ballSpeed, clubSpeed].some((v) => num(v) !== undefined);

  const estimate = () => {
    const spinRpm = num(spin) ?? typicalSpinForLoft(club?.loft ?? 31);
    const r = simulateFlight({ ballSpeedMph: num(ballSpeed)!, launchAngleDeg: num(launch)!, spinRpm });
    setCarry(r.carryYards.toFixed(0));
    setTotal(r.totalYards.toFixed(0));
    if (num(spin) === undefined) setSpin(String(spinRpm));
  };

  const save = () => {
    if (!clubId) return;
    dispatch({
      type: 'shot/add',
      shot: {
        id: newId(),
        clubId,
        createdAt: new Date().toISOString(),
        source: params.source ?? 'manual',
        carryYards: num(carry),
        totalYards: num(total),
        ballSpeedMph: num(ballSpeed),
        clubSpeedMph: num(clubSpeed),
        launchAngleDeg: num(launch),
        spinRpm: num(spin),
        offlineYards: num(offline),
        mishit,
        notes: notes.trim() || undefined,
      },
    });
    router.back();
  };

  return (
    <Screen>
      <SectionTitle>Club</SectionTitle>
      <Chips options={options} selected={clubId} onSelect={setClubId} />

      <SectionTitle>Distance</SectionTitle>
      <Row style={{ flexWrap: 'wrap' }}>
        <NumberField label="Carry" value={carry} onChange={setCarry} unit="yds" />
        <NumberField label="Total" value={total} onChange={setTotal} unit="yds" />
        <NumberField label="Offline (− left, + right)" value={offline} onChange={setOffline} unit="yds" allowNegative />
      </Row>

      <SectionTitle>Launch data (optional)</SectionTitle>
      <Row style={{ flexWrap: 'wrap' }}>
        <NumberField label="Ball speed" value={ballSpeed} onChange={setBallSpeed} unit="mph" />
        <NumberField label="Club speed" value={clubSpeed} onChange={setClubSpeed} unit="mph" />
        <NumberField label="Launch angle" value={launch} onChange={setLaunch} unit="°" />
        <NumberField label="Spin" value={spin} onChange={setSpin} unit="rpm" />
      </Row>
      {canEstimate ? (
        <Card>
          <ThemedText type="small" themeColor="textSecondary">
            No carry number? Estimate it from ball speed and launch with the built-in ball-flight model
            {num(spin) === undefined ? ` (assuming ~${typicalSpinForLoft(club?.loft ?? 31)} rpm for a ${club?.name ?? 'club'})` : ''}.
          </ThemedText>
          <Button title="Estimate carry & total" variant="secondary" onPress={estimate} />
        </Card>
      ) : null}

      <ToggleRow label="Mishit" hint="Excluded from your stock yardages" value={mishit} onChange={setMishit} />
      <TextField label="Notes" value={notes} onChange={setNotes} placeholder="e.g. into the wind, from the rough" multiline />

      <Button title="Save shot" onPress={save} disabled={!clubId || !hasData} />
    </Screen>
  );
}
