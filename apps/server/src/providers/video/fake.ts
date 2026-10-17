import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Media } from '../../media';
import { hashString } from '../director/fake';
import type { RenderRequest, RenderResult, VideoProvider } from './types';

export interface FakeVideoOptions {
  width: number;
  height: number;
  delayMs: number;
  fontFile: string;
}

const FPS = 24;

function hsl(hue: number, saturation: number, lightness: number): string {
  const a = saturation * Math.min(lightness, 1 - lightness);
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    const value = lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `0x${channel(0)}${channel(8)}${channel(4)}`;
}

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
 * Renders a stand in clip with ffmpeg: a soft gradient for opening scenes, or
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
    const textFile = `${request.outPath}.txt`;
    await writeFile(textFile, wrap(request.caption || request.prompt, 46, 2));

    const font = existsSync(this.options.fontFile) ? `fontfile=${escapeFilterValue(this.options.fontFile)}:` : '';
    const showText = `enable='between(t,0.4,${Math.max(0.5, seconds - 0.6).toFixed(2)})'`;
    const px = (fraction: number) => Math.max(1, Math.round(height * fraction));
    const overlay = [
      `drawtext=${font}textfile=${escapeFilterValue(textFile)}:fontcolor=white:fontsize=${px(1 / 18)}:line_spacing=${px(1 / 90)}:box=1:boxcolor=black@0.35:boxborderw=${px(1 / 40)}:x=(w-text_w)/2:y=h-text_h-h/10:${showText}`,
      `drawtext=${font}text=preview:fontcolor=white@0.85:fontsize=${px(1 / 30)}:box=1:boxcolor=black@0.4:boxborderw=${px(1 / 90)}:x=w-text_w-${px(1 / 30)}:y=${px(1 / 30)}:${showText}`,
    ].join(',');

    const inputs: string[] = [];
    let video: string;
    if (request.startFramePath) {
      inputs.push('-loop', '1', '-framerate', String(FPS), '-t', String(seconds), '-i', request.startFramePath);
      const hueDrift = seed % 2 === 0 ? 4 : -4;
      video =
        `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},` +
        `zoompan=z='1+0.0008*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=${FPS},` +
        `hue=h='t*${hueDrift}',format=yuv420p,${overlay}[v]`;
    } else {
      const hue = seed % 360;
      const c0 = hsl(hue, 0.55, 0.32);
      const c1 = hsl((hue + 70) % 360, 0.65, 0.62);
      const small = `${Math.max(16, Math.round(width / 8))}x${Math.max(16, Math.round(height / 8))}`;
      inputs.push('-f', 'lavfi', '-i', `gradients=s=${small}:r=${FPS}:d=${seconds}:c0=${c0}:c1=${c1}:nb_colors=2:speed=0.02:seed=${seed % 100000}`);
      video = `[0:v]scale=${width}:${height}:flags=bilinear,format=yuv420p,${overlay}[v]`;
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
    } finally {
      await rm(textFile, { force: true });
    }

    if (this.options.delayMs > 0) await sleep(this.options.delayMs);
    return { billedSeconds: seconds, inferenceMs: null };
  }
}
