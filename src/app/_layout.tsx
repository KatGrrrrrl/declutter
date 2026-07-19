import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { T } from '@/constants/theme';

SplashScreen.preventAutoHideAsync();
SplashScreen.hideAsync();

const theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: T.ground,
    card: T.surface,
    text: T.ink,
    primary: T.heading,
    border: T.line,
  },
};

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={theme}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: T.ground } }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="(parent)" />
          <Stack.Screen name="(child)" />
          <Stack.Screen
            name="item/[id]"
            options={{ presentation: 'card', headerShown: false }}
          />
        </Stack>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
