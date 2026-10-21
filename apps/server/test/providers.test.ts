import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config';
import { providersSentence } from '../src/http/site';
import { createChatModel } from '../src/services';
import { hasDash } from '../src/text';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('choosing the story director', () => {
  it('picks Claude Opus 5.5 under each provider name when no model is set', () => {
    expect(loadConfig({ DIRECTOR: 'bedrock' }).directorModel).toBe('anthropic.claude-opus-5-5');
    expect(loadConfig({ DIRECTOR: 'anthropic', ANTHROPIC_API_KEY: 'k' }).directorModel).toBe('claude-opus-5-5');
    expect(loadConfig({ DIRECTOR: 'openrouter', OPENROUTER_API_KEY: 'k' }).directorModel).toBe('anthropic/claude-opus-5.5');
    expect(
      loadConfig({ DIRECTOR: 'openrouter', OPENROUTER_API_KEY: 'k', DIRECTOR_MODEL: 'google/gemini-3.8-flash' }).directorModel,
    ).toBe('google/gemini-3.8-flash');
  });

  it('asks for the key or model each provider needs', () => {
    expect(() => loadConfig({ DIRECTOR: 'anthropic' })).toThrow(/ANTHROPIC_API_KEY is required/);
    expect(() => loadConfig({ DIRECTOR: 'openrouter' })).toThrow(/OPENROUTER_API_KEY is required/);
    expect(() => loadConfig({ DIRECTOR: 'openai' })).toThrow(/DIRECTOR_MODEL is required/);
    expect(() => loadConfig({ DIRECTOR: 'openrouter', OPENROUTER_API_KEY: 'k', OPENROUTER_PROVIDERS: 'amazon bedrock' })).toThrow(
      /OPENROUTER_PROVIDERS/,
    );
    // A local model server needs no key.
    expect(loadConfig({ DIRECTOR: 'openai', DIRECTOR_MODEL: 'llama3.3', OPENAI_BASE_URL: 'http://localhost:11434/v1' }).DIRECTOR).toBe(
      'openai',
    );
  });

  it('makes no model for the fake director', () => {
    expect(createChatModel(loadConfig({}))).toBeNull();
  });

  it('routes OpenRouter to the pinned hosts, never to ones that keep data, at low effort', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }], usage: {} })),
    );
    vi.stubGlobal('fetch', fetch);
    const model = createChatModel(
      loadConfig({
        DIRECTOR: 'openrouter',
        OPENROUTER_API_KEY: 'sk-or-test',
        OPENROUTER_PROVIDERS: 'amazon-bedrock',
        PUBLIC_BASE_URL: 'https://storyquest.example',
      }),
    )!;
    expect(model.provider).toBe('openrouter');
    await model.complete({ system: 's', messages: [{ role: 'user', content: 'u' }], maxTokens: 100 });

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-or-test');
    expect(headers['HTTP-Referer']).toBe('https://storyquest.example');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: 'anthropic/claude-opus-5.5',
      verbosity: 'low',
      provider: { data_collection: 'deny', order: ['amazon-bedrock'], allow_fallbacks: false },
    });
  });

  it('sends reasoning effort to OpenAI compatible services only when asked', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }], usage: {} })),
    );
    vi.stubGlobal('fetch', fetch);
    const request = { system: 's', messages: [{ role: 'user' as const, content: 'u' }], maxTokens: 100 };
    await createChatModel(loadConfig({ DIRECTOR: 'openai', DIRECTOR_MODEL: 'gpt-test' }))!.complete(request);
    await createChatModel(loadConfig({ DIRECTOR: 'openai', DIRECTOR_MODEL: 'gpt-test', DIRECTOR_EFFORT: 'high' }))!.complete(
      request,
    );
    const bodies = fetch.mock.calls.map((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)));
    expect('reasoning_effort' in bodies[0]).toBe(false);
    expect(bodies[1].reasoning_effort).toBe('high');
  });
});

describe('privacy page providers', () => {
  it('names Amazon once when Bedrock writes and checks the scenes', () => {
    const sentence = providersSentence(
      loadConfig({ DIRECTOR: 'bedrock', SAFETY: 'guardrails', GUARDRAIL_ID: 'g', VIDEO: 'fal', FAL_KEY: 'k' }),
    );
    expect(sentence).toContain(
      'Amazon Web Services (Amazon Bedrock writes the scene and Amazon Bedrock Guardrails checks it for safety) and fal (films the video).',
    );
  });

  it('names OpenRouter and the host it is pinned to', () => {
    const pinned = providersSentence(
      loadConfig({ DIRECTOR: 'openrouter', OPENROUTER_API_KEY: 'k', OPENROUTER_PROVIDERS: 'amazon-bedrock/us-east-1', VIDEO: 'fal', FAL_KEY: 'k' }),
    );
    expect(pinned).toContain('OpenRouter (passes it on), Amazon Web Services (Amazon Bedrock writes the scene) and fal');
    const open = providersSentence(loadConfig({ DIRECTOR: 'openrouter', OPENROUTER_API_KEY: 'k' }));
    expect(open).toContain('OpenRouter (passes it to the AI model that writes the scene).');
    expect(hasDash(pinned) || hasDash(open)).toBe(false);
  });

  it('names the service behind an OpenAI compatible address', () => {
    expect(providersSentence(loadConfig({ DIRECTOR: 'openai', DIRECTOR_MODEL: 'm' }))).toContain('OpenAI (writes the scene)');
    expect(
      providersSentence(loadConfig({ DIRECTOR: 'openai', DIRECTOR_MODEL: 'm', OPENAI_BASE_URL: 'https://api.groq.com/openai/v1' })),
    ).toContain('api.groq.com (writes the scene)');
  });

  it('says everything stays on the server with the fakes', () => {
    expect(providersSentence(loadConfig({}))).toBe('Scenes are written and filmed on our own server.');
  });
});
