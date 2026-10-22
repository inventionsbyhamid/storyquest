import type { Audience, Mood, MovieStatus, NodeStatus, StoryStatus } from '@storyquest/contracts';

export type { Audience, Mood, MovieStatus, NodeStatus, StoryStatus };

export interface Character {
  name: string;
  description: string;
  /** How they sound, repeated in every clip they speak in so the voice stays close. */
  voice?: string;
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
  /** What each chapter has to achieve, written before the first scene so the story arrives somewhere. */
  outline?: string[];
}

/** One clip of a chapter, written ahead with the rest of the chapter. videoPrompt is exactly what the video model gets. */
export interface Shot {
  caption: string;
  videoPrompt: string;
}

/** A spoken line in a clip. */
export interface Line {
  speaker: string;
  line: string;
}

/** A clip as the director writes it. The video prompt is put together from it and the story bible. */
export interface ShotDraft {
  caption: string;
  /** Names of the characters on screen. */
  cast: string[];
  action: string;
  dialogue: Line[];
  sound: string;
}

/** A whole chapter ready to film, written by the director or approved ahead by an admin. */
export interface WrittenChapter {
  summary: string;
  shots: Shot[];
  choices: string[];
  isEnding: boolean;
  newCharacters: Character[];
}

/** The rest of a chapter after the clip that carries it. */
export interface ChapterScript {
  shots: Shot[];
  summary: string;
  choices: string[];
  isEnding: boolean;
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
  /** Chapters in the story. Old stories have one clip per chapter, so this is also their scene count. */
  totalScenes: number;
  /** Continuous clips that make up one chapter before the next choice. */
  clipsPerChapter: number;
  /** Chapters approved ahead of filming, keyed by the choices that lead to them ("" is chapter 1, "0,1" follows choice 0 then 1). */
  scripts: Record<string, WrittenChapter>;
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
  /** Set when an admin took the story off Home. Families who started it can still continue. */
  unlistedAt: string | null;
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
  /** Clips from the opening; chapter and shot say where the clip sits in the story. */
  depth: number;
  chapter: number;
  shot: number;
  /** The clips still to come in this chapter, so they are filmed without asking the director again. */
  script: ChapterScript | null;
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
  /** The night color of the poster and of the last frame, for the TV backdrop. */
  tone: string | null;
  endTone: string | null;
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
  updatedAt: string;
  finishedAt: string | null;
}

/** True when this clip is followed by another clip of the same chapter instead of a choice. */
export function continuesChapter(node: NodeRecord): boolean {
  return node.script !== null && node.script.shots.length > 0;
}

export function isPaid(node: NodeRecord): boolean {
  return Boolean(node.charge && !node.charge.refunded);
}

export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
