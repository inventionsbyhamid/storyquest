import React, { useEffect } from 'react';
import { AppState } from 'react-native';
import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { colors } from '../theme';
import { sparks } from '../purchases';
import HomeScreen from '../screens/HomeScreen';
import CreateScreen from '../screens/CreateScreen';
import StoryScreen from '../screens/StoryScreen';
import EndScreen from '../screens/EndScreen';
import MovieScreen from '../screens/MovieScreen';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.marigold,
    background: colors.ink,
    card: colors.ink,
    text: colors.paper,
    border: colors.inkLine,
  },
};

const screenOptions = {
  headerShown: false,
  animation: 'fade' as const,
  contentStyle: { backgroundColor: colors.ink },
};

export default function AppNavigator() {
  useEffect(() => {
    sparks.start();
    // Amazon asks apps to look for unfinished purchases whenever they come back to the foreground.
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') sparks.resume();
    });
    return () => subscription.remove();
  }, []);

  return (
    <NavigationContainer theme={theme}>
      <Stack.Navigator initialRouteName="Home" screenOptions={screenOptions}>
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Create" component={CreateScreen} />
        <Stack.Screen name="Story" component={StoryScreen} />
        <Stack.Screen name="End" component={EndScreen} />
        <Stack.Screen name="Movie" component={MovieScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
