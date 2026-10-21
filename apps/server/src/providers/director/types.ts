import type { Audience, Bible, Character, Mood } from '../../domain';

export interface SceneHistoryItem {
  sceneNumber: number;
  summary: string;
  caption: string;
  /** The choice that led out of this scene, if any. */
  choiceTaken: string | null;
}

export interface SceneRequest {
  treeId: string;
  /** The scene being written, for the spend log. */
  nodeId?: string;
  /** Node ids from the root to this scene, used to seed deterministic fakes. */
  pathKey: string;
  bible: Bible;
  /** Bible characters plus anyone introduced earlier on this path. */
  cast: Character[];
  history: SceneHistoryItem[];
  choice: { kind: 'preset' | 'custom'; text: string } | null;
  sceneNumber: number;
  totalScenes: number;
  sceneSeconds: number;
  /** Set on the second try after the first draft failed the safety check. */
  stricter?: boolean;
}

export interface Scene {
  summary: string;
  caption: string;
  videoPrompt: string;
  choices: string[];
  isEnding: boolean;
  newCharacters: Character[];
}

export interface BibleRequest {
  treeId?: string;
  nodeId?: string;
  prompt: string;
  moods: Mood[];
  audience: Audience;
  totalScenes: number;
}

export interface Director {
  readonly name: string;
  writeScene(request: SceneRequest): Promise<Scene>;
  createBible(request: BibleRequest): Promise<Bible>;
  planIdeas(date: string, count: number, avoidTitles?: string[]): Promise<Bible[]>;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
}

export interface ChatReply {
  text: string;
  stop: 'end' | 'max_tokens' | 'refusal';
  inputTokens: number;
  outputTokens: number;
}

/** One chat model behind any provider. The director only ever needs plain text back. */
export interface ChatModel {
  readonly provider: string;
  readonly model: string;
  complete(request: ChatRequest): Promise<ChatReply>;
}

/** Long replies take longer, so the plan of six stories gets more time than one scene. */
export function requestTimeoutMs(maxTokens: number): number {
  return Math.max(30_000, maxTokens * 18);
}

export interface DirectorCallContext {
  task: 'scene' | 'bible' | 'plan';
  nodeId?: string | null;
  treeId?: string | null;
}

/**
 * Counts every request to the model, retries included. beginCall throws
 * when the lifetime call cap is reached, before any money is spent.
 */
export interface DirectorMeter {
  beginCall(context: DirectorCallContext): void;
  endCall(context: DirectorCallContext, result: { inputTokens: number; outputTokens: number; ms: number; ok: boolean }): void;
}

export const unmetered: DirectorMeter = {
  beginCall() {},
  endCall() {},
};

/** The model declined to write this. Treated like an unsafe draft. */
export class DirectorRefusal extends Error {
  override name = 'DirectorRefusal';
}

/** A dropped connection or timeout, worth one more try. */
export class ModelConnectionError extends Error {
  override name = 'ModelConnectionError';
}

/** The provider answered with an error status. 429 and 5xx are worth one more try. */
export class ModelHttpError extends Error {
  override name = 'ModelHttpError';
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** The model answered twice without producing valid JSON. */
export class DirectorFormatError extends Error {
  override name = 'DirectorFormatError';
}
