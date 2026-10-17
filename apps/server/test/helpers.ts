import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, type Config } from '../src/config';
import { silentLogger } from '../src/log';
import { Media } from '../src/media';
import { FakeVideo } from '../src/providers/video/fake';
import type { RenderRequest, RenderResult, VideoProvider } from '../src/providers/video/types';
import { createServices, type ServiceOverrides, type Services } from '../src/services';

export function testConfig(dataDir: string, env: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    DATA_DIR: dataDir,
    LOG_LEVEL: 'silent',
    PUBLIC_BASE_URL: 'http://tv.test',
    SCENE_SECONDS: '1',
    FAKE_VIDEO_DELAY_MS: '0',
    FAKE_VIDEO_SIZE: '192x108',
    SCENES_PER_STORY: '6',
    DAILY_IDEAS: '2',
    WARM_DEPTH: '1',
    MAX_PARALLEL_JOBS: '4',
    ...env,
  });
}

/** Wraps the ffmpeg fake so tests can count renders or make them fail. */
export class SpyVideo implements VideoProvider {
  readonly name = 'spy';
  readonly calls: RenderRequest[] = [];
  failWith: Error | null = null;

  constructor(private readonly inner: VideoProvider) {}

  async render(request: RenderRequest): Promise<RenderResult> {
    this.calls.push(request);
    if (this.failWith) throw this.failWith;
    return this.inner.render(request);
  }
}

export interface TestRig {
  dir: string;
  config: Config;
  services: Services;
  video: SpyVideo;
  close(): Promise<void>;
}

export function createRig(env: Record<string, string> = {}, overrides: ServiceOverrides = {}): TestRig {
  const dir = mkdtempSync(join(tmpdir(), 'storyquest-test-'));
  const config = testConfig(dir, env);
  const video = new SpyVideo(
    new FakeVideo(new Media(), {
      width: config.fakeVideoWidth,
      height: config.fakeVideoHeight,
      delayMs: 0,
      fontFile: config.FONT_FILE,
    }),
  );
  const services = createServices(config, silentLogger, { video, ...overrides });
  return {
    dir,
    config,
    services,
    video,
    async close() {
      await services.engine.stop(15_000);
      services.db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const DEVICE = 'device_test_0001';
export const OTHER_DEVICE = 'device_test_0002';

export function visibleText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ');
}
