/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://unistyl.es/), etc.
 */

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#11181C',
    background: '#ffffff',
    backgroundElement: '#F0F3F0',
    backgroundSelected: '#DDE6DE',
    textSecondary: '#5F6B63',
    /** Brand green: buttons, highlights, progress. */
    tint: '#1F7A3F',
    onTint: '#ffffff',
    success: '#1F7A3F',
    warning: '#B26B00',
    danger: '#C62828',
    border: '#D5DDD6',
  },
  dark: {
    text: '#ECEDEE',
    background: '#0B0F0C',
    backgroundElement: '#1A211C',
    backgroundSelected: '#26302A',
    textSecondary: '#A3B0A7',
    tint: '#4CC27A',
    onTint: '#06240F',
    success: '#4CC27A',
    warning: '#F0A93B',
    danger: '#FF6B6B',
    border: '#2E3A32',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
