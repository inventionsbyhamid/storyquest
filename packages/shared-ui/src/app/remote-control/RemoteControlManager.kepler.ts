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
  private eventEmitter = mitt<{ keyDown: SupportedKeys }>();
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
    if (event.eventKeyAction !== 0 && event.eventKeyAction !== undefined) return;
    const mappedKey = EVENT_TYPE_MAPPING[event.eventType];
    if (mappedKey) this.eventEmitter.emit('keyDown', mappedKey);
  };

  addKeydownListener = (listener: (event: SupportedKeys) => void) => {
    this.eventEmitter.on('keyDown', listener);
    return listener;
  };

  removeKeydownListener = (listener: (event: SupportedKeys) => void): void => {
    this.eventEmitter.off('keyDown', listener);
  };

  emitKeyDown = (key: SupportedKeys): void => {
    this.eventEmitter.emit('keyDown', key);
  };

  cleanup = (): void => {
    this.tvEventHandler.disable();
  };
}

export default new RemoteControlManager();
