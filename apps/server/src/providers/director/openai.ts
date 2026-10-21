import {
  ModelConnectionError,
  ModelHttpError,
  requestTimeoutMs,
  type ChatModel,
  type ChatReply,
  type ChatRequest,
} from './types';

export interface OpenAiChatOptions {
  provider: 'openrouter' | 'openai';
  model: string;
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  /** Merged into every request body, for things like OpenRouter's provider routing. */
  extraBody?: Record<string, unknown>;
  fetch?: typeof fetch;
}

interface CompletionChoice {
  finish_reason?: string | null;
  native_finish_reason?: string | null;
  message?: { content?: string | Array<{ type: string; text?: string }> | null; refusal?: string | null };
  error?: { message?: string };
}

interface CompletionBody {
  choices?: CompletionChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; code?: number | string };
}

/**
 * Any service that speaks the OpenAI chat completions API: OpenRouter, OpenAI,
 * Groq, Together, DeepSeek, Gemini, Mistral, or a local Ollama or vLLM.
 */
export class OpenAiChat implements ChatModel {
  readonly provider: string;
  readonly model: string;
  private readonly url: string;
  private readonly fetch: typeof fetch;

  constructor(private readonly options: OpenAiChatOptions) {
    this.provider = options.provider;
    this.model = options.model;
    this.url = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    this.fetch = options.fetch ?? fetch;
  }

  async complete(request: ChatRequest): Promise<ChatReply> {
    const { apiKey, headers, extraBody } = this.options;
    // OpenAI's own newer models refuse max_tokens; most other services only know max_tokens.
    const limitField = new URL(this.url).hostname === 'api.openai.com' ? 'max_completion_tokens' : 'max_tokens';
    const payload = {
      model: this.model,
      [limitField]: request.maxTokens,
      messages: [{ role: 'system', content: request.system }, ...request.messages],
      ...extraBody,
    };

    let status: number;
    let raw: string;
    try {
      const response = await this.fetch(this.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          ...headers,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(requestTimeoutMs(request.maxTokens)),
      });
      status = response.status;
      raw = await response.text();
    } catch (err) {
      throw new ModelConnectionError(`${this.provider}: ${(err as Error).message}`);
    }

    let body: CompletionBody;
    try {
      body = JSON.parse(raw) as CompletionBody;
    } catch {
      throw new ModelHttpError(`${this.provider} ${status}: ${raw.slice(0, 200)}`, status >= 400 ? status : 502);
    }
    if (status >= 400 || body.error) {
      const code = typeof body.error?.code === 'number' ? body.error.code : status;
      throw new ModelHttpError(`${this.provider} ${code}: ${body.error?.message ?? raw.slice(0, 200)}`, code >= 400 ? code : 502);
    }

    const choice = body.choices?.[0];
    if (!choice || choice.finish_reason === 'error') {
      throw new ModelHttpError(`${this.provider}: ${choice?.error?.message ?? 'no reply'}`, 502);
    }
    const content = choice.message?.content;
    const text = typeof content === 'string' ? content : (content ?? []).map((part) => part.text ?? '').join('');
    const refused =
      choice.finish_reason === 'content_filter' || choice.native_finish_reason === 'refusal' || Boolean(choice.message?.refusal);

    return {
      text,
      stop: refused ? 'refusal' : choice.finish_reason === 'length' ? 'max_tokens' : 'end',
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
    };
  }
}
