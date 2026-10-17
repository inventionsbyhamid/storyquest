import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Config } from './config';
import { openDatabase, type Db } from './db/database';
import { Repository } from './db/repo';
import { DailyIdeas } from './engine/daily';
import { Moderation } from './engine/moderation';
import { StoryEngine } from './engine/engine';
import type { Logger } from './log';
import { Media } from './media';
import { BedrockDirector, createBedrockClient } from './providers/director/bedrock';
import { FakeDirector } from './providers/director/fake';
import type { Director } from './providers/director/types';
import { GuardrailsSafety } from './providers/safety/guardrails';
import type { SafetyChecker } from './providers/safety/types';
import { WordlistSafety } from './providers/safety/wordlist';
import { FakeVideo } from './providers/video/fake';
import { FalVideo } from './providers/video/fal';
import type { VideoProvider } from './providers/video/types';
import { MediaStore } from './storage';
import { AmazonReceiptVerifier, FakeReceiptVerifier, type ReceiptVerifier } from './wallet/receipts';
import { Wallet } from './wallet/wallet';

export interface Services {
  config: Config;
  db: Db;
  repo: Repository;
  store: MediaStore;
  media: Media;
  director: Director;
  video: VideoProvider;
  safety: SafetyChecker;
  engine: StoryEngine;
  daily: DailyIdeas;
  wallet: Wallet;
  moderation: Moderation;
  now: () => Date;
}

export interface ServiceOverrides {
  director?: Director;
  video?: VideoProvider;
  safety?: SafetyChecker;
  receipts?: ReceiptVerifier | null;
  now?: () => Date;
  databaseFile?: string;
}

function createDirector(config: Config, log: Logger): Director {
  if (config.DIRECTOR === 'bedrock') {
    return new BedrockDirector(
      createBedrockClient(config),
      { model: config.BEDROCK_MODEL, effort: config.BEDROCK_EFFORT, sceneSeconds: config.SCENE_SECONDS },
      log.child({ module: 'director' }),
    );
  }
  return new FakeDirector();
}

function createVideo(config: Config, media: Media, log: Logger): VideoProvider {
  if (config.VIDEO === 'fal') {
    return new FalVideo(
      {
        key: config.FAL_KEY!,
        textToVideoModel: config.FAL_MODEL_T2V,
        imageToVideoModel: config.FAL_MODEL_I2V,
        resolution: config.VIDEO_RESOLUTION,
        promptExpansion: config.PROMPT_EXPANSION,
      },
      log.child({ module: 'video' }),
    );
  }
  return new FakeVideo(media, {
    width: config.fakeVideoWidth,
    height: config.fakeVideoHeight,
    delayMs: config.FAKE_VIDEO_DELAY_MS,
    fontFile: config.FONT_FILE,
  });
}

function createSafety(config: Config, log: Logger): SafetyChecker {
  const wordlist = new WordlistSafety();
  if (config.SAFETY === 'guardrails') {
    return new GuardrailsSafety(
      {
        region: config.AWS_REGION,
        guardrailId: config.GUARDRAIL_ID!,
        guardrailVersion: config.GUARDRAIL_VERSION,
        bearerToken: config.bedrockToken,
      },
      wordlist,
      log.child({ module: 'safety' }),
    );
  }
  return wordlist;
}

function createReceiptVerifier(config: Config, log: Logger, now: () => Date): ReceiptVerifier | null {
  if (config.IAP_MODE === 'fake') return new FakeReceiptVerifier(now);
  if (!config.AMAZON_IAP_SHARED_SECRET) {
    log.warn({ mode: config.IAP_MODE }, 'AMAZON_IAP_SHARED_SECRET is not set, so purchases are turned off');
    return null;
  }
  return new AmazonReceiptVerifier(
    { mode: config.IAP_MODE, sharedSecret: config.AMAZON_IAP_SHARED_SECRET },
    log.child({ module: 'receipts' }),
  );
}

export function createServices(config: Config, log: Logger, overrides: ServiceOverrides = {}): Services {
  const dataDir = resolve(config.DATA_DIR);
  mkdirSync(dataDir, { recursive: true });
  const now = overrides.now ?? (() => new Date());
  const db = openDatabase(overrides.databaseFile ?? join(dataDir, 'storyquest.db'));
  const repo = new Repository(db, now);
  const store = new MediaStore(join(dataDir, 'media'), config.PUBLIC_BASE_URL);
  const media = new Media();
  const director = overrides.director ?? createDirector(config, log);
  const video = overrides.video ?? createVideo(config, media, log);
  const safety = overrides.safety ?? createSafety(config, log);

  const receipts = overrides.receipts !== undefined ? overrides.receipts : createReceiptVerifier(config, log, now);
  const wallet = new Wallet({ config, repo, verifier: receipts, log: log.child({ module: 'wallet' }), now });

  const engine = new StoryEngine({
    config,
    repo,
    director,
    video,
    safety,
    media,
    store,
    log: log.child({ module: 'engine' }),
    now,
    wallet,
  });
  const daily = new DailyIdeas({ config, repo, director, safety, engine, log: log.child({ module: 'daily' }), now });

  const moderation = new Moderation({ repo, store, log: log.child({ module: 'moderation' }) });

  return { config, db, repo, store, media, director, video, safety, engine, daily, wallet, moderation, now };
}
