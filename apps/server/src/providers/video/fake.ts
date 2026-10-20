import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Media } from '../../media';
import { hashString } from '../director/fake';
import { VideoNotBilled, type RenderRequest, type RenderResult, type VideoProvider } from './types';

export interface FakeVideoOptions {
  width: number;
  height: number;
  delayMs: number;
  fontFile: string;
}

const FPS = 24;

// Flat printed inks, a sky and a ground per scene, so stand in clips have real color to pick up.
const TONES: Array<[string, string]> = [
  ['0x1F5A63', '0x163F45'],
  ['0x5B2D52', '0x3F1F39'],
  ['0x2E5A3A', '0x1F3F28'],
  ['0x7A3A22', '0x552817'],
  ['0x7D6420', '0x574616'],
  ['0x2B3A7A', '0x1E2955'],
];

function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:').replace(/,/g, '\\,');
}

function wrap(text: string, width: number, maxLines: number): string {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines).join('\n');
}

/**
 * Renders a stand in clip with ffmpeg: a flat ink frame for opening scenes, or
 * a slow push in on the previous last frame so chained scenes look continuous.
 * The caption only shows mid clip, which keeps the first and last frames clean.
 */
export class FakeVideo implements VideoProvider {
  readonly name = 'fake';

  constructor(
    private readonly media: Media,
    private readonly options: FakeVideoOptions,
  ) {}

  async render(request: RenderRequest): Promise<RenderResult> {
    const { width, height } = this.options;
    const seconds = request.seconds;
    const seed = hashString(request.prompt);
    const [sky, ground] = TONES[seed % TONES.length]!;
    const textFile = `${request.outPath}.txt`;
    await writeFile(textFile, wrap(request.caption || request.prompt, 46, 2));

    const font = existsSync(this.options.fontFile) ? `fontfile=${escapeFilterValue(this.options.fontFile)}:` : '';
    const showText = `enable='between(t,0.4,${Math.max(0.5, seconds - 0.6).toFixed(2)})'`;
    const px = (fraction: number) => Math.max(1, Math.round(height * fraction));
    const overlay = [
      `drawbox=x=0:y=0:w=iw:h=ih:color=${sky}@1:t=fill:enable='gte(t,0.4)'`,
      `drawbox=x=0:y=ih*0.72:w=iw:h=ih*0.28:color=${ground}@1:t=fill:enable='gte(t,0.4)'`,
      `drawtext=${font}textfile=${escapeFilterValue(textFile)}:fontcolor=0xF1E6CF:fontsize=${px(1 / 14)}:line_spacing=${px(1 / 60)}:x=(w-text_w)/2:y=(h-text_h)/2:${showText}`,
      `drawtext=${font}text=Preview scene:fontcolor=0xB6AE9C:fontsize=${px(1 / 32)}:x=w-text_w-${px(1 / 20)}:y=h-text_h-${px(1 / 20)}:${showText}`,
    ].join(',');

    const inputs: string[] = [];
    let video: string;
    if (request.startFramePath) {
      inputs.push('-loop', '1', '-framerate', String(FPS), '-t', String(seconds), '-i', request.startFramePath);
      video =
        `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},` +
        `zoompan=z='1+0.0008*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=${FPS},` +
        `format=yuv420p,${overlay}[v]`;
    } else {
      inputs.push('-f', 'lavfi', '-i', `color=c=${sky}:s=${width}x${height}:r=${FPS}:d=${seconds}`);
      video = `[0:v]format=yuv420p,${overlay}[v]`;
    }
    inputs.push(
      '-f', 'lavfi', '-i', `anoisesrc=d=${seconds}:c=pink:a=0.05:r=48000`,
      '-f', 'lavfi', '-i', `sine=frequency=${[196, 220, 247, 262][seed % 4]}:duration=${seconds}:sample_rate=48000`,
    );
    const audio = '[1:a]lowpass=f=700,volume=0.6[n];[2:a]volume=0.05[s];[n][s]amix=inputs=2:duration=first,aformat=channel_layouts=stereo[a]';

    try {
      await this.media.ffmpeg([
        ...inputs,
        '-filter_complex', `${video};${audio}`,
        '-map', '[v]', '-map', '[a]',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-pix_fmt', 'yuv420p', '-g', String(FPS * 2),
        '-c:a', 'aac', '-b:a', '96k', '-ar', '48000',
        '-movflags', '+faststart',
        '-t', String(seconds),
        request.outPath,
      ]);
    } catch (err) {
      throw new VideoNotBilled((err as Error).message);
    } finally {
      await rm(textFile, { force: true });
    }

    if (this.options.delayMs > 0) await sleep(this.options.delayMs);
    return { billedSeconds: seconds, inferenceMs: null };
  }
}
