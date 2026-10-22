import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Config } from './config';
import { openDatabase, type Db } from './db/database';
import { Repository } from './db/repo';
import { Budget } from './engine/budget';
import { DailyIdeas } from './engine/daily';
import { AdminJobs } from './engine/film';
import { ScriptDesk } from './engine/scripts';
import { FilmingStatus } from './providers/video/filmingStatus';
import { Moderation } from './engine/moderation';
import { StoryEngine } from './engine/engine';
import type { Logger } from './log';
import { Media } from './media';
import { AnthropicChat, createAnthropicClient, createBedrockClient, type Effort } from './providers/director/anthropic';
import { FakeDirector } from './providers/director/fake';
import { LlmDirector } from './providers/director/llm';
import { OpenAiChat } from './providers/director/openai';
import type { ChatModel, Director, DirectorMeter } from './providers/director/types';
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
  budget: Budget;
  jobs: AdminJobs;
  scripts: ScriptDesk;
  filming: FilmingStatus;
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

export function createChatModel(config: Config): ChatModel | null {
  const model = config.directorModel;
  // Low effort keeps Claude quick and cheap; the scenes are short. Config rejects none and minimal for Claude.
  const effort = (config.DIRECTOR_EFFORT ?? 'low') as Effort;
  switch (config.DIRECTOR) {
    case 'bedrock':
      return new AnthropicChat(createBedrockClient(config), 'bedrock', model, effort);
    case 'anthropic':
      return new AnthropicChat(createAnthropicClient(config), 'anthropic', model, effort);
    case 'openrouter': {
      const providers = config.openRouterProviders;
      // OpenRouter passes verbosity to Claude as its effort setting; other models take a reasoning effort.
      const effortField = model.startsWith('anthropic/')
        ? { verbosity: effort }
        : config.DIRECTOR_EFFORT
          ? { reasoning: { effort: config.DIRECTOR_EFFORT } }
          : {};
      return new OpenAiChat({
        provider: 'openrouter',
        model,
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: config.OPENROUTER_API_KEY,
        headers: { 'HTTP-Referer': config.PUBLIC_BASE_URL, 'X-Title': 'StoryQuest' },
        extraBody: {
          ...effortField,
          // Family stories only go to hosts that do not keep or train on them.
          provider: {
            data_collection: 'deny',
            ...(config.OPENROUTER_SORT ? { sort: config.OPENROUTER_SORT } : {}),
            ...(providers.length ? { order: providers, allow_fallbacks: false } : {}),
          },
        },
      });
    }
    case 'openai':
      return new OpenAiChat({
        provider: 'openai',
        model,
        baseUrl: config.OPENAI_BASE_URL,
        apiKey: config.OPENAI_API_KEY,
        // Only reasoning models know this setting, so it is sent only when asked for.
        extraBody: config.DIRECTOR_EFFORT ? { reasoning_effort: config.DIRECTOR_EFFORT } : {},
      });
    default:
      return null;
  }
}

function createDirector(config: Config, log: Logger, meter: DirectorMeter): Director {
  const model = createChatModel(config);
  if (!model) return new FakeDirector(meter);
  log.info({ provider: model.provider, model: model.model }, 'story director');
  return new LlmDirector(model, { sceneSeconds: config.SCENE_SECONDS }, log.child({ module: 'director' }), meter);
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
  const budget = new Budget({ config, repo, log: log.child({ module: 'budget' }), now });
  const director = overrides.director ?? createDirector(config, log, budget);
  const video = overrides.video ?? createVideo(config, media, log);
  const safety = overrides.safety ?? createSafety(config, log);

  const receipts = overrides.receipts !== undefined ? overrides.receipts : createReceiptVerifier(config, log, now);
  const wallet = new Wallet({
    config,
    repo,
    verifier: receipts,
    log: log.child({ module: 'wallet' }),
    now,
    freeFilming: () => budget.exhausted() === null,
  });

  const filming = new FilmingStatus({
    billingKey: config.FAL_BILLING_KEY,
    minBalance: config.FAL_MIN_BALANCE,
    now: () => now().getTime(),
    log: log.child({ module: 'filming' }),
  });
  const engine = new StoryEngine({
    config,
    repo,
    budget,
    filming,
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
  const jobs = new AdminJobs({ repo, engine, budget, log: log.child({ module: 'jobs' }), now });
  const scripts = new ScriptDesk({ config, repo, director, safety });

  return { config, db, repo, store, media, director, video, safety, engine, daily, wallet, moderation, budget, jobs, scripts, filming, now };
}
