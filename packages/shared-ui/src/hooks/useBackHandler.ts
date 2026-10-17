import { useEffect, useRef } from 'react';
import { BackHandler } from 'react-native';
import RemoteControlManager from '../app/remote-control/RemoteControlManager';
import { SupportedKeys } from '../app/remote-control/SupportedKeys';

let lastBackAt = 0;
let trailingBackGuard = false;

// Some platforms report one press both as a key event and as hardwareBackPress.
function claimBackPress(): boolean {
  const now = Date.now();
  if (now - lastBackAt < 250) return false;
  lastBackAt = now;
  return true;
}

// When the key event already navigated away, the screen that handled it is gone by the time
// hardwareBackPress arrives, and an unclaimed press sends the app to the background.
function installTrailingBackGuard(): void {
  if (trailingBackGuard) return;
  trailingBackGuard = true;
  BackHandler.addEventListener('hardwareBackPress', () => Date.now() - lastBackAt < 700);
}

export function useBackHandler(handler: () => void, enabled: boolean): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    installTrailingBackGuard();
    if (!enabled) return;
    const onKey = (key: SupportedKeys) => {
      if (key === SupportedKeys.Back && claimBackPress()) handlerRef.current();
    };
    RemoteControlManager.addKeydownListener(onKey);
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (claimBackPress()) handlerRef.current();
      return true;
    });
    return () => {
      RemoteControlManager.removeKeydownListener(onKey);
      subscription.remove();
    };
  }, [enabled]);
}

export function useRemoteKey(handler: (key: SupportedKeys) => void, enabled: boolean): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (key: SupportedKeys) => handlerRef.current(key);
    RemoteControlManager.addKeydownListener(onKey);
    return () => RemoteControlManager.removeKeydownListener(onKey);
  }, [enabled]);
}
