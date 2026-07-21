/**
 * Inventory Our Home UI kit — small shared primitives matching the mockup's design
 * language: white ground, navy serif headings, brass labels, tinted decision
 * pills, hairline-bordered cards. Screens compose these; keep them dumb.
 */

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useIsFocused, useRouter } from 'expo-router';
import { BottomTabBar } from 'expo-router/build/react-navigation/bottom-tabs/views/BottomTabBar';
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs/types';
import { PropsWithChildren, useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextProps,
  useWindowDimensions,
  View,
  ViewProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Fonts, Radius, Spacing, T } from '@/constants/theme';
import { useSignedPhotoUrl } from '@/lib/photo-sync';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

import type { Decision } from '@/lib/store';

/** Max width of the app column on phones — roughly a large phone. */
export const CONTENT_MAX = 460;
/** Wider content column on desktop, so the app fills the screen instead of
 *  sitting phone-width in the middle of a monitor. */
export const DESKTOP_CONTENT_MAX = 1080;
/** Width of the left navigation rail on desktop. */
export const SIDEBAR_WIDTH = 232;
/** At or above this viewport width (web only) we switch to the desktop layout:
 *  a left nav rail + wide content. */
export const DESKTOP_BREAKPOINT = 900;

/** True when we should render the expanded desktop layout. */
export function useIsDesktop() {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= DESKTOP_BREAKPOINT;
}

/**
 * Web-only tab bar adjustments. On native the tab bar is positioned
 * absolutely and honors the device safe area natively; applying any of this
 * there detaches it and it disappears off-screen. On web we (a) cap width to
 * the app column, and (b) give the bar explicit height + bottom padding so
 * labels clear Safari's toolbar / the iPhone home indicator (the page shell
 * additionally pads by env(safe-area-inset-bottom) — see global.css and
 * app/+html.tsx's viewport-fit=cover).
 */
export const TAB_BAR_WIDTH_CAP =
  Platform.OS === 'web'
    ? ({
        width: '100%',
        maxWidth: CONTENT_MAX,
        alignSelf: 'center',
        // Tall enough for icon + label INCLUDING descenders (the "y" in
        // "Family" was being clipped at 62); paddingBottom keeps the labels
        // off the very edge.
        height: 76,
        paddingTop: 6,
        paddingBottom: 12,
      } as const)
    : ({} as const);

/**
 * Tab label style. The explicit lineHeight is the fix for clipped descenders
 * on web: without it the line box hugs the cap height and "y"/"p" get cut.
 */
export const TAB_BAR_LABEL =
  Platform.OS === 'web'
    ? ({ fontSize: 11, fontWeight: '600', lineHeight: 16, paddingBottom: 2 } as const)
    : ({ fontSize: 11, fontWeight: '600' } as const);

/**
 * Responsive tab-bar config. On desktop the bar moves to a fixed left rail
 * (sidebar) with larger labels; on phones it stays the bottom bar. Spread the
 * returned `tabBarStyle`/`tabBarLabelStyle` and pass `tabBarPosition`.
 */
export function useTabBarLayout() {
  const isDesktop = useIsDesktop();
  if (isDesktop) {
    return {
      tabBarPosition: 'left' as const,
      // Active item is a light brass pill with navy text/icon. The side bar
      // uses the active TINT as the pill fill, so without an explicit active
      // background the pill would be navy — invisible under navy text.
      tabBarActiveTintColor: T.heading,
      tabBarActiveBackgroundColor: T.brassTint,
      tabBarInactiveTintColor: T.inkSoft,
      tabBarInactiveBackgroundColor: 'transparent',
      tabBarStyle: {
        backgroundColor: T.surface,
        borderRightColor: T.line,
        borderRightWidth: 1,
        borderTopWidth: 0,
        // The side bar defaults to minWidth = 25% of the frame (react-navigation
        // getDefaultSidebarWidth); pin both bounds to hold a tidy rail width.
        width: SIDEBAR_WIDTH,
        minWidth: SIDEBAR_WIDTH,
        maxWidth: SIDEBAR_WIDTH,
        paddingTop: 12,
        paddingHorizontal: 12,
      },
      tabBarLabelStyle: { fontSize: 14, fontWeight: '600' as const },
      tabBarItemStyle: {
        flexDirection: 'row' as const,
        justifyContent: 'flex-start' as const,
        gap: 12,
        height: 52,
        borderRadius: 12,
        paddingHorizontal: 14,
      },
    };
  }
  return {
    tabBarPosition: 'bottom' as const,
    tabBarActiveTintColor: T.heading,
    tabBarActiveBackgroundColor: undefined,
    tabBarInactiveTintColor: T.inkFaint,
    tabBarInactiveBackgroundColor: undefined,
    tabBarStyle: { backgroundColor: T.surface, borderTopColor: T.line, ...TAB_BAR_WIDTH_CAP },
    tabBarLabelStyle: TAB_BAR_LABEL,
    tabBarItemStyle: undefined,
  };
}

/**
 * Renders the stock bottom tab bar inside a `navigation` landmark.
 *
 * React Navigation's tab bar exposes `role="tablist"` but no landmark, so on
 * web there is no way to jump to the app's primary navigation. The navigator's
 * `tabBar` prop is the only supported seam, and it hands us the exact props the
 * default bar takes — so we render the real `BottomTabBar` (no visual change)
 * and only add the wrapper element around it. RNW maps `role="navigation"` to a
 * real `<nav>`; the accessible name distinguishes the parent and child bars.
 *
 * The import is a deep path because expo-router vendors React Navigation and
 * re-exports the navigators but not the tab bar itself.
 *
 * Must be RENDERED as an element (`tabBar={(p) => <NavigationTabBar {...p} />}`),
 * never returned from a factory: React Compiler is enabled in this project and
 * rewrites anything component-shaped to use hooks, but React Navigation invokes
 * the `tabBar` prop as a plain function call — which makes those injected hooks
 * an "Invalid hook call". Going through an element keeps the render legitimate.
 */
export function NavigationTabBar({ label, ...props }: BottomTabBarProps & { label: string }) {
  // On desktop the rail is a full-height left column; the landmark wrapper must
  // stretch so it doesn't collapse the sidebar. It also carries a header with
  // the wordmark, an account/settings link, and — when signed in — a Log out
  // link, so account actions are reachable from the main menu itself.
  const isDesktop = useIsDesktop();
  const router = useRouter();

  // Hooks must run unconditionally, so track the session before the mobile
  // early-return below.
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSessionEmail(data.session?.user.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) =>
      setSessionEmail(s?.user.email ?? null)
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  const logOut = async () => {
    const email = sessionEmail ?? '';
    await supabase.auth.signOut();
    // lockOut flips `lockedOut`, which the root LockGate turns into a redirect
    // to /login — no explicit navigation (a second nav races the confirmation).
    useStore.getState().lockOut(email);
  };

  if (!isDesktop) {
    return (
      <View role="navigation" aria-label={label}>
        <BottomTabBar {...props} />
      </View>
    );
  }
  return (
    <View role="navigation" aria-label={label} style={styles.rail}>
      <View style={styles.railHeader}>
        <Text style={styles.railWordmark}>Inventory Our Home</Text>
      </View>
      <BottomTabBar {...props} />
      {/* Account actions live at the bottom of the rail, away from the primary
          sections. marginTop:auto pushes this block to the foot of the column. */}
      <View style={styles.railFooter}>
        <Pressable
          accessibilityRole="link"
          onPress={() => router.push('/settings')}
          style={({ pressed }) => [styles.railSettings, pressed && styles.pressed]}
        >
          <DecorativeIcon>
            <Ionicons name="settings-outline" size={18} color={T.inkSoft} />
          </DecorativeIcon>
          <Text style={styles.railSettingsText}>Account & settings</Text>
        </Pressable>
        {sessionEmail && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Log out"
            onPress={logOut}
            style={({ pressed }) => [styles.railSettings, pressed && styles.pressed]}
          >
            <DecorativeIcon>
              <Ionicons name="log-out-outline" size={18} color={T.inkSoft} />
            </DecorativeIcon>
            <Text style={styles.railSettingsText}>Log out</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

/* ---------- layout ---------- */

/**
 * Every screen renders inside a centered content column. On phones it's capped
 * near a large phone width; on desktop it widens to DESKTOP_CONTENT_MAX so the
 * app fills the space beside the left nav rail instead of sitting phone-width
 * in the middle of the monitor.
 */
export function Screen({
  children,
  scroll = true,
  padded = true,
}: PropsWithChildren<{ scroll?: boolean; padded?: boolean }>) {
  const inner = padded ? styles.padded : undefined;
  const isDesktop = useIsDesktop();
  const widthCap = { maxWidth: isDesktop ? DESKTOP_CONTENT_MAX : CONTENT_MAX };
  const desktopPad = isDesktop ? styles.desktopPad : null;

  // React Navigation keeps every visited tab screen mounted. On native that is
  // invisible (react-native-screens detaches them); on web `screensEnabled()`
  // is false, so the fallback is a plain View and blurred screens stay in the
  // DOM — fully exposed to assistive tech. Reading /export would also read
  // Decide's queue. Hiding the blurred screen removes it from the a11y tree
  // and from `innerText` while preserving its component state (unmounting
  // would throw away scroll position and in-flight form state).
  const focused = useIsFocused();
  const blurredOnWeb = Platform.OS === 'web' && !focused;

  return (
    <SafeAreaView
      style={[styles.screen, blurredOnWeb && styles.hiddenScreen]}
      edges={['top']}
      // Exactly one `main` landmark at a time — the focused screen's.
      role={blurredOnWeb ? undefined : 'main'}
      aria-hidden={blurredOnWeb || undefined}
      importantForAccessibility={blurredOnWeb ? 'no-hide-descendants' : 'auto'}
    >
      {scroll ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.column, widthCap, inner, desktopPad, styles.scrollContent]}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, styles.columnFill, widthCap, inner, desktopPad]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Row({ style, ...rest }: ViewProps) {
  return <View style={[styles.row, style]} {...rest} />;
}

/**
 * Wraps a purely decorative icon so it never reaches assistive tech.
 *
 * Ionicons are an icon FONT: each glyph is a real character in the Unicode
 * private-use area, so a screen reader reading an unguarded icon announces
 * garbage (or, in the tab bar, the glyph twice before the label). The label
 * next to the icon always carries the meaning, so hide the glyph outright.
 */
export function DecorativeIcon({ children, style }: PropsWithChildren<{ style?: ViewProps['style'] }>) {
  return (
    <View
      style={[{ pointerEvents: 'none' }, style]}
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {children}
    </View>
  );
}

/* ---------- typography ---------- */

/**
 * Big navy serif screen title — the screen's level-1 heading.
 *
 * react-native-web turns `role="heading"` + `aria-level` into a real `<hN>`
 * element (see AccessibilityUtil/propsToAccessibilityComponent), so this is a
 * genuine `<h1>` in the DOM, not just an ARIA override. Purely semantic: the
 * kit's own font sizing is unchanged, and RNW's reset strips UA heading margins.
 */
export function Title({ style, ...rest }: TextProps) {
  return <Text role="heading" aria-level={1} style={[styles.title, style]} {...rest} />;
}

/** Navy serif for card/item names — level-2 heading. */
export function Heading({ style, ...rest }: TextProps) {
  return <Text role="heading" aria-level={2} style={[styles.heading, style]} {...rest} />;
}

/**
 * Brass uppercase section label. Opt into `asHeading` where the label actually
 * introduces a section (level 3) rather than captioning a single value —
 * defaults to plain text so existing uses keep their current semantics.
 */
export function Label({
  style,
  asHeading = false,
  ...rest
}: TextProps & { asHeading?: boolean }) {
  return (
    <Text
      role={asHeading ? 'heading' : undefined}
      aria-level={asHeading ? 3 : undefined}
      style={[styles.label, style]}
      {...rest}
    />
  );
}

export function Body({ style, ...rest }: TextProps) {
  return <Text style={[styles.body, style]} {...rest} />;
}

export function Muted({ style, ...rest }: TextProps) {
  return <Text style={[styles.muted, style]} {...rest} />;
}

/* ---------- surfaces ---------- */

export function Card({ style, ...rest }: ViewProps) {
  return <View style={[styles.card, style]} {...rest} />;
}

/** Recessed panel (search wells, story panels, toggles). */
export function Well({ style, ...rest }: ViewProps) {
  return <View style={[styles.well, style]} {...rest} />;
}

/* ---------- controls ---------- */

export function Btn({
  label,
  onPress,
  kind = 'primary',
  big = false,
  disabled = false,
}: {
  label: string;
  onPress?: () => void;
  kind?: 'primary' | 'quiet' | 'brass';
  big?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        kind === 'primary' && styles.btnPrimary,
        kind === 'brass' && styles.btnBrass,
        kind === 'quiet' && styles.btnQuiet,
        big && styles.btnBig,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text
        style={[
          styles.btnText,
          big && styles.btnTextBig,
          kind === 'quiet' && styles.btnTextQuiet,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const DECISION_META: Record<
  Exclude<Decision, 'undecided'>,
  { label: string; color: string; tint: string }
> = {
  keep: { label: 'Keep', color: T.keep, tint: T.keepTint },
  donate: { label: 'Donate', color: T.donate, tint: T.donateTint },
  toss: { label: 'Let go', color: T.toss, tint: T.tossTint },
};

export function DecisionPill({ decision }: { decision: Decision }) {
  if (decision === 'undecided') {
    return (
      <View style={[styles.pill, { backgroundColor: T.sunken }]}>
        <Text style={[styles.pillText, { color: T.inkSoft }]}>Undecided</Text>
      </View>
    );
  }
  const m = DECISION_META[decision];
  return (
    <View style={[styles.pill, { backgroundColor: m.tint }]}>
      <Text style={[styles.pillText, { color: m.color }]}>{m.label}</Text>
    </View>
  );
}

export function Tag({ children }: { children: string }) {
  return (
    <View style={styles.tag}>
      <Text style={styles.tagText}>#{children}</Text>
    </View>
  );
}

/* ---------- photo placeholder ---------- */

/**
 * Renders the item photo when present, else a clean neutral placeholder with
 * the item's initial in serif — matching the mockup's quiet gray photo boxes.
 *
 * Photo source order: the local camera uri, then a cloud photo (`remotePath`,
 * a private-bucket storage path resolved to a short-lived signed URL). The
 * placeholder shows while the signed URL resolves or when neither exists.
 */
export function PhotoBox({
  title,
  photoUri,
  remotePath,
  height = 180,
  radius = 16,
}: {
  title: string;
  photoUri?: string;
  remotePath?: string;
  height?: number;
  radius?: number;
}) {
  // Only resolve the remote photo when there is no local one to show.
  const remoteUrl = useSignedPhotoUrl(photoUri ? undefined : remotePath);
  const uri = photoUri ?? remoteUrl ?? undefined;
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ height, borderRadius: radius, backgroundColor: T.sunken }}
        contentFit="cover"
        accessibilityLabel={title}
      />
    );
  }
  return (
    <View style={[styles.photoBox, { height, borderRadius: radius }]}>
      <Text style={styles.photoInitial}>{title.slice(0, 1)}</Text>
    </View>
  );
}

/* ---------- styles ---------- */

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: T.ground },
  // Web-only: a blurred-but-still-mounted tab screen (see Screen).
  hiddenScreen: { display: 'none' },
  flex: { flex: 1 },
  // Centered, phone-width column — caps the layout on desktop, no-op on phones.
  // Desktop nav rail header (wordmark + account/settings link above the tabs).
  rail: { alignSelf: 'stretch', height: '100%', flexDirection: 'column' },
  railHeader: { paddingHorizontal: 14, paddingTop: 22, paddingBottom: 14 },
  railFooter: {
    marginTop: 'auto',
    paddingHorizontal: 14,
    paddingVertical: 16,
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: T.lineSoft,
  },
  railWordmark: {
    fontFamily: Fonts?.serif,
    fontSize: 17,
    fontWeight: '600',
    color: T.heading,
  },
  railSettings: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 40,
    borderRadius: 10,
    paddingHorizontal: 8,
  },
  railSettingsText: { fontSize: 13.5, fontWeight: '600', color: T.inkSoft },

  // maxWidth is applied inline (responsive); keep width/centering here.
  column: { width: '100%', alignSelf: 'center' },
  columnFill: { width: '100%', alignSelf: 'center' },
  padded: { paddingHorizontal: Spacing.three },
  // A touch more breathing room around the wider desktop column.
  desktopPad: { paddingHorizontal: Spacing.five, paddingTop: Spacing.two },
  scrollContent: { paddingBottom: Spacing.six },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },

  title: {
    fontFamily: Fonts?.serif,
    fontSize: 30,
    fontWeight: '600',
    color: T.heading,
    marginTop: Spacing.three,
    marginBottom: Spacing.two,
  },
  heading: {
    fontFamily: Fonts?.serif,
    fontSize: 19,
    fontWeight: '600',
    color: T.heading,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2.4,
    textTransform: 'uppercase',
    color: T.brassDeep,
    marginTop: Spacing.four,
    marginBottom: Spacing.two,
  },
  body: { fontSize: 15, lineHeight: 21, color: T.ink },
  muted: { fontSize: 13, lineHeight: 18, color: T.inkSoft },

  card: {
    backgroundColor: T.surface,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: T.line,
    padding: Spacing.three,
  },
  well: {
    backgroundColor: T.sunken,
    borderRadius: Radius.control,
    padding: Spacing.three,
  },

  btn: {
    borderRadius: Radius.control,
    paddingVertical: 12,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { backgroundColor: T.heading },
  btnBrass: { backgroundColor: T.brass },
  btnQuiet: {
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.line,
  },
  btnBig: { paddingVertical: 18, borderRadius: 18 },
  btnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  btnTextBig: { fontSize: 17 },
  btnTextQuiet: { color: T.ink },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.4 },

  pill: {
    borderRadius: Radius.pill,
    paddingVertical: 4,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
  },
  pillText: { fontSize: 12, fontWeight: '700' },

  tag: {
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: T.line,
    paddingVertical: 3,
    paddingHorizontal: 10,
    alignSelf: 'flex-start',
  },
  tagText: { fontSize: 12, color: T.inkSoft },

  photoBox: {
    backgroundColor: T.sunken,
    borderWidth: 1,
    borderColor: T.lineSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoInitial: {
    fontFamily: Fonts?.serif,
    fontSize: 44,
    color: T.inkFaint,
  },
});

export { DECISION_META };
