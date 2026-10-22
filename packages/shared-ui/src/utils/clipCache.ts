import type { ClipFs } from './clipFs';
import { loadClipFs } from './clipFs';
import { warmClip } from './warmClip';

const MAX_CLIPS = 4;
const DIR_NAME = 'storyquest-clips/';

interface Entry {
  file: string;
  ready: boolean;
  usedAt: number;
}

let localPlaybackBroken = false;
const noop = () => undefined;

function fileNameFor(url: string): string {
  let hash = 5381;
  for (let i = 0; i < url.length; i++) hash = ((hash << 5) + hash + url.charCodeAt(i)) | 0;
  return `clip_${(hash >>> 0).toString(36)}.mp4`;
}

// Downloads upcoming clips to the device so the next scene starts from local storage.
// Best effort: anything that goes wrong leaves the clip streaming from the network.
export class ClipCache {
  private entries = new Map<string, Entry>();
  private dirReady: Promise<void> | null = null;
  private disposed = false;
  private inUse: string | null = null;

  constructor(
    private readonly fs: ClipFs | null,
    private readonly now: () => number = Date.now,
    private readonly log: (message: string) => void = (message) => console.info(message),
  ) {}

  get enabled(): boolean {
    return !!this.fs && !!this.fs.cacheDirectory && !localPlaybackBroken && !this.disposed;
  }

  prefetch(url: string | null | undefined): void {
    if (!url || !/^https?:\/\//i.test(url)) return;
    if (!this.enabled) {
      warmClip(url);
      return;
    }
    if (this.entries.has(url)) return;
    const fs = this.fs!;
    const file = `${this.directory()}${fileNameFor(url)}`;
    const entry: Entry = { file, ready: false, usedAt: this.now() };
    this.entries.set(url, entry);
    this.evict();

    const startedAt = this.now();
    this.ensureDirectory()
      .then(() => fs.downloadAsync(url, file, {}))
      .then((result) => {
        const current = this.entries.get(url) === entry && !this.disposed;
        if (current && result.status >= 200 && result.status < 300) {
          entry.ready = true;
          this.log(`[Timing] clip cached in ${this.now() - startedAt}ms ${file}`);
          return;
        }
        if (this.entries.get(url) === entry) this.entries.delete(url);
        fs.deleteAsync(file, { idempotent: true }).catch(noop);
      })
      .catch((error) => {
        if (this.entries.get(url) === entry) this.entries.delete(url);
        this.log(`[Timing] clip download failed ${String(error)}`);
      });
  }

  resolve(url: string): string {
    const entry = this.entries.get(url);
    if (!entry || !entry.ready || !this.enabled) return url;
    entry.usedAt = this.now();
    this.inUse = url;
    return entry.file;
  }

  isLocal(source: string): boolean {
    return source.startsWith('file:') || [...this.entries.values()].some((entry) => entry.file === source);
  }

  // The player could not open a local file: stream everything from now on.
  disableLocalPlayback(): void {
    localPlaybackBroken = true;
  }

  async clear(): Promise<void> {
    this.disposed = true;
    const fs = this.fs;
    const files = [...this.entries.values()].map((entry) => entry.file);
    this.entries.clear();
    if (!fs) return;
    await Promise.all(files.map((file) => fs.deleteAsync(file, { idempotent: true }).catch(noop)));
  }

  size(): number {
    return this.entries.size;
  }

  private directory(): string {
    const base = this.fs?.cacheDirectory ?? '';
    return `${base.endsWith('/') ? base : `${base}/`}${DIR_NAME}`;
  }

  private ensureDirectory(): Promise<void> {
    if (!this.dirReady) {
      const fs = this.fs!;
      const dir = this.directory();
      // Clears clips left behind if the app was closed mid story.
      this.dirReady = fs
        .deleteAsync(dir, { idempotent: true })
        .catch(noop)
        .then(() => fs.makeDirectoryAsync(dir, { intermediates: true }));
    }
    return this.dirReady;
  }

  private evict(): void {
    while (this.entries.size > MAX_CLIPS) {
      let oldest: [string, Entry] | null = null;
      for (const pair of this.entries) {
        if (pair[0] === this.inUse) continue;
        if (!oldest || pair[1].usedAt < oldest[1].usedAt) oldest = pair;
      }
      if (!oldest) return;
      this.entries.delete(oldest[0]);
      this.fs?.deleteAsync(oldest[1].file, { idempotent: true }).catch(noop);
    }
  }
}

export function createClipCache(): ClipCache {
  return new ClipCache(loadClipFs());
}

export function resetLocalPlaybackForTests(): void {
  localPlaybackBroken = false;
}
