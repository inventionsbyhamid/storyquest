import { z } from 'zod';

export const Audience = z.enum(['kids', 'family', 'grownups']);
export type Audience = z.infer<typeof Audience>;

export const Mood = z.enum(['funny', 'adventure', 'cozy', 'mystery', 'spooky']);
export type Mood = z.infer<typeof Mood>;

/** A dark color picked from a picture, used behind text on the TV. */
export const Tone = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
export type Tone = z.infer<typeof Tone>;

export const NodeStatus = z.enum(['pending', 'generating', 'ready', 'failed']);
export type NodeStatus = z.infer<typeof NodeStatus>;

export const ChoiceView = z.object({
  index: z.number().int().min(0).max(1),
  label: z.string(),
  nodeId: z.string().nullable(),
  ready: z.boolean(),
  posterUrl: z.string().nullable(),
  tone: Tone.nullable().optional(),
  sparks: z.number().int().min(0),
});
export type ChoiceView = z.infer<typeof ChoiceView>;

export const SceneView = z.object({
  id: z.string(),
  treeId: z.string(),
  depth: z.number().int(),
  sceneNumber: z.number().int(),
  totalScenes: z.number().int(),
  status: NodeStatus,
  caption: z.string().nullable(),
  clipUrl: z.string().nullable(),
  posterUrl: z.string().nullable(),
  lastFrameUrl: z.string().nullable(),
  /** Night colors of the poster and of the last frame. */
  tone: Tone.nullable().optional(),
  endTone: Tone.nullable().optional(),
  durationMs: z.number().nullable(),
  isEnding: z.boolean(),
  /** True for a clip in the middle of a chapter: the next clip follows on its own, with no choice. */
  continues: z.boolean().optional(),
  choices: z.array(ChoiceView),
  generationMs: z.number().nullable(),
  error: z.string().nullable(),
});
export type SceneView = z.infer<typeof SceneView>;

export const IdeaView = z.object({
  id: z.string(),
  date: z.string(),
  title: z.string(),
  logline: z.string(),
  audience: Audience,
  moods: z.array(Mood),
  posterUrl: z.string().nullable(),
  tone: Tone.nullable().optional(),
  trailerUrl: z.string().nullable(),
  plays: z.number().int(),
  ready: z.boolean(),
});
export type IdeaView = z.infer<typeof IdeaView>;

export const TodayResponse = z.object({
  date: z.string(),
  ideas: z.array(IdeaView),
  /** True while a budget cap stops new scenes; filmed scenes still play. */
  filmingPaused: z.boolean().optional(),
});
export type TodayResponse = z.infer<typeof TodayResponse>;

export const PromptText = z.string().trim().min(3).max(240);

export const StartStoryRequest = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('idea'), ideaId: z.string() }),
  z.object({
    kind: z.literal('custom'),
    prompt: PromptText,
    moods: z.array(Mood).max(3).default([]),
    audience: Audience.default('family'),
  }),
]);
export type StartStoryRequest = z.input<typeof StartStoryRequest>;

export const StoryStatus = z.enum(['active', 'finished']);
export type StoryStatus = z.infer<typeof StoryStatus>;

export const StoryView = z.object({
  id: z.string(),
  title: z.string(),
  audience: Audience,
  ideaId: z.string().nullable(),
  currentNodeId: z.string(),
  path: z.array(z.string()),
  status: StoryStatus,
  shareSlug: z.string().nullable(),
});
export type StoryView = z.infer<typeof StoryView>;

/** One of this TV's stories, for Continue watching on Home. */
export const StorySummary = z.object({
  id: z.string(),
  title: z.string(),
  status: StoryStatus,
  ideaId: z.string().nullable(),
  chapter: z.number().int(),
  totalChapters: z.number().int(),
  posterUrl: z.string().nullable(),
  tone: Tone.nullable().optional(),
  updatedAt: z.string(),
});
export type StorySummary = z.infer<typeof StorySummary>;

export const StoryListResponse = z.object({ stories: z.array(StorySummary) });
export type StoryListResponse = z.infer<typeof StoryListResponse>;

export const ChooseRequest = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('preset'),
    fromNodeId: z.string(),
    index: z.number().int().min(0).max(1),
  }),
  z.object({
    kind: z.literal('custom'),
    fromNodeId: z.string(),
    text: z.string().trim().min(2).max(200),
  }),
]);
export type ChooseRequest = z.infer<typeof ChooseRequest>;

export const ChooseResponse = z.object({
  story: StoryView,
  nextNodeId: z.string(),
});
export type ChooseResponse = z.infer<typeof ChooseResponse>;

export const ChoiceStat = z.object({
  sceneNumber: z.number().int(),
  label: z.string(),
  percent: z.number().min(0).max(100),
  custom: z.boolean(),
});
export type ChoiceStat = z.infer<typeof ChoiceStat>;

export const StoryStats = z.object({
  choices: z.array(ChoiceStat),
  rarestChoice: ChoiceStat.nullable(),
  endingsDiscovered: z.number().int(),
  familiesPlayed: z.number().int(),
});
export type StoryStats = z.infer<typeof StoryStats>;

export const MovieStatus = z.enum(['pending', 'ready', 'failed']);
export type MovieStatus = z.infer<typeof MovieStatus>;

export const FinishResponse = z.object({
  story: StoryView,
  shareSlug: z.string(),
  shareUrl: z.string(),
  movieStatus: MovieStatus,
  movieUrl: z.string().nullable(),
  stats: StoryStats,
});
export type FinishResponse = z.infer<typeof FinishResponse>;

export const ShareScene = z.object({
  caption: z.string().nullable(),
  clipUrl: z.string(),
  posterUrl: z.string().nullable(),
  tone: Tone.nullable().optional(),
  choiceTaken: z.string().nullable(),
  /** False for the later clips of a chapter, which follow the first one without a choice. */
  chapterStart: z.boolean().optional(),
  /** True when the scene was reported and taken down; clipUrl is then empty. */
  removed: z.boolean().optional(),
});
export type ShareScene = z.infer<typeof ShareScene>;

export const ShareView = z.object({
  slug: z.string(),
  title: z.string(),
  createdAt: z.string(),
  movieStatus: MovieStatus,
  movieUrl: z.string().nullable(),
  scenes: z.array(ShareScene),
  stats: StoryStats,
});
export type ShareView = z.infer<typeof ShareView>;

export const SparkProduct = z.object({
  sku: z.string(),
  sparks: z.number().int().positive(),
});
export type SparkProduct = z.infer<typeof SparkProduct>;

export const WalletView = z.object({
  sparks: z.number().int().min(0),
  freeSparks: z.number().int().min(0),
  sceneCost: z.number().int().min(0),
  products: z.array(SparkProduct),
  purchasesEnabled: z.boolean(),
  /** True while a budget cap stops new scenes; filmed scenes still play. */
  filmingPaused: z.boolean().optional(),
});
export type WalletView = z.infer<typeof WalletView>;

export const PrefetchRequest = z.object({
  index: z.number().int().min(0).max(1),
});
export type PrefetchRequest = z.infer<typeof PrefetchRequest>;

export const VerifyPurchaseRequest = z.object({
  receiptId: z.string().min(1).max(512),
  userId: z.string().min(1).max(256),
  sku: z.string().min(1).max(128),
  marketplace: z.string().max(16).optional(),
});
export type VerifyPurchaseRequest = z.infer<typeof VerifyPurchaseRequest>;

export const VerifyPurchaseResponse = z.object({
  wallet: WalletView,
  credited: z.number().int().min(0),
  alreadyProcessed: z.boolean(),
});
export type VerifyPurchaseResponse = z.infer<typeof VerifyPurchaseResponse>;

export const ReportReason = z.enum(['scary', 'inappropriate', 'broken', 'other']);
export type ReportReason = z.infer<typeof ReportReason>;

export const ReportRequest = z.object({
  reason: ReportReason,
  storyId: z.string().max(64).optional(),
});
export type ReportRequest = z.infer<typeof ReportRequest>;

export const ReportResponse = z.object({ ok: z.literal(true) });
export type ReportResponse = z.infer<typeof ReportResponse>;

export const ErrorCode = z.enum([
  'bad_request',
  'not_found',
  'rate_limited',
  'budget_exhausted',
  'unsafe_input',
  'generation_failed',
  'not_ready',
  'payment_required',
  'purchase_invalid',
  'internal',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorResponse = z.object({
  error: z.object({ code: ErrorCode, message: z.string() }),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

export const DEVICE_HEADER = 'x-device-id';
export const IAP_USER_HEADER = 'x-iap-user-id';
export const API_VERSION = 'v1';
