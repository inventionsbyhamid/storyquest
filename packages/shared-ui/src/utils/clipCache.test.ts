import { afterEach, describe, expect, it } from 'vitest';
import { ClipCache, resetLocalPlaybackForTests } from './clipCache';
import type { ClipFs } from './clipFs';

function fakeFs(status = 200) {
  const downloads: Array<{ url: string; file: string; finish: () => void; fail: () => void }> = [];
  const deleted: string[] = [];
  const fs: ClipFs = {
    cacheDirectory: 'file:///cache',
    makeDirectoryAsync: async () => undefined,
    deleteAsync: async (uri) => {
      deleted.push(uri);
    },
    downloadAsync: (url, file) =>
      new Promise((resolve, reject) => {
        downloads.push({ url, file, finish: () => resolve({ status }), fail: () => reject(new Error('offline')) });
      }),
  };
  return { fs, downloads, deleted };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const quiet = () => undefined;

describe('ClipCache', () => {
  afterEach(() => resetLocalPlaybackForTests());

  it('streams until a download finishes, then plays the local file', async () => {
    const { fs, downloads } = fakeFs();
    const cache = new ClipCache(fs, Date.now, quiet);
    cache.prefetch('https://cdn.test/a.mp4');
    cache.prefetch('https://cdn.test/a.mp4');
    await flush();
    expect(downloads).toHaveLength(1);
    expect(downloads[0].file).toMatch(/^file:\/\/\/cache\/storyquest-clips\/clip_\w+\.mp4$/);
    expect(cache.resolve('https://cdn.test/a.mp4')).toBe('https://cdn.test/a.mp4');

    downloads[0].finish();
    await flush();
    expect(cache.resolve('https://cdn.test/a.mp4')).toBe(downloads[0].file);
    expect(cache.isLocal(downloads[0].file)).toBe(true);
  });

  it('forgets failed downloads and bad responses', async () => {
    const failing = fakeFs();
    const cache = new ClipCache(failing.fs, Date.now, quiet);
    cache.prefetch('https://cdn.test/a.mp4');
    await flush();
    failing.downloads[0].fail();
    await flush();
    expect(cache.size()).toBe(0);

    const notFound = fakeFs(404);
    const other = new ClipCache(notFound.fs, Date.now, quiet);
    other.prefetch('https://cdn.test/b.mp4');
    await flush();
    notFound.downloads[0].finish();
    await flush();
    expect(other.resolve('https://cdn.test/b.mp4')).toBe('https://cdn.test/b.mp4');
    expect(notFound.deleted).toContain(notFound.downloads[0].file);
  });

  it('keeps at most four clips and never evicts the one playing', async () => {
    const { fs, downloads, deleted } = fakeFs();
    let time = 0;
    const cache = new ClipCache(fs, () => ++time, quiet);
    cache.prefetch('https://cdn.test/0.mp4');
    await flush();
    downloads[0].finish();
    await flush();
    cache.resolve('https://cdn.test/0.mp4');
    for (let i = 1; i <= 5; i++) cache.prefetch(`https://cdn.test/${i}.mp4`);
    expect(cache.size()).toBe(4);
    expect(cache.resolve('https://cdn.test/0.mp4')).toBe(downloads[0].file);
    expect(deleted.filter((uri) => uri.endsWith('.mp4'))).toHaveLength(2);
  });

  it('deletes everything when the story is over', async () => {
    const { fs, downloads, deleted } = fakeFs();
    const cache = new ClipCache(fs, Date.now, quiet);
    cache.prefetch('https://cdn.test/a.mp4');
    cache.prefetch('https://cdn.test/b.mp4');
    await flush();
    downloads[0].finish();
    await flush();
    await cache.clear();
    expect(deleted).toEqual(expect.arrayContaining([downloads[0].file, downloads[1].file]));
    expect(cache.enabled).toBe(false);

    downloads[1].finish();
    await flush();
    expect(cache.resolve('https://cdn.test/b.mp4')).toBe('https://cdn.test/b.mp4');
  });

  it('stops using local files once the player rejects one', async () => {
    const { fs, downloads } = fakeFs();
    const cache = new ClipCache(fs, Date.now, quiet);
    cache.prefetch('https://cdn.test/a.mp4');
    await flush();
    downloads[0].finish();
    await flush();
    cache.disableLocalPlayback();
    expect(cache.resolve('https://cdn.test/a.mp4')).toBe('https://cdn.test/a.mp4');
    const next = new ClipCache(fs, Date.now, quiet);
    expect(next.enabled).toBe(false);
  });

  it('does nothing without a file system', () => {
    const cache = new ClipCache(null);
    cache.prefetch('https://cdn.test/a.mp4');
    expect(cache.size()).toBe(0);
    expect(cache.resolve('https://cdn.test/a.mp4')).toBe('https://cdn.test/a.mp4');
  });
});
