import type { Audience, Mood, MovieStatus, NodeStatus, StoryStatus } from '@storyquest/contracts';

export type { Audience, Mood, MovieStatus, NodeStatus, StoryStatus };

export interface Character {
  name: string;
  description: string;
}

export interface Bible {
  title: string;
  logline: string;
  audience: Audience;
  moods: Mood[];
  artStyle: string;
  setting: string;
  tone: string;
  characters: Character[];
}

export interface TreeRecord {
  id: string;
  ideaId: string | null;
  title: string;
  logline: string;
  audience: Audience;
  moods: Mood[];
  bible: Bible | null;
  prompt: string | null;
  totalScenes: number;
  isPrivate: boolean;
  /** Scenes deep that an admin asked to pre generate, and whether that may exceed the daily cap. */
  warmDepth: number;
  warmForce: boolean;
  createdAt: string;
}

export interface IdeaRecord {
  id: string;
  date: string;
  position: number;
  treeId: string;
  rootNodeId: string;
  title: string;
  logline: string;
  audience: Audience;
  moods: Mood[];
  plays: number;
  featuredAt: string | null;
  createdAt: string;
}

export interface NodeTimings {
  directorMs: number;
  videoMs: number;
  mediaMs: number;
  totalMs: number;
  bibleMs?: number;
  inferenceMs?: number;
}

/** How a private scene was paid for, so it can be given back if nothing gets filmed. */
export interface Charge {
  day: string;
  deviceId: string;
  walletKey: string;
  daily: number;
  welcome: number;
  sparks: number;
  refunded?: boolean;
}

/** Keyed by `user:<Amazon IAP user id>`, or `device:<device id>` for TVs that have not sent one. */
export interface WalletRecord {
  key: string;
  sparks: number;
  freeSparks: number;
  purchased: number;
  spent: number;
  freeSpent: number;
}

export interface PurchaseRecord {
  receiptId: string;
  userId: string;
  sku: string;
  sparks: number;
  mode: string;
  testTransaction: boolean;
  raw: string;
  createdAt: string;
}

export interface NodeRecord {
  id: string;
  treeId: string;
  parentId: string | null;
  choiceIndex: number | null;
  customText: string | null;
  ownerStoryId: string | null;
  depth: number;
  status: NodeStatus;
  summary: string | null;
  caption: string | null;
  videoPrompt: string | null;
  choices: string[];
  isEnding: boolean;
  newCharacters: Character[];
  clipPath: string | null;
  posterPath: string | null;
  lastFramePath: string | null;
  durationMs: number | null;
  picks: number;
  wantChildren: boolean;
  warm: number;
  attempts: number;
  error: string | null;
  errorCode: string | null;
  timings: NodeTimings | null;
  costSeconds: number | null;
  charge: Charge | null;
  /** Set when the scene was reported or taken down. Hidden scenes are never offered again. */
  hiddenAt: string | null;
  /** Set when an admin deleted the scene's media for good. */
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoryRecord {
  id: string;
  deviceId: string;
  treeId: string;
  ideaId: string | null;
  path: string[];
  status: StoryStatus;
  shareSlug: string | null;
  moviePath: string | null;
  movieStatus: MovieStatus | null;
  createdAt: string;
  finishedAt: string | null;
}

export function isPaid(node: NodeRecord): boolean {
  return Boolean(node.charge && !node.charge.refunded);
}

export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
