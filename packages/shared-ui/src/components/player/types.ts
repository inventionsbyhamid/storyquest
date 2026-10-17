import type { StyleProp, ViewStyle } from 'react-native';

export type MediaCommand = 'play' | 'pause' | 'toggle';

export interface ClipPlayerProps {
  source: string | null;
  paused: boolean;
  style?: StyleProp<ViewStyle>;
  onReady?: (source: string) => void;
  onPlaying?: (source: string) => void;
  onEnded?: (source: string) => void;
  onError?: (source: string, message: string) => void;
  onProgress?: (seconds: number, duration: number) => void;
  onMediaCommand?: (command: MediaCommand) => void;
}
