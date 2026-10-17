import mitt from 'mitt';
import { SupportedKeys } from './SupportedKeys';
import { RemoteControlManagerInterface } from './RemoteControlManager.interface';

const EVENT_TYPE_MAPPING: Record<string, SupportedKeys> = {
  left: SupportedKeys.Left,
  right: SupportedKeys.Right,
  down: SupportedKeys.Down,
  up: SupportedKeys.Up,
  select: SupportedKeys.Enter,
  back: SupportedKeys.Back,
  playpause: SupportedKeys.PlayPause,
  skip_backward: SupportedKeys.Rewind,
  skip_forward: SupportedKeys.FastForward,
};

interface HWEvent {
  eventType: string;
  eventKeyAction?: number;
}

class RemoteControlManager implements RemoteControlManagerInterface {
  private eventEmitter = mitt<{ keyDown: SupportedKeys; keyUp: SupportedKeys }>();
  private tvEventHandler: { enable: (component: unknown, cb: unknown) => void; disable: () => void };

  constructor() {
    // TVEventHandler is not part of the public RN typings on Vega.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { TVEventHandler } = require('react-native');
    this.tvEventHandler = new TVEventHandler();
    this.tvEventHandler.enable(this, this.handleHWEvent);
  }

  private handleHWEvent = (_component: unknown, event: HWEvent): void => {
    // eventKeyAction: 0 is key down, 1 is key up.
    const mappedKey = EVENT_TYPE_MAPPING[event.eventType];
    if (!mappedKey) return;
    if (event.eventKeyAction === 1) this.eventEmitter.emit('keyUp', mappedKey);
    else if (event.eventKeyAction === 0 || event.eventKeyAction === undefined)
      this.eventEmitter.emit('keyDown', mappedKey);
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
    this.tvEventHandler.disable();
  };
}

export default new RemoteControlManager();
