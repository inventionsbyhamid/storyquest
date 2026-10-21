import { execFile } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { nightFromPixels } from './tone';

export class MediaCommandError extends Error {
  override name = 'MediaCommandError';
}

function run(command: string, args: string[], timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024, encoding: 'buffer' },
      (error, stdout, stderr) => {
        if (error) {
          const reason = error.killed
            ? `timed out after ${timeoutMs} ms`
            : stderr.toString().trim().split('\n').slice(-3).join(' | ');
          reject(new MediaCommandError(`${command} failed: ${reason || error.message}`));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

export async function runCommand(command: string, args: string[], timeoutMs: number): Promise<string> {
  return (await run(command, args, timeoutMs)).toString();
}

const FFMPEG = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y'];

export class Media {
  constructor(private readonly timeoutMs = 60_000) {}

  ffmpeg(args: string[], timeoutMs = this.timeoutMs): Promise<string> {
    return runCommand('ffmpeg', [...FFMPEG, ...args], timeoutMs);
  }

  /** Moves the index to the front so playback can start before the whole file arrives. */
  async faststart(input: string, output: string): Promise<void> {
    await this.ffmpeg(['-i', input, '-map', '0', '-c', 'copy', '-movflags', '+faststart', output]);
  }

  /**
   * The playback copy of a scene: H.264 High at about 5 Mbps instead of the
   * provider's 11 Mbps Baseline, a third of the size for the same picture, so
   * TVs download the next scenes sooner. The sound is copied as it is.
   */
  async encodeClip(input: string, output: string): Promise<void> {
    await this.ffmpeg(
      [
        '-i', input,
        '-map', '0:v:0', '-map', '0:a?',
        '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.1', '-preset', 'medium', '-crf', '20',
        '-maxrate', '6M', '-bufsize', '12M', '-g', '48', '-pix_fmt', 'yuv420p',
        '-c:a', 'copy',
        '-movflags', '+faststart',
        output,
      ],
      5 * 60_000,
    );
  }

  /** What has to match for clips to be joined without re-encoding. */
  async streamSignature(file: string): Promise<string> {
    return runCommand(
      'ffprobe',
      [
        '-v', 'error',
        '-show_entries', 'stream=codec_name,profile,width,height,pix_fmt,sample_rate,channels',
        '-of', 'csv=p=0',
        file,
      ],
      15_000,
    );
  }

  async probeDurationMs(file: string): Promise<number> {
    const out = await runCommand(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file],
      15_000,
    );
    const seconds = Number.parseFloat(out.trim());
    if (!Number.isFinite(seconds) || seconds <= 0) throw new MediaCommandError(`could not read duration of ${file}`);
    return Math.round(seconds * 1000);
  }

  async poster(input: string, output: string, atSeconds: number): Promise<void> {
    await this.ffmpeg([
      '-ss', atSeconds.toFixed(3),
      '-i', input,
      '-frames:v', '1',
      '-vf', 'scale=640:-2',
      '-q:v', '4',
      output,
    ]);
  }

  /**
   * The true final frame: decode the last half second and keep overwriting the
   * same image, so whatever frame comes last wins.
   */
  async lastFrame(input: string, output: string): Promise<void> {
    await this.ffmpeg(['-sseof', '-0.5', '-i', input, '-an', '-update', '1', '-q:v', '2', output]);
  }

  /** The night color of a picture, or null when it cannot be read. */
  async tone(image: string): Promise<string | null> {
    try {
      const pixels = await run(
        'ffmpeg',
        [...FFMPEG, '-i', image, '-vf', 'scale=48:27:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
        15_000,
      );
      return pixels.length > 0 ? nightFromPixels(pixels) : null;
    } catch {
      return null;
    }
  }

  async stitch(inputs: string[], output: string): Promise<void> {
    const listFile = join(dirname(output), `.concat-${Date.now()}.txt`);
    const list = inputs.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join('\n');
    await writeFile(listFile, `${list}\n`);
    try {
      // A copy join only works when every clip has the same stream parameters; it can
      // succeed on mixed clips and still make a broken file, so check first.
      const signatures = await Promise.all(inputs.map((file) => this.streamSignature(file).catch(() => file)));
      try {
        if (new Set(signatures).size > 1) throw new MediaCommandError('clips differ');
        await this.ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', output]);
      } catch {
        await this.ffmpeg(
          [
            '-f', 'concat', '-safe', '0', '-i', listFile,
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '128k',
            '-movflags', '+faststart',
            output,
          ],
          10 * 60_000,
        );
      }
    } finally {
      await rm(listFile, { force: true });
    }
  }
}
