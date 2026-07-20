import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { Platform } from 'react-native';

import {
  DecorativeIcon,
  NavigationTabBar,
  TAB_BAR_LABEL,
  TAB_BAR_WIDTH_CAP,
} from '@/components/ui';
import { T } from '@/constants/theme';

/**
 * Tab icons are decorative: each tab's visible label already names it, and
 * Ionicons glyphs are private-use characters that a screen reader would
 * otherwise announce as garbage ahead of the label. `tabBarAccessibilityLabel`
 * pins each tab's accessible name to the plain word.
 */
export default function ChildTabs() {
  return (
    <Tabs
      tabBar={(props) => <NavigationTabBar {...props} label="Sections" />}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: T.heading,
        tabBarInactiveTintColor: T.inkFaint,
        tabBarStyle: {
          backgroundColor: T.surface,
          borderTopColor: T.line,
          ...TAB_BAR_WIDTH_CAP,
        },
        tabBarLabelStyle: TAB_BAR_LABEL,
        tabBarHideOnKeyboard: Platform.OS === 'android',
        freezeOnBlur: true,
      }}
    >
      <Tabs.Screen
        name="capture"
        options={{
          title: 'Capture',
          tabBarAccessibilityLabel: 'Capture',
          tabBarIcon: ({ color, size }) => (
            <DecorativeIcon>
              <Ionicons name="camera-outline" size={size} color={color} />
            </DecorativeIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="rooms"
        options={{
          title: 'Rooms',
          tabBarAccessibilityLabel: 'Rooms',
          tabBarIcon: ({ color, size }) => (
            <DecorativeIcon>
              <Ionicons name="grid-outline" size={size} color={color} />
            </DecorativeIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="inventory"
        options={{
          title: 'Inventory',
          tabBarAccessibilityLabel: 'Inventory',
          tabBarIcon: ({ color, size }) => (
            <DecorativeIcon>
              <Ionicons name="list-outline" size={size} color={color} />
            </DecorativeIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="family"
        options={{
          title: 'Family',
          tabBarAccessibilityLabel: 'Family',
          tabBarIcon: ({ color, size }) => (
            <DecorativeIcon>
              <Ionicons name="home-outline" size={size} color={color} />
            </DecorativeIcon>
          ),
        }}
      />
    </Tabs>
  );
}
