import { DefaultTheme, Redirect, Stack, ThemeProvider, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { CloudBridge } from '@/components/cloud-bridge';
import { PresenceBanner } from '@/components/presence-banner';
import { RestorePrompt } from '@/components/restore-prompt';
import { T } from '@/constants/theme';
import { startAuth, useSession } from '@/lib/auth';
import { useStore } from '@/lib/store';
import { useDocumentTitle } from '@/lib/use-document-title';

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

/**
 * Covers the app while this device's state is being matched to the account.
 *
 * Between "a session exists" and "this device's contents belong to it", the
 * persisted store still holds whoever used the device last — their home and
 * their role. The screens underneath don't know about accounts, so without a
 * cover the previous person's Decide deck could draw for the moment it takes
 * to ask the server. Only needed when there IS a real home here; a signed-out
 * visitor or the demo has nothing to protect.
 *
 * An overlay, not an unmount: tearing the navigator down on every auth change
 * would throw away navigation state. The content underneath is hidden from
 * assistive technology for as long as the cover is up.
 */
function useAuthCover(): boolean {
  const { status } = useSession();
  const realHome = useStore((s) => s.onboarded && !s.isDemo);
  return realHome && (status === 'unknown' || status === 'resolving');
}

export default function RootLayout() {
  // Web page titles. expo-router disables React Navigation's own document-title
  // updater, so this reads the same `title` options below and applies them.
  useDocumentTitle();

  // The one session listener for the whole app (src/lib/auth.ts). Started in
  // an effect, not at import: static web rendering loads this file at build
  // time, where there is no browser storage and no session to read.
  useEffect(() => {
    startAuth();
  }, []);
  const covered = useAuthCover();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={theme}>
        <CloudBridge />
        <LockGate />
        {/* Sits above the whole stack so "Tom is here too" survives tab and
            detail navigation; it renders nothing unless someone else is online. */}
        <View style={{ flex: 1 }} aria-hidden={covered}>
        <PresenceBanner />
        {/* "Your backup is waiting" — the one-tap device-pairing step. */}
        <RestorePrompt />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: T.ground } }}>
          <Stack.Screen name="index" options={{ title: 'Home' }} />
          <Stack.Screen name="onboarding" options={{ title: 'Welcome' }} />
          <Stack.Screen name="login" options={{ title: 'Sign in' }} />
          <Stack.Screen name="(parent)" />
          <Stack.Screen name="(child)" />
          <Stack.Screen
            name="item/[id]"
            options={{ presentation: 'card', headerShown: false, title: 'Item' }}
          />
          <Stack.Screen
            name="collection/[id]"
            options={{ presentation: 'card', headerShown: false, title: 'Collection' }}
          />
        </Stack>
        </View>
        {covered ? (
          <View style={styles.cover} role="progressbar" aria-label="Opening your home">
            <Text style={styles.coverWordmark}>Inventory Our Home</Text>
          </View>
        ) : null}
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  cover: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: T.ground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverWordmark: { fontSize: 20, fontWeight: '600', color: T.brassDeep },
});
