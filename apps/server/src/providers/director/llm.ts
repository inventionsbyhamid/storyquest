import { setTimeout as sleep } from 'node:timers/promises';
import type { z } from 'zod';
import type { Bible } from '../../domain';
import type { Logger } from '../../log';
import { parseModelJson } from './json';
import {
  bibleSystemPrompt,
  bibleUserPrompt,
  planSystemPrompt,
  planUserPrompt,
  sceneSystemPrompt,
  sceneUserPrompt,
} from './prompts';
import { BibleDraftSchema, ideaPlanSchema, sceneSchema } from './schemas';
import {
  DirectorFormatError,
  DirectorRefusal,
  ModelConnectionError,
  unmetered,
  type BibleRequest,
  type ChatMessage,
  type ChatModel,
  type ChatReply,
  type ChatRequest,
  type Director,
  type DirectorCallContext,
  type DirectorMeter,
  type Scene,
  type SceneRequest,
} from './types';

const SEND_ATTEMPTS = 2;

function retryable(err: unknown): boolean {
  const status = (err as { status?: number }).status;
  return err instanceof ModelConnectionError || status === 429 || (status ?? 0) >= 500;
}

/** Writes scenes, bibles and the daily plan with any chat model. Prompts and validation live here, not in the providers. */
export class LlmDirector implements Director {
  readonly name: string;
  private readonly sceneSystem: string;

  constructor(
    private readonly model: ChatModel,
    private readonly options: { sceneSeconds: number; retryDelayMs?: number },
    private readonly log: Logger,
    private readonly meter: DirectorMeter = unmetered,
  ) {
    this.name = model.provider;
    this.sceneSystem = sceneSystemPrompt(options.sceneSeconds);
  }

  async writeScene(request: SceneRequest): Promise<Scene> {
    const scene = await this.ask(
      { task: 'scene', nodeId: request.nodeId, treeId: request.treeId },
      this.sceneSystem,
      sceneUserPrompt(request),
      sceneSchema(request.sceneNumber, request.totalScenes),
      4000,
    );
    return { ...scene, newCharacters: scene.newCharacters ?? [] };
  }

  async createBible(request: BibleRequest): Promise<Bible> {
    const draft = await this.ask(
      { task: 'bible', nodeId: request.nodeId, treeId: request.treeId },
      bibleSystemPrompt(),
      bibleUserPrompt(request),
      BibleDraftSchema,
      4000,
    );
    return { ...draft, audience: request.audience, moods: request.moods };
  }

  async planIdeas(date: string, count: number, avoidTitles: string[] = []): Promise<Bible[]> {
    if (count <= 0) return [];
    const plan = await this.ask(
      { task: 'plan' },
      planSystemPrompt(),
      planUserPrompt(date, count, avoidTitles),
      ideaPlanSchema(count),
      8000,
    );
    return plan.ideas.slice(0, count);
  }

  /**
   * The reply is plain text holding one JSON object, which works the same on
   * every provider. A reply that fails validation gets one more turn with the
   * error fed back.
   */
  private async ask<S extends z.ZodTypeAny>(
    context: DirectorCallContext,
    system: string,
    prompt: string,
    schema: S,
    maxTokens: number,
  ): Promise<z.output<S>> {
    const task = context.task;
    const messages: ChatMessage[] = [{ role: 'user', content: prompt }];
    let lastError = '';

    for (let attempt = 1; attempt <= 2; attempt++) {
      const reply = await this.send(context, { system, messages: [...messages], maxTokens });
      if (reply.stop === 'refusal') {
        throw new DirectorRefusal(`director refused the ${task} request`);
      }

      const parsed = parseModelJson(schema, reply.text);
      if (parsed.ok) return parsed.value;

      lastError = reply.stop === 'max_tokens' ? `reply was cut off. ${parsed.error}` : parsed.error;
      this.log.warn({ task, attempt, error: lastError }, 'director reply failed validation');
      // Some providers reject an empty assistant turn.
      if (reply.text.trim()) messages.push({ role: 'assistant', content: reply.text });
      messages.push({
        role: 'user',
        content: `That reply could not be used: ${lastError}\nReply again with only the corrected JSON object.`,
      });
    }

    throw new DirectorFormatError(`${task}: ${lastError}`);
  }

  /** One metered request, retried once on throttling, server errors and dropped connections. */
  private async send(context: DirectorCallContext, request: ChatRequest): Promise<ChatReply> {
    for (let attempt = 1; ; attempt++) {
      this.meter.beginCall(context);
      const started = Date.now();
      try {
        const reply = await this.model.complete(request);
        const ms = Date.now() - started;
        const { inputTokens, outputTokens } = reply;
        this.meter.endCall(context, { inputTokens, outputTokens, ms, ok: true });
        this.log.info(
          { task: context.task, model: this.model.model, attempt, ms, stop: reply.stop, inputTokens, outputTokens },
          'director call',
        );
        return reply;
      } catch (err) {
        this.meter.endCall(context, { inputTokens: 0, outputTokens: 0, ms: Date.now() - started, ok: false });
        if (attempt >= SEND_ATTEMPTS || !retryable(err)) throw err;
        this.log.warn({ task: context.task, attempt, error: (err as Error).message }, 'director call failed, retrying');
        await sleep((this.options.retryDelayMs ?? 1_000) * attempt);
      }
    }
  }
}
