import { DefaultTheme, Redirect, Stack, ThemeProvider, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { CloudBridge } from '@/components/cloud-bridge';
import { T } from '@/constants/theme';
import { useStore } from '@/lib/store';

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

/**
 * Global lock gate: when the account has logged out, every route except the
 * login page (and onboarding, which has no data to protect) redirects to
 * /login — deep links included. The redirect-on-index alone is bypassable.
 */
function LockGate() {
  const lockedOut = useStore((s) => s.lockedOut);
  const pathname = usePathname();
  if (lockedOut && pathname !== '/login' && !pathname.startsWith('/onboarding')) {
    return <Redirect href="/login" />;
  }
  return null;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={theme}>
        <CloudBridge />
        <LockGate />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: T.ground } }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="login" />
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
