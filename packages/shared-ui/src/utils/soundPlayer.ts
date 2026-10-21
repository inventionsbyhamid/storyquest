export interface SoundPlayer {
  play(name: string): void;
}

// Interface sounds only play on Fire TV; other platforms stay quiet.
export function createSoundPlayer(_sounds: Array<[name: string, url: string]>): SoundPlayer {
  return { play() {} };
}
