import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Alert } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Empty, Row, Screen, SectionTitle } from '@/components/ui';
import { downloadCourse } from '@/services/courseApi';
import { dispatch, useAppState } from '@/state/store';

export default function CourseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const course = useAppState((s) => s.courses.find((c) => c.id === id));
  if (!course) return <Empty title="Course not found" />;

  const par = course.holes.reduce((s, h) => s + (h.par ?? 0), 0);
  const yards = course.holes.reduce((s, h) => s + (h.yards ?? 0), 0);

  const refresh = async () => {
    try {
      dispatch({ type: 'course/save', course: await downloadCourse(course.source) });
    } catch (e) {
      Alert.alert('Could not refresh', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: course.name }} />
      <ThemedText type="smallBold">{course.name}</ThemedText>
      {course.address ? <ThemedText themeColor="textSecondary">{course.address}</ThemedText> : null}
      <ThemedText type="small" themeColor="textSecondary">
        {course.holes.length} holes{par ? ` · par ${par}` : ''}
        {yards ? ` · ~${yards.toLocaleString()} yds` : ''}
      </ThemedText>

      <Button title="Start a round here" onPress={() => router.push({ pathname: '/round/new', params: { courseId: course.id } })} />

      <SectionTitle>Holes</SectionTitle>
      {course.holes.length === 0 ? (
        <Empty
          title="No hole maps yet"
          body="Nobody has mapped this course's holes in OpenStreetMap yet. You can still keep score here — or map it yourself at openstreetmap.org and refresh."
        />
      ) : (
        course.holes.map((h) => (
          <Card key={h.number} onPress={() => router.push(`/course/${course.id}/hole/${h.number}`)}>
            <Row style={{ justifyContent: 'space-between' }}>
              <ThemedText type="smallBold">Hole {h.number}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {[h.par && `Par ${h.par}`, h.yards && `${h.yards} yds`, h.handicap && `HCP ${h.handicap}`]
                  .filter(Boolean)
                  .join(' · ')}
              </ThemedText>
            </Row>
            {!h.green ? (
              <ThemedText type="small" themeColor="textSecondary">
                Green outline not mapped — distances are to the end of the hole line.
              </ThemedText>
            ) : null}
          </Card>
        ))
      )}

      <Row>
        <Button title="Refresh map data" variant="secondary" onPress={refresh} style={{ flex: 1 }} />
        <Button
          title="Remove"
          variant="danger"
          style={{ flex: 1 }}
          onPress={() =>
            Alert.alert('Remove course?', 'Your rounds played here are kept.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Remove',
                style: 'destructive',
                onPress: () => {
                  dispatch({ type: 'course/delete', id: course.id });
                  router.back();
                },
              },
            ])
          }
        />
      </Row>
      <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
        Map data © OpenStreetMap contributors (ODbL).
      </ThemedText>
    </Screen>
  );
}
