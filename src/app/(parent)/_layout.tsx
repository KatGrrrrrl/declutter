import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { Platform } from 'react-native';

import { DecorativeIcon, NavigationTabBar, useTabBarLayout } from '@/components/ui';

/**
 * Tab icons are decorative: each tab's visible label already names it, and
 * Ionicons glyphs are private-use characters that a screen reader would
 * otherwise announce as garbage ahead of the label. `tabBarAccessibilityLabel`
 * pins each tab's accessible name to the plain word.
 */
export default function ParentTabs() {
  const bar = useTabBarLayout();
  return (
    <Tabs
      tabBar={(props) => <NavigationTabBar {...props} label="Main" />}
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
      <Tabs.Screen
        name="decide"
        options={{
          title: 'Decide',
          tabBarAccessibilityLabel: 'Decide',
          tabBarIcon: ({ color, size }) => (
            <DecorativeIcon>
              <Ionicons name="albums-outline" size={size} color={color} />
            </DecorativeIcon>
          ),
        }}
      />
      {/* "Items" (not "All items") — five labels must fit at 375px. */}
      <Tabs.Screen
        name="inventory"
        options={{
          title: 'Items',
          tabBarAccessibilityLabel: 'All items',
          tabBarIcon: ({ color, size }) => (
            <DecorativeIcon>
              <Ionicons name="file-tray-full-outline" size={size} color={color} />
            </DecorativeIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="keepsakes"
        options={{
          title: 'Keepsakes',
          tabBarAccessibilityLabel: 'Keepsakes',
          tabBarIcon: ({ color, size }) => (
            <DecorativeIcon>
              <Ionicons name="heart-outline" size={size} color={color} />
            </DecorativeIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="heirs"
        options={{
          title: 'Heirs',
          tabBarAccessibilityLabel: 'Heirs',
          tabBarIcon: ({ color, size }) => (
            <DecorativeIcon>
              <Ionicons name="people-outline" size={size} color={color} />
            </DecorativeIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="export"
        options={{
          title: 'Export',
          tabBarAccessibilityLabel: 'Export',
          tabBarIcon: ({ color, size }) => (
            <DecorativeIcon>
              <Ionicons name="document-text-outline" size={size} color={color} />
            </DecorativeIcon>
          ),
        }}
      />
      <Tabs.Screen name="legacy" options={{ href: null, title: 'Legacy' }} />
      {/* Reachable from Decide's "Add item"; kept off the bar so five fit at 375px. */}
      <Tabs.Screen name="capture" options={{ href: null, title: 'Add item' }} />
    </Tabs>
  );
}
