import { useEffect } from 'react';
import { LogBox } from 'react-native';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { AppNavigator, DISPLAY_FONT, setApiBaseUrl } from '@multi-tv/shared-ui';
import '../../packages/shared-ui/src/app/configureRemoteControl';
import { API_BASE_URL } from './config';

setApiBaseUrl(API_BASE_URL);

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

  return ready ? <AppNavigator /> : null;
}
