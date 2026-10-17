import { Directions, SpatialNavigation } from 'react-tv-space-navigation';
import { SupportedKeys } from './remote-control/SupportedKeys';
import RemoteControlManager from './remote-control/RemoteControlManager';

const mapping: Record<SupportedKeys, Directions | null> = {
  [SupportedKeys.Right]: Directions.RIGHT,
  [SupportedKeys.Left]: Directions.LEFT,
  [SupportedKeys.Up]: Directions.UP,
  [SupportedKeys.Down]: Directions.DOWN,
  [SupportedKeys.Enter]: Directions.ENTER,
  [SupportedKeys.Back]: null,
  [SupportedKeys.PlayPause]: null,
  [SupportedKeys.FastForward]: null,
  [SupportedKeys.Rewind]: null,
};

SpatialNavigation.configureRemoteControl({
  remoteControlSubscriber: (callback) => {
    const listener = (key: SupportedKeys) => callback(mapping[key]);
    return RemoteControlManager.addKeydownListener(listener);
  },
  remoteControlUnsubscriber: (listener) => {
    RemoteControlManager.removeKeydownListener(listener);
  },
});
