import { useEffect } from 'react';
import { LogBox, Platform } from 'react-native';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { SpatialNavigationDeviceTypeProvider } from 'react-tv-space-navigation';
import {
  AppNavigator,
  DISPLAY_FONT,
  readHomeCache,
  setApiBaseUrl,
  setWatchOnly,
  whenHomeShown,
} from '@multi-tv/shared-ui';
import '../../packages/shared-ui/src/app/configureRemoteControl';
import { API_BASE_URL } from './config';

setApiBaseUrl(API_BASE_URL);
// In a browser StoryQuest is for watching; families make their own chapters on Fire TV.
setWatchOnly(Platform.OS === 'web');

if (__DEV__) {
  LogBox.ignoreLogs([/findNodeHandle is deprecated/, /findHostInstance_DEPRECATED is deprecated/]);
}

SplashScreen.preventAutoHideAsync().catch(() => undefined);
readHomeCache();

// The TV builds carry Fraunces inside the app (the expo-font plugin), so only a browser waits for it.
const LOAD_FONTS = Platform.OS === 'web';
// The splash stays until Home has stories on screen, but never longer than this.
const SPLASH_MAX_MS = 2500;

export default function App() {
  // Same file as the Vega app: the family name matches the file name.
  const [loaded, error] = useFonts(LOAD_FONTS ? { [DISPLAY_FONT]: require('./assets/fonts/Fraunces.ttf') } : {});
  const ready = !LOAD_FONTS || loaded || !!error;

  useEffect(() => {
    if (error) console.warn('Fraunces did not load', error);
  }, [error]);

  useEffect(() => {
    if (!ready) return;
    let hidden = false;
    const hide = () => {
      if (hidden) return;
      hidden = true;
      SplashScreen.hideAsync().catch(() => undefined);
    };
    const timer = setTimeout(hide, SPLASH_MAX_MS);
    whenHomeShown().then(hide);
    return () => clearTimeout(timer);
  }, [ready]);

  if (!ready) return null;
  // In a browser a mouse moves focus too, so cards light up under the pointer and a click selects them.
  return (
    <SpatialNavigationDeviceTypeProvider>
      <AppNavigator />
    </SpatialNavigationDeviceTypeProvider>
  );
}
