import React from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { colors } from '@/theme/colors';

/**
 * Tab bar « liquid glass » custom, dessinée en React Native → rendu IDENTIQUE
 * sur iOS et Android (contrairement à NativeTabs qui est natif par plateforme).
 */
export function GlassTabBar({
  state,
  descriptors,
  navigation,
  tint = colors.primary,
}: BottomTabBarProps & { tint?: string }) {
  const insets = useSafeAreaInsets();

  return (
    <BlurView
      intensity={Platform.OS === 'android' ? 30 : 40}
      tint="light"
      style={{
        paddingBottom: insets.bottom ? insets.bottom : 10,
        paddingTop: 10,
        paddingHorizontal: 8,
        borderTopWidth: 1,
        borderTopColor: 'rgba(17,17,17,0.06)',
        backgroundColor: 'rgba(251,250,247,0.72)', // teinte cohérente même si le flou est faible (Android)
      }}
    >
      <View style={{ flexDirection: 'row' }}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const label = (options.title ?? route.name) as string;
          const focused = state.index === index;
          const color = focused ? tint : colors.muted;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
          };
          const onLongPress = () =>
            navigation.emit({ type: 'tabLongPress', target: route.key });

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              onLongPress={onLongPress}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
              accessibilityLabel={label}
              style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
            >
              <View
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 5,
                  borderRadius: 999,
                  backgroundColor: focused ? tint + '1A' : 'transparent',
                }}
              >
                {options.tabBarIcon?.({ focused, color, size: 23 })}
              </View>
              <Text
                numberOfLines={1}
                style={{
                  color,
                  fontFamily: focused ? 'Mulish_700Bold' : 'Mulish_600SemiBold',
                  fontSize: 11,
                  marginTop: 3,
                }}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </BlurView>
  );
}
