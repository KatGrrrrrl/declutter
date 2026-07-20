/**
 * Inventory Our Home design tokens — translated from docs/mockup/declutter-mockup.html.
 * Single light theme by design decision (white ground, navy headings, brass
 * accents). A dark theme may return later as an explicit user option.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const T = {
  // grounds
  ground: '#FFFFFF',
  surface: '#FFFFFF',
  sunken: '#F6F5F3',
  // text
  ink: '#1B1815',
  inkSoft: '#6D675F',
  inkFaint: '#A09A90',
  heading: '#1E3A5F', // dark navy — all display headings
  // hairlines
  line: '#E9E8E5',
  lineSoft: '#F2F1EE',
  // brand accent
  brass: '#A67C34',
  brassDeep: '#7E5D22',
  brassTint: '#F7F0DF',
  // decision colors
  keep: '#4E7247',
  donate: '#44708A',
  toss: '#A65441',
  keepTint: '#ECF3E8',
  donateTint: '#E9F2F6',
  tossTint: '#FAECE7',
} as const;

/** Legacy scaffold export shape — both schemes resolve to the white theme. */
export const Colors = {
  light: {
    text: T.ink,
    background: T.ground,
    backgroundElement: T.sunken,
    backgroundSelected: T.lineSoft,
    textSecondary: T.inkSoft,
  },
  dark: {
    text: T.ink,
    background: T.ground,
    backgroundElement: T.sunken,
    backgroundSelected: T.lineSoft,
    textSecondary: T.inkSoft,
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "'Avenir Next','Segoe UI',system-ui,sans-serif",
    serif: "'Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif",
    rounded: 'system-ui',
    mono: "'SF Mono','Cascadia Code',ui-monospace,monospace",
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

export const Radius = {
  card: 22,
  control: 14,
  pill: 999,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
