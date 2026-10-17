import mitt from 'mitt';
import { EventSubscription, HWEvent, TVEventHandler } from 'react-native';
import { SupportedKeys } from './SupportedKeys';
import { RemoteControlManagerInterface } from './RemoteControlManager.interface';

const KEY_MAPPING: Record<string, SupportedKeys> = {
  right: SupportedKeys.Right,
  left: SupportedKeys.Left,
  up: SupportedKeys.Up,
  down: SupportedKeys.Down,
  select: SupportedKeys.Enter,
  swipeLeft: SupportedKeys.Left,
  swipeRight: SupportedKeys.Right,
  swipeUp: SupportedKeys.Up,
  swipeDown: SupportedKeys.Down,
};

class RemoteControlManager implements RemoteControlManagerInterface {
  private eventEmitter = mitt<{ keyDown: SupportedKeys; keyUp: SupportedKeys }>();
  private tvEventSubscription?: EventSubscription;

  constructor() {
    this.tvEventSubscription = TVEventHandler.addListener(this.handleKeyDown);
  }

  private handleKeyDown = (evt: HWEvent): void => {
    if (!evt) return;

    const mappedKey = KEY_MAPPING[evt.eventType];
    if (!mappedKey) return;
    this.eventEmitter.emit('keyDown', mappedKey);
    if (evt.eventKeyAction === 1) this.eventEmitter.emit('keyUp', mappedKey);
  };

  addKeydownListener = (listener: (event: SupportedKeys) => void) => {
    this.eventEmitter.on('keyDown', listener);
    return listener;
  };

  removeKeydownListener = (listener: (event: SupportedKeys) => void): void => {
    this.eventEmitter.off('keyDown', listener);
  };

  addKeyupListener = (listener: (event: SupportedKeys) => void) => {
    this.eventEmitter.on('keyUp', listener);
    return listener;
  };

  removeKeyupListener = (listener: (event: SupportedKeys) => void): void => {
    this.eventEmitter.off('keyUp', listener);
  };

  emitKeyDown = (key: SupportedKeys): void => {
    this.eventEmitter.emit('keyDown', key);
  };

  cleanup = (): void => {
    this.tvEventSubscription?.remove();
  };
}

export default new RemoteControlManager();
