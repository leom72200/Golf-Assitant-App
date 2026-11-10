import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Empty, Row, Screen, SectionTitle, TextField } from '@/components/ui';
import { courseIdFor } from '@/domain/osm';
import type { CourseSummary, LatLng } from '@/domain/types';
import { getCurrentLocation } from '@/hooks/use-location';
import { downloadCourse, findCoursesNear, searchCoursesByName } from '@/services/courseApi';
import { dispatch, useAppState } from '@/state/store';

export default function CoursesScreen() {
  const saved = useAppState((s) => s.courses);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CourseSummary[]>();
  const [busy, setBusy] = useState<string>();
  const [here, setHere] = useState<LatLng>();

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      Alert.alert('Something went wrong', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  };

  const nearMe = () =>
    run('Finding courses near you…', async () => {
      const loc = await getCurrentLocation();
      if (!loc) {
        Alert.alert('Location needed', 'Allow location access to find courses near you, or search by name.');
        return;
      }
      setHere(loc);
      setResults(await findCoursesNear(loc));
    });

  const search = () =>
    query.trim().length >= 3 &&
    run('Searching…', async () => {
      setResults(await searchCoursesByName(query.trim(), here));
    });

  const open = (c: CourseSummary) => {
    const id = courseIdFor(c.source);
    if (saved.some((s) => s.id === id)) {
      router.push(`/course/${id}`);
      return;
    }
    run(`Downloading ${c.name}…`, async () => {
      const course = await downloadCourse(c.source);
      dispatch({ type: 'course/save', course });
      router.push(`/course/${course.id}`);
    });
  };

  return (
    <Screen tab headerless title="Courses" subtitle="Find a course and download its hole maps.">
      <Button title="Find courses near me" onPress={nearMe} disabled={!!busy} />
      <Row>
        <TextField value={query} onChange={setQuery} placeholder="Search by course name" />
        <Button title="Search" variant="secondary" onPress={search} disabled={!!busy || query.trim().length < 3} />
      </Row>

      {busy ? (
        <Row style={{ justifyContent: 'center' }}>
          <ActivityIndicator />
          <ThemedText type="small" themeColor="textSecondary">
            {busy}
          </ThemedText>
        </Row>
      ) : null}

      {results ? (
        <>
          <SectionTitle>Results</SectionTitle>
          {results.length === 0 ? (
            <Empty title="No courses found" body="Try a wider search, or a different spelling." />
          ) : (
            results.map((c) => (
              <Card key={c.source} onPress={busy ? undefined : () => open(c)}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <ThemedText type="smallBold" style={{ flex: 1 }}>
                    {c.name}
                  </ThemedText>
                  {c.distanceMiles !== undefined ? (
                    <ThemedText type="small" themeColor="textSecondary">
                      {c.distanceMiles} mi
                    </ThemedText>
                  ) : null}
                </Row>
                <ThemedText type="small" themeColor="tint">
                  {saved.some((s) => s.id === courseIdFor(c.source)) ? 'Downloaded — tap to open' : 'Tap to download'}
                </ThemedText>
              </Card>
            ))
          )}
        </>
      ) : null}

      <SectionTitle>My courses</SectionTitle>
      {saved.length === 0 ? (
        <Empty title="No saved courses" body="Downloaded courses are stored on your phone so they work without signal." />
      ) : (
        saved.map((c) => (
          <Card key={c.id} onPress={() => router.push(`/course/${c.id}`)}>
            <ThemedText type="smallBold">{c.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {[c.address, `${c.holes.length} holes mapped`].filter(Boolean).join(' · ')}
            </ThemedText>
          </Card>
        ))
      )}

      <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
        Course data © OpenStreetMap contributors (ODbL).
      </ThemedText>
    </Screen>
  );
}
