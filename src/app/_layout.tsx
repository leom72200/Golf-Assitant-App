import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';

export default function RootLayout() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const colors = Colors[scheme];
  return (
    <ThemeProvider
      value={{
        ...base,
        colors: { ...base.colors, primary: colors.tint, background: colors.background, card: colors.background },
      }}>
      <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal', headerTintColor: colors.tint }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="club/[id]" options={{ title: 'Club' }} />
        <Stack.Screen name="shot/new" options={{ title: 'Log shot', presentation: 'modal' }} />
        <Stack.Screen name="lab/record" options={{ title: 'Record swing', headerShown: false }} />
        <Stack.Screen name="lab/analyze" options={{ title: 'Analyze clip' }} />
        <Stack.Screen name="course/[id]/index" options={{ title: 'Course' }} />
        <Stack.Screen name="course/[id]/hole/[hole]" options={{ title: 'Hole' }} />
        <Stack.Screen name="round/new" options={{ title: 'New round', presentation: 'modal' }} />
        <Stack.Screen name="round/[id]" options={{ title: 'Scorecard' }} />
      </Stack>
    </ThemeProvider>
  );
}
