import { resolveMediaUrl } from '../api/media';
import RemoteControlManager from '../app/remote-control/RemoteControlManager';
import { SupportedKeys } from '../app/remote-control/SupportedKeys';
import { createSoundPlayer, type SoundPlayer } from './soundPlayer';

export type UiSound = 'move' | 'select' | 'choices' | 'tick';

const SOUNDS: UiSound[] = ['move', 'select', 'choices', 'tick'];
const ARROWS = new Set([SupportedKeys.Up, SupportedKeys.Down, SupportedKeys.Left, SupportedKeys.Right]);
// Focus clicks only when an arrow press moved it, not when a screen sets its first focus.
const ARROW_WINDOW_MS = 400;

let player: SoundPlayer | null = null;
let lastArrowAt = 0;

export function startUiSounds(): void {
  if (player) return;
  player = createSoundPlayer(SOUNDS.map((name) => [name, resolveMediaUrl(`/static/sounds/${name}.m4a`)!]));
  RemoteControlManager.addKeydownListener((key) => {
    if (ARROWS.has(key)) lastArrowAt = Date.now();
  });
}

export function playUiSound(sound: UiSound): void {
  player?.play(sound);
}

export function playFocusSound(): void {
  if (Date.now() - lastArrowAt < ARROW_WINDOW_MS) playUiSound('move');
}
