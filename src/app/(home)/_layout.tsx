import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs, useSegments } from 'expo-router';
import type { ComponentProps } from 'react';
import { Platform } from 'react-native';

import { DecorativeIcon, NavigationTabBar, useIsDesktop, useTabBarLayout } from '@/components/ui';
import { useCanDecide, useMembershipReady } from '@/lib/membership';

/**
 * The one set of tabs for everyone in a home.
 *
 * There used to be a `(parent)` and a `(child)` group, and both defined
 * `/inventory`, `/capture`, `/family` and `/account`. Groups don't appear in
 * the URL, so those were the same address twice: a reload of `/inventory`
 * landed in whichever group the router happened to pick, not the one for the
 * person's standing (QA A1). Now every screen has exactly one address, and
 * which tabs show — and in what order — follows the database membership
 * (`useCanDecide`), never a role the device remembered.
 *
 * Decider-only screens are also refused by address: a helper who types
 * `/decide` is sent to Capture. (The database refuses the writes regardless.)
 *
 * Tab icons are decorative: each tab's visible label already names it, and
 * Ionicons glyphs are private-use characters that a screen reader would
 * otherwise announce as garbage ahead of the label. `tabBarAccessibilityLabel`
 * pins each tab's accessible name to the plain word.
 */

type IconName = ComponentProps<typeof Ionicons>['name'];

interface TabDef {
  name: string;
  title: string;
  a11y?: string;
  icon?: IconName;
  /** Shown on the bar? `false` keeps the screen reachable but off the bar. */
  shown: boolean;
}

/** Screens only someone with the final say may open. */
const DECIDERS_ONLY = new Set(['decide', 'keepsakes', 'heirs', 'export', 'legacy']);

function deciderTabs(isDesktop: boolean): TabDef[] {
  return [
    { name: 'decide', title: 'Decide', icon: 'albums-outline', shown: true },
    // "Items" (not "All items") — five labels must fit at 375px.
    { name: 'inventory', title: 'Items', a11y: 'All items', icon: 'file-tray-full-outline', shown: true },
    { name: 'keepsakes', title: 'Keepsakes', icon: 'heart-outline', shown: true },
    // Heirs is off the mobile bar (five tabs is the 375px budget — Account
    // takes its slot) but stays on the roomy desktop rail. On mobile it's
    // reached from the Keepsakes header.
    { name: 'heirs', title: 'Heirs', icon: 'people-outline', shown: isDesktop },
    { name: 'export', title: 'Export', icon: 'document-text-outline', shown: true },
    // Account/Log out on every screen. Hidden on desktop, where the left
    // rail's footer already carries Account & settings + Log out.
    { name: 'account', title: 'Account', icon: 'person-circle-outline', shown: !isDesktop },
    { name: 'legacy', title: 'Legacy', shown: false },
    // Reached from Settings — administering the household is occasional work.
    { name: 'family', title: 'Family', shown: false },
    // Reachable from Decide's "Add item"; kept off the bar so five fit at 375px.
    { name: 'capture', title: 'Add item', shown: false },
    { name: 'rooms', title: 'Rooms', shown: false },
  ];
}

function helperTabs(isDesktop: boolean): TabDef[] {
  return [
    { name: 'capture', title: 'Capture', icon: 'camera-outline', shown: true },
    { name: 'rooms', title: 'Rooms', icon: 'grid-outline', shown: true },
    { name: 'inventory', title: 'Inventory', icon: 'list-outline', shown: true },
    { name: 'family', title: 'Family', icon: 'home-outline', shown: true },
    { name: 'account', title: 'Account', icon: 'person-circle-outline', shown: !isDesktop },
    // Declared but never on the bar (and refused by address, above).
    ...deciderTabs(isDesktop)
      .filter((t) => DECIDERS_ONLY.has(t.name))
      .map((t) => ({ ...t, shown: false })),
  ];
}

export default function HomeTabs() {
  const bar = useTabBarLayout();
  const isDesktop = useIsDesktop();
  const canDecide = useCanDecide();
  const ready = useMembershipReady();
  const segments = useSegments() as string[];

  const here = segments[segments.length - 1];
  if (ready && !canDecide && DECIDERS_ONLY.has(here)) return <Redirect href="/capture" />;

  const tabs = canDecide ? deciderTabs(isDesktop) : helperTabs(isDesktop);
  return (
    <Tabs
      tabBar={(props) => <NavigationTabBar {...props} label={canDecide ? 'Main' : 'Sections'} />}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: bar.tabBarActiveTintColor,
        tabBarActiveBackgroundColor: bar.tabBarActiveBackgroundColor,
        tabBarInactiveTintColor: bar.tabBarInactiveTintColor,
        tabBarInactiveBackgroundColor: bar.tabBarInactiveBackgroundColor,
        tabBarPosition: bar.tabBarPosition,
        tabBarStyle: bar.tabBarStyle,
        tabBarLabelStyle: bar.tabBarLabelStyle,
        tabBarItemStyle: bar.tabBarItemStyle,
        tabBarHideOnKeyboard: Platform.OS === 'android',
        freezeOnBlur: true,
      }}
    >
      {tabs.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.title,
            tabBarAccessibilityLabel: t.a11y ?? t.title,
            href: t.shown ? undefined : null,
            tabBarIcon: t.icon
              ? ({ color, size }) => (
                  <DecorativeIcon>
                    <Ionicons name={t.icon!} size={size} color={color} />
                  </DecorativeIcon>
                )
              : undefined,
          }}
        />
      ))}
    </Tabs>
  );
}
