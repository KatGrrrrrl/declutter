import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

import { CONTENT_MAX } from '@/components/ui';
import { T } from '@/constants/theme';

export default function ParentTabs() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: T.heading,
        tabBarInactiveTintColor: T.inkFaint,
        tabBarStyle: {
          backgroundColor: T.surface,
          borderTopColor: T.line,
          // Match the centered app column on desktop.
          width: '100%',
          maxWidth: CONTENT_MAX,
          alignSelf: 'center',
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="decide"
        options={{
          title: 'Decide',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="albums-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="keepsakes"
        options={{
          title: 'Keepsakes',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="heart-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="heirs"
        options={{
          title: 'Heirs',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="export"
        options={{
          title: 'Export',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="document-text-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen name="legacy" options={{ href: null }} />
    </Tabs>
  );
}
