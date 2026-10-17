import type Anthropic from '@anthropic-ai/sdk';
import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';
import type { z } from 'zod';
import type { Config } from '../../config';
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
  type BibleRequest,
  type Director,
  type Scene,
  type SceneRequest,
} from './types';

/** The slice of the Anthropic client the director needs, so tests can pass a stub. */
export interface MessagesClient {
  messages: {
    create(body: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  };
}

type Effort = Config['BEDROCK_EFFORT'];

const REQUEST_TIMEOUT_MS = 25_000;

export function createBedrockClient(config: Config): MessagesClient {
  // The Mantle client speaks the Messages API against bedrock-mantle.{region}.api.aws.
  // With a Bedrock API key it sends it as a bearer token, otherwise it signs with
  // SigV4 using the normal AWS credential chain. maxRetries covers 429 and 5xx with backoff.
  return new AnthropicBedrockMantle({
    awsRegion: config.AWS_REGION,
    ...(config.bedrockToken ? { apiKey: config.bedrockToken } : {}),
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 1,
  });
}

export class BedrockDirector implements Director {
  readonly name = 'bedrock';
  private readonly sceneSystem: string;

  constructor(
    private readonly client: MessagesClient,
    private readonly options: { model: string; effort: Effort; sceneSeconds: number },
    private readonly log: Logger,
  ) {
    this.sceneSystem = sceneSystemPrompt(options.sceneSeconds);
  }

  async writeScene(request: SceneRequest): Promise<Scene> {
    const scene = await this.ask(
      'scene',
      this.sceneSystem,
      sceneUserPrompt(request),
      sceneSchema(request.sceneNumber, request.totalScenes),
      4000,
    );
    return { ...scene, newCharacters: scene.newCharacters ?? [] };
  }

  async createBible(request: BibleRequest): Promise<Bible> {
    const draft = await this.ask('bible', bibleSystemPrompt(), bibleUserPrompt(request), BibleDraftSchema, 4000);
    return { ...draft, audience: request.audience, moods: request.moods };
  }

  async planIdeas(date: string, count: number, avoidTitles: string[] = []): Promise<Bible[]> {
    if (count <= 0) return [];
    const plan = await this.ask(
      'plan',
      planSystemPrompt(),
      planUserPrompt(date, count, avoidTitles),
      ideaPlanSchema(count),
      8000,
    );
    return plan.ideas.slice(0, count);
  }

  /**
   * Structured outputs and forced tool use are not available for this model on
   * Bedrock, so the reply is plain text holding one JSON object. A reply that
   * fails validation gets one more turn with the error fed back.
   */
  private async ask<S extends z.ZodTypeAny>(
    task: string,
    system: string,
    prompt: string,
    schema: S,
    maxTokens: number,
  ): Promise<z.output<S>> {
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }];
    let lastError = '';

    for (let attempt = 1; attempt <= 2; attempt++) {
      const started = Date.now();
      const response = await this.client.messages.create({
        model: this.options.model,
        max_tokens: maxTokens,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages,
        output_config: { effort: this.options.effort },
      });
      this.log.info(
        {
          task,
          attempt,
          ms: Date.now() - started,
          stopReason: response.stop_reason,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        },
        'director call',
      );

      if (response.stop_reason === 'refusal') {
        throw new DirectorRefusal(`director refused the ${task} request`);
      }

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');
      const parsed = parseModelJson(schema, text);
      if (parsed.ok) return parsed.value;

      lastError = response.stop_reason === 'max_tokens' ? `reply was cut off. ${parsed.error}` : parsed.error;
      this.log.warn({ task, attempt, error: lastError }, 'director reply failed validation');
      messages.push(
        { role: 'assistant', content: response.content },
        {
          role: 'user',
          content: `That reply could not be used: ${lastError}\nReply again with only the corrected JSON object.`,
        },
      );
    }

    throw new DirectorFormatError(`${task}: ${lastError}`);
  }
}
