import { SupportedKeys } from './SupportedKeys';

export type KeydownListener = (event: SupportedKeys) => void;

export interface RemoteControlManagerInterface {
  addKeydownListener(listener: KeydownListener): KeydownListener;
  removeKeydownListener(listener: KeydownListener): void;
  addKeyupListener(listener: KeydownListener): KeydownListener;
  removeKeyupListener(listener: KeydownListener): void;
  emitKeyDown(key: SupportedKeys): void;
}
