import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Row, Screen, SectionTitle } from '@/components/ui';
import { clubStats, type ClubStats } from '@/domain/clubs';
import { useTheme } from '@/hooks/use-theme';
import { dispatch, useAppState } from '@/state/store';

export default function BagScreen() {
  const theme = useTheme();
  const clubs = useAppState((s) => s.clubs);
  const shots = useAppState((s) => s.shots);
  const [editing, setEditing] = useState(false);

  const stats = useMemo(() => {
    const byClub: Record<string, ClubStats> = {};
    for (const c of clubs) byClub[c.id] = clubStats(shots.filter((s) => s.clubId === c.id));
    return byClub;
  }, [clubs, shots]);

  const visible = editing ? clubs : clubs.filter((c) => c.inBag);
  const inBag = clubs.filter((c) => c.inBag).length;
  // Scale the yardage bars against the longest stock carry.
  const longest = Math.max(1, ...visible.map((c) => stats[c.id]?.stockCarry ?? 0));

  return (
    <Screen tab headerless title="My Bag" subtitle="Your stock yardages, built from every shot you log.">
      <Row>
        <Button title="Log a shot" onPress={() => router.push('/shot/new')} style={{ flex: 1 }} />
        <Button
          title={editing ? 'Done' : 'Edit bag'}
          variant="secondary"
          onPress={() => setEditing((e) => !e)}
          style={{ flex: 1 }}
        />
      </Row>
      {editing ? (
        <ThemedText type="small" themeColor={inBag > 14 ? 'danger' : 'textSecondary'}>
          {inBag} of 14 clubs allowed by the rules.
        </ThemedText>
      ) : null}

      <SectionTitle right={<ThemedText type="small" themeColor="textSecondary">carry · shots</ThemedText>}>
        Clubs
      </SectionTitle>
      {visible.map((club) => {
        const s = stats[club.id];
        const carry = s?.stockCarry;
        return (
          <Card key={club.id} onPress={editing ? undefined : () => router.push(`/club/${club.id}`)}>
            <Row>
              <ThemedText type="smallBold" style={{ width: 64 }}>
                {club.name}
              </ThemedText>
              <View style={{ flex: 1, gap: 4 }}>
                {club.category === 'putter' ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    Putts are tracked on the scorecard
                  </ThemedText>
                ) : (
                  <View style={{ height: 10, borderRadius: 5, backgroundColor: theme.backgroundSelected }}>
                    <View
                      style={{
                        width: `${carry ? Math.round((carry / longest) * 100) : 0}%`,
                        height: '100%',
                        borderRadius: 5,
                        backgroundColor: theme.tint,
                      }}
                    />
                  </View>
                )}
                {s?.carryRange && s.usedCount >= 3 ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    Range {s.carryRange[0]}–{s.carryRange[1]} yds
                  </ThemedText>
                ) : null}
              </View>
              {editing ? (
                <Switch
                  value={club.inBag}
                  onValueChange={(inBag) => dispatch({ type: 'club/update', club: { ...club, inBag } })}
                  trackColor={{ true: theme.tint }}
                />
              ) : (
                <ThemedText style={{ width: 90, textAlign: 'right' }}>
                  <ThemedText type="smallBold">{carry !== undefined ? `${Math.round(carry)}` : '—'}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {' '}
                    · {s?.shotCount ?? 0}
                  </ThemedText>
                </ThemedText>
              )}
            </Row>
          </Card>
        );
      })}
    </Screen>
  );
}
