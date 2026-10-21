import { AudioContentType, AudioPlayer, AudioUsageType } from '@amazon-devices/react-native-w3cmedia';
import type { SoundPlayer } from './soundPlayer';

const VOLUME = 0.7;

// One small audio player per sound, loaded once. They never take media control focus,
// so the remote's play and pause keys stay with the story clip.
export function createSoundPlayer(sounds: Array<[name: string, url: string]>): SoundPlayer {
  const players = new Map<string, AudioPlayer>();
  for (const [name, url] of sounds) {
    const player = new AudioPlayer(AudioContentType.CONTENT_TYPE_SONIFICATION, AudioUsageType.USAGE_GAME);
    player
      .initialize()
      .then(() => {
        player.autoplay = false;
        player.volume = VOLUME;
        player.src = url;
        players.set(name, player);
      })
      .catch((error) => console.warn('[UiSounds] could not prepare', name, error));
  }
  return {
    play(name) {
      const player = players.get(name);
      if (!player) return;
      try {
        player.currentTime = 0;
        void player.play();
      } catch (error) {
        console.warn('[UiSounds] could not play', name, error);
      }
    },
  };
}
