import { useEffect } from 'react';
import { LogBox, Platform } from 'react-native';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { SpatialNavigationDeviceTypeProvider } from 'react-tv-space-navigation';
import { AppNavigator, DISPLAY_FONT, setApiBaseUrl, setWatchOnly } from '@multi-tv/shared-ui';
import '../../packages/shared-ui/src/app/configureRemoteControl';
import { API_BASE_URL } from './config';

setApiBaseUrl(API_BASE_URL);
// In a browser StoryQuest is for watching; families make their own chapters on Fire TV.
setWatchOnly(Platform.OS === 'web');

if (__DEV__) {
  LogBox.ignoreLogs([/findNodeHandle is deprecated/, /findHostInstance_DEPRECATED is deprecated/]);
}

SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function App() {
  // Same file as the Vega app: the family name matches the file name.
  const [loaded, error] = useFonts({ [DISPLAY_FONT]: require('./assets/fonts/Fraunces.ttf') });
  const ready = loaded || !!error;

  useEffect(() => {
    if (error) console.warn('Fraunces did not load', error);
    if (ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready, error]);

  if (!ready) return null;
  // In a browser a mouse moves focus too, so cards light up under the pointer and a click selects them.
  return (
    <SpatialNavigationDeviceTypeProvider>
      <AppNavigator />
    </SpatialNavigationDeviceTypeProvider>
  );
}
