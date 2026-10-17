import { useEffect } from 'react';
import { LogBox } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { AppNavigator, setApiBaseUrl } from '@multi-tv/shared-ui';
import '../../packages/shared-ui/src/app/configureRemoteControl';
import { API_BASE_URL } from './config';

setApiBaseUrl(API_BASE_URL);

if (__DEV__) {
  LogBox.ignoreLogs([/findNodeHandle is deprecated/, /findHostInstance_DEPRECATED is deprecated/]);
}

SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function App() {
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => undefined);
  }, []);

  return <AppNavigator />;
}
