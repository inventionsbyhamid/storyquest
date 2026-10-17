import mitt from 'mitt';
import { Platform } from 'react-native';
import { SupportedKeys } from './SupportedKeys';
import { RemoteControlManagerInterface } from './RemoteControlManager.interface';

const KEY_MAPPING: Record<string, SupportedKeys> = {
  ArrowRight: SupportedKeys.Right,
  ArrowLeft: SupportedKeys.Left,
  ArrowUp: SupportedKeys.Up,
  ArrowDown: SupportedKeys.Down,
  Enter: SupportedKeys.Enter,
  Backspace: SupportedKeys.Back,
  Escape: SupportedKeys.Back,
  GoBack: SupportedKeys.Back,
  MediaPlayPause: SupportedKeys.PlayPause,
  Space: SupportedKeys.PlayPause,
};

interface WebKeyboardEvent {
  code: string;
  key: string;
  target: unknown;
}

function isEditable(target: unknown): boolean {
  const element = target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!element) return false;
  return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable === true;
}

class RemoteControlManager implements RemoteControlManagerInterface {
  private eventEmitter = mitt<{ keyDown: SupportedKeys; keyUp: SupportedKeys }>();

  constructor() {
    if (Platform.OS === 'web') {
      (
        globalThis as unknown as { addEventListener: (type: string, cb: (e: WebKeyboardEvent) => void) => void }
      ).addEventListener('keydown', this.handleKeyDown);
      (
        globalThis as unknown as { addEventListener: (type: string, cb: (e: WebKeyboardEvent) => void) => void }
      ).addEventListener('keyup', this.handleKeyUp);
    }
  }

  private handleKeyDown = (event: WebKeyboardEvent): void => {
    if (isEditable(event.target)) return;
    const mappedKey = KEY_MAPPING[event.code] || KEY_MAPPING[event.key];
    if (mappedKey) this.eventEmitter.emit('keyDown', mappedKey);
  };

  private handleKeyUp = (event: WebKeyboardEvent): void => {
    if (isEditable(event.target)) return;
    const mappedKey = KEY_MAPPING[event.code] || KEY_MAPPING[event.key];
    if (mappedKey) this.eventEmitter.emit('keyUp', mappedKey);
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
}

export default new RemoteControlManager();
