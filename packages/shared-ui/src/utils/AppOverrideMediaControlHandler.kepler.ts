import type { IMediaSessionId } from '@amazon-devices/kepler-media-controls';
import { KeplerMediaControlHandler } from '@amazon-devices/react-native-w3cmedia';
import type { MediaCommand } from '../components/player/types';

// Routes Vega Media Controls (remote media keys and "Alexa, pause") into the story state
// instead of letting the player toggle itself behind the app's back.
export class AppOverrideMediaControlHandler extends KeplerMediaControlHandler {
  private readonly onCommand: (command: MediaCommand) => void;

  constructor(onCommand: (command: MediaCommand) => void) {
    super();
    this.onCommand = onCommand;
  }

  async handlePlay(_sessionId?: IMediaSessionId) {
    this.onCommand('play');
  }

  async handlePause(_sessionId?: IMediaSessionId) {
    this.onCommand('pause');
  }

  async handleTogglePlayPause(_sessionId?: IMediaSessionId) {
    this.onCommand('toggle');
  }

  async handleStop(_sessionId?: IMediaSessionId) {
    this.onCommand('pause');
  }

  async handleFastForward(_sessionId?: IMediaSessionId) {}

  async handleRewind(_sessionId?: IMediaSessionId) {}
}
