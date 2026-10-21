import Anthropic, { APIConnectionError } from '@anthropic-ai/sdk';
import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';
import type { Config } from '../../config';
import { ModelConnectionError, requestTimeoutMs, type ChatModel, type ChatReply, type ChatRequest } from './types';

/** The slice of the Anthropic client the director needs, so tests can pass a stub. */
export interface MessagesClient {
  messages: {
    create(body: Anthropic.MessageCreateParamsNonStreaming, options?: { timeout?: number }): Promise<Anthropic.Message>;
  };
}

export type Effort = NonNullable<Config['DIRECTOR_EFFORT']>;

// Retries happen in the director so each one is counted.
export function createBedrockClient(config: Config): MessagesClient {
  // The Mantle client speaks the Messages API against bedrock-mantle.{region}.api.aws.
  // With a Bedrock API key it sends it as a bearer token, otherwise it signs with
  // SigV4 using the normal AWS credential chain.
  return new AnthropicBedrockMantle({
    awsRegion: config.AWS_REGION,
    ...(config.bedrockToken ? { apiKey: config.bedrockToken } : {}),
    maxRetries: 0,
  });
}

export function createAnthropicClient(config: Config): MessagesClient {
  return new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, maxRetries: 0 });
}

/** Claude through the Messages API, either on Amazon Bedrock or straight from Anthropic. */
export class AnthropicChat implements ChatModel {
  constructor(
    private readonly client: MessagesClient,
    readonly provider: 'bedrock' | 'anthropic',
    readonly model: string,
    private readonly effort: Effort,
  ) {}

  async complete(request: ChatRequest): Promise<ChatReply> {
    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: request.maxTokens,
          system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
          messages: request.messages,
          output_config: { effort: this.effort },
        },
        { timeout: requestTimeoutMs(request.maxTokens) },
      );
    } catch (err) {
      if (err instanceof APIConnectionError) throw new ModelConnectionError(err.message);
      throw err;
    }

    const usage = response.usage;
    return {
      text: response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join(''),
      stop: response.stop_reason === 'refusal' ? 'refusal' : response.stop_reason === 'max_tokens' ? 'max_tokens' : 'end',
      // Cached prompt tokens are billed at a discount; counting them in full keeps the estimate on the safe side.
      inputTokens: usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
      outputTokens: usage.output_tokens,
    };
  }
}
