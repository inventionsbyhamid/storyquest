export interface SoundPlayer {
  play(name: string): void;
}

const VOLUME = 0.7;

interface WebAudio {
  preload: string;
  volume: number;
  currentTime: number;
  play(): Promise<void>;
}

// With a mouse, hovering moves focus too, so the move tick only plays for keyboard navigation.
let pointer = false;
const page = globalThis as unknown as { addEventListener?: (type: string, listener: () => void) => void };
page.addEventListener?.('mousemove', () => {
  pointer = true;
});
page.addEventListener?.('keydown', () => {
  pointer = false;
});

// The same quiet interface sounds as on Fire TV, through plain browser audio.
export function createSoundPlayer(sounds: Array<[name: string, url: string]>): SoundPlayer {
  const AudioElement = (globalThis as unknown as { Audio?: new (url: string) => WebAudio }).Audio;
  const players = new Map<string, WebAudio>();
  if (AudioElement) {
    for (const [name, url] of sounds) {
      const audio = new AudioElement(url);
      audio.preload = 'auto';
      audio.volume = VOLUME;
      players.set(name, audio);
    }
  }
  return {
    play(name) {
      const audio = players.get(name);
      if (!audio || (name === 'move' && pointer)) return;
      audio.currentTime = 0;
      // Browsers refuse sound until the visitor has pressed a key or clicked once.
      audio.play().catch(() => undefined);
    },
  };
}
