import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import type { Bible } from '../src/domain';
import { silentLogger } from '../src/log';
import { AnthropicChat, type MessagesClient } from '../src/providers/director/anthropic';
import { FakeDirector } from '../src/providers/director/fake';
import { extractJsonObject, parseModelJson } from '../src/providers/director/json';
import { LlmDirector } from '../src/providers/director/llm';
import { OpenAiChat } from '../src/providers/director/openai';
import {
  arcBeat,
  chapterSystemPrompt,
  sceneSystemPrompt,
  sceneUserPrompt,
  seasonNote,
} from '../src/providers/director/prompts';
import { chapterSchema, sceneSchema } from '../src/providers/director/schemas';
import {
  DirectorFormatError,
  DirectorRefusal,
  ModelHttpError,
  type SceneRequest,
} from '../src/providers/director/types';
import { hasDash } from '../src/text';

const goodScene = {
  summary: 'Mia found a silver door in the garden wall. Biscuit barked at the glowing keyhole.',
  caption: 'Mia finds a silver door glowing in the garden wall.',
  videoPrompt:
    'Soft 3D animated feature film look. Mia, a seven year old girl with curly black hair, kneels by a glowing silver door in a moonlit garden while a beagle puppy wags beside her. Medium shot, slow push in. Sound: night breeze, music box melody, Mia says "Look, Biscuit!"',
  choices: ['Open the moon door', 'Follow the falling star'],
  isEnding: false,
};

describe('extractJsonObject', () => {
  it('parses a plain object', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips code fences and surrounding prose', () => {
    expect(extractJsonObject('Here you go:\n```json\n{"a": {"b": "}"}}\n```\nEnjoy!')).toEqual({ a: { b: '}' } });
  });

  it('handles escaped quotes inside strings', () => {
    expect(extractJsonObject('{"line": "she says \\"hi {there}\\""}')).toEqual({ line: 'she says "hi {there}"' });
  });

  it('throws on a cut off reply', () => {
    expect(() => extractJsonObject('{"summary": "half')).toThrow(/not closed/);
  });

  it('throws when there is no object', () => {
    expect(() => extractJsonObject('sorry, no')).toThrow(/no JSON object/);
  });
});

describe('scene validation', () => {
  it('accepts a valid middle scene', () => {
    const parsed = parseModelJson(sceneSchema(2, 6), JSON.stringify(goodScene));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.newCharacters).toEqual([]);
  });

  it('rejects an early ending and a single choice with readable errors', () => {
    const parsed = parseModelJson(
      sceneSchema(3, 6),
      JSON.stringify({ ...goodScene, isEnding: true, choices: ['Only one'] }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain('isEnding');
      expect(parsed.error).toContain('exactly 2 choices');
    }
  });

  it('accepts a new character written as "Name: description"', () => {
    const parsed = parseModelJson(
      sceneSchema(2, 6),
      JSON.stringify({
        ...goodScene,
        newCharacters: ['Pip: a small lantern bird folded from russet leaves with a glowing eye'],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.newCharacters).toEqual([
        { name: 'Pip', description: 'a small lantern bird folded from russet leaves with a glowing eye' },
      ]);
    }
    expect(
      parseModelJson(sceneSchema(2, 6), JSON.stringify({ ...goodScene, newCharacters: ['no colon here'] })).ok,
    ).toBe(false);
  });

  it('rejects choices that are too long', () => {
    const parsed = parseModelJson(
      sceneSchema(2, 6),
      JSON.stringify({ ...goodScene, choices: ['Run all the way down to the old harbour now', 'Stay'] }),
    );
    expect(parsed.ok).toBe(false);
  });

  it('is lenient on the final scene because the engine forces the ending', () => {
    const parsed = parseModelJson(sceneSchema(6, 6), JSON.stringify({ ...goodScene, isEnding: false }));
    expect(parsed.ok).toBe(true);
  });
});

const bible: Bible = {
  title: 'The Moon Door',
  logline: 'A round silver door opens in the garden wall.',
  audience: 'kids',
  moods: ['cozy'],
  artStyle: 'Soft 3D animated feature film look',
  setting: 'A sleepy seaside town where a round silver door appears in the garden wall on full moon nights.',
  tone: 'gentle wonder',
  characters: [
    { name: 'Mia', description: 'a seven year old girl with curly black hair' },
    { name: 'Biscuit', description: 'a small fluffy beagle puppy' },
  ],
};

function sceneRequest(overrides: Partial<SceneRequest> = {}): SceneRequest {
  return {
    treeId: 'tr_test',
    pathKey: 'nd_a',
    bible,
    cast: bible.characters,
    history: [],
    choice: null,
    sceneNumber: 1,
    totalScenes: 6,
    sceneSeconds: 8,
    ...overrides,
  };
}

function reply(text: string, stopReason: Anthropic.Message['stop_reason'] = 'end_turn'): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'anthropic.claude-opus-5-5',
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text, citations: null },
    ],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  } as unknown as Anthropic.Message;
}

function stubClient(replies: Anthropic.Message[]) {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const timeouts: Array<number | undefined> = [];
  const client: MessagesClient = {
    messages: {
      async create(body, options) {
        requests.push(structuredClone(body));
        timeouts.push(options?.timeout);
        const next = replies.shift();
        if (!next) throw new Error('no more stubbed replies');
        return next;
      },
    },
  };
  return { client, requests, timeouts };
}

function claude(client: MessagesClient) {
  return new LlmDirector(
    new AnthropicChat(client, 'bedrock', 'anthropic.claude-opus-5-5', 'low'),
    { sceneSeconds: 8 },
    silentLogger,
  );
}

describe('LlmDirector with Claude', () => {
  it('sends a cached system prompt, the effort and no thinking parameter', async () => {
    const { client, requests, timeouts } = stubClient([reply(JSON.stringify(goodScene))]);
    const director = claude(client);
    expect(director.name).toBe('bedrock');
    const scene = await director.writeScene(sceneRequest());
    expect(scene.caption).toBe(goodScene.caption);
    const body = requests[0]!;
    expect(body.model).toBe('anthropic.claude-opus-5-5');
    expect(body.output_config).toEqual({ effort: 'low' });
    expect('thinking' in body).toBe(false);
    expect('tool_choice' in body).toBe(false);
    const system = body.system as Anthropic.TextBlockParam[];
    expect(system[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(system[0]!.text).toContain('8 seconds');
    expect(timeouts[0]).toBeGreaterThanOrEqual(60_000);
  });

  it('gives the daily plan more time than a scene', async () => {
    const { client, timeouts } = stubClient([reply('{"ideas": []}'), reply('{"ideas": []}')]);
    await expect(claude(client).planIdeas('2026-10-21', 3)).rejects.toBeInstanceOf(DirectorFormatError);
    expect(timeouts[0]).toBeGreaterThanOrEqual(120_000);
  });

  it('reads fenced JSON from the text blocks only', async () => {
    const { client } = stubClient([reply(`\`\`\`json\n${JSON.stringify(goodScene)}\n\`\`\``)]);
    const scene = await claude(client).writeScene(sceneRequest());
    expect(scene.choices).toEqual(goodScene.choices);
  });

  it('retries once with the validation error fed back', async () => {
    const { client, requests } = stubClient([reply('{"summary": "too short"}'), reply(JSON.stringify(goodScene))]);
    const scene = await claude(client).writeScene(sceneRequest());
    expect(scene.summary).toBe(goodScene.summary);
    expect(requests).toHaveLength(2);
    expect(requests[0]!.messages).toHaveLength(1);
    const second = requests[1]!.messages;
    expect(second).toHaveLength(3);
    expect(second[1]).toEqual({ role: 'assistant', content: '{"summary": "too short"}' });
    expect(String(second[2]!.content)).toContain('could not be used');
    expect(String(second[2]!.content)).toContain('caption');
  });

  it('gives up after two broken replies', async () => {
    const { client } = stubClient([reply('nope'), reply('{"still": "broken"')]);
    await expect(claude(client).writeScene(sceneRequest())).rejects.toBeInstanceOf(DirectorFormatError);
  });

  it('treats a refusal as unsafe', async () => {
    const { client } = stubClient([reply('', 'refusal')]);
    await expect(claude(client).writeScene(sceneRequest())).rejects.toBeInstanceOf(DirectorRefusal);
  });

  it('keeps the requested audience and moods on a custom bible', async () => {
    const draft = {
      title: 'The Shy Dragon',
      logline: 'A shy dragon learns to bake bread for the whole village.',
      artStyle: 'Storybook watercolour, warm light',
      setting: 'A hillside village with a bakery at the top.',
      tone: 'warm',
      characters: [{ name: 'Puff', description: 'a small green dragon with a flour dusted apron' }],
    };
    const { client } = stubClient([reply(JSON.stringify(draft))]);
    const result = await claude(client).createBible({
      prompt: 'a shy dragon who bakes',
      moods: ['cozy'],
      audience: 'kids',
      totalScenes: 6,
    });
    expect(result).toMatchObject({ title: 'The Shy Dragon', audience: 'kids', moods: ['cozy'] });
  });
});

type Sent = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

function stubFetch(responses: Array<{ status?: number; body: unknown } | Error>) {
  const sent: Sent[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    const next = responses.shift();
    if (!next) throw new Error('no more stubbed responses');
    if (next instanceof Error) throw next;
    const text = typeof next.body === 'string' ? next.body : JSON.stringify(next.body);
    return new Response(text, { status: next.status ?? 200 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, sent };
}

function completion(content: string | null, finish = 'stop', extra: Record<string, unknown> = {}) {
  return {
    choices: [{ finish_reason: finish, message: { role: 'assistant', content }, ...extra }],
    usage: { prompt_tokens: 120, completion_tokens: 80 },
  };
}

function openRouter(fetch: typeof globalThis.fetch, baseUrl = 'https://openrouter.ai/api/v1/') {
  return new OpenAiChat({
    provider: 'openrouter',
    model: 'anthropic/claude-opus-5.5',
    baseUrl,
    apiKey: 'sk-test',
    headers: { 'X-Title': 'StoryQuest' },
    extraBody: { verbosity: 'low', provider: { order: ['amazon-bedrock'], allow_fallbacks: false } },
    fetch,
  });
}

describe('LlmDirector with an OpenAI compatible model', () => {
  it('sends the system prompt as the first message with routing and the key', async () => {
    const { fetch, sent } = stubFetch([{ body: completion(JSON.stringify(goodScene)) }]);
    const director = new LlmDirector(openRouter(fetch), { sceneSeconds: 8 }, silentLogger);
    expect(director.name).toBe('openrouter');
    const scene = await director.writeScene(sceneRequest());
    expect(scene.caption).toBe(goodScene.caption);

    const { url, headers, body } = sent[0]!;
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(headers.authorization).toBe('Bearer sk-test');
    expect(headers['X-Title']).toBe('StoryQuest');
    expect(body.model).toBe('anthropic/claude-opus-5.5');
    expect(body.max_tokens).toBe(4000);
    expect(body.verbosity).toBe('low');
    expect(body.provider).toEqual({ order: ['amazon-bedrock'], allow_fallbacks: false });
    const messages = body.messages as Array<{ role: string; content: string }>;
    expect(messages.map((message) => message.role)).toEqual(['system', 'user']);
    expect(messages[0]!.content).toContain('8 seconds');
  });

  it('uses max_completion_tokens on OpenAI itself and no key header without a key', async () => {
    const { fetch, sent } = stubFetch([{ body: completion(JSON.stringify(goodScene)) }]);
    const model = new OpenAiChat({
      provider: 'openai',
      model: 'gpt-test',
      baseUrl: 'https://api.openai.com/v1',
      fetch,
    });
    await new LlmDirector(model, { sceneSeconds: 8 }, silentLogger).writeScene(sceneRequest());
    expect(sent[0]!.body.max_completion_tokens).toBe(4000);
    expect('max_tokens' in sent[0]!.body).toBe(false);
    expect('authorization' in sent[0]!.headers).toBe(false);
  });

  it('reads text parts, cut off replies and token counts', async () => {
    const { fetch } = stubFetch([
      { body: completion(null, 'length', { message: { content: [{ type: 'text', text: '{"summary": "half' }] } }) },
    ]);
    const reply = await openRouter(fetch).complete({
      system: 's',
      messages: [{ role: 'user', content: 'u' }],
      maxTokens: 10,
    });
    expect(reply).toEqual({ text: '{"summary": "half', stop: 'max_tokens', inputTokens: 120, outputTokens: 80 });
  });

  it('treats a content filter or a refusal as unsafe', async () => {
    for (const body of [
      completion('', 'content_filter'),
      completion('', 'stop', { native_finish_reason: 'refusal' }),
    ]) {
      const { fetch } = stubFetch([{ body }]);
      await expect(
        new LlmDirector(openRouter(fetch), { sceneSeconds: 8 }, silentLogger).writeScene(sceneRequest()),
      ).rejects.toBeInstanceOf(DirectorRefusal);
    }
  });

  it('retries once on throttling and dropped connections, not on a bad key', async () => {
    const throttled = stubFetch([
      { status: 429, body: { error: { message: 'slow down', code: 429 } } },
      new TypeError('fetch failed'),
    ]);
    await expect(
      new LlmDirector(openRouter(throttled.fetch), { sceneSeconds: 8, retryDelayMs: 0 }, silentLogger).writeScene(
        sceneRequest(),
      ),
    ).rejects.toThrow(/fetch failed/);
    expect(throttled.sent).toHaveLength(2);

    const badKey = stubFetch([{ status: 401, body: { error: { message: 'No auth credentials found', code: 401 } } }]);
    const error = await new LlmDirector(openRouter(badKey.fetch), { sceneSeconds: 8, retryDelayMs: 0 }, silentLogger)
      .writeScene(sceneRequest())
      .catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ModelHttpError);
    expect((error as ModelHttpError).status).toBe(401);
    expect(badKey.sent).toHaveLength(1);
  });

  it('turns an error inside a 200 reply or a non JSON page into a retryable error', async () => {
    const { fetch, sent } = stubFetch([
      { body: { error: { message: 'upstream overloaded', code: 502 } } },
      { status: 502, body: '<html>Bad gateway</html>' },
    ]);
    await expect(
      new LlmDirector(openRouter(fetch), { sceneSeconds: 8, retryDelayMs: 0 }, silentLogger).writeScene(sceneRequest()),
    ).rejects.toMatchObject({ status: 502 });
    expect(sent).toHaveLength(2);
  });
});

describe('chapter validation', () => {
  const shot = { caption: 'Mia opens the moon door.', videoPrompt: goodScene.videoPrompt };
  const chapter = { summary: goodScene.summary, choices: goodScene.choices, isEnding: false };

  it('keeps the first shots of a long reply and drops empty ones', () => {
    const extra = parseModelJson(
      chapterSchema(1, 4, 3),
      JSON.stringify({ ...chapter, shots: [shot, shot, shot, shot] }),
    );
    expect(extra.ok && extra.value.shots).toHaveLength(3);
    const empty = parseModelJson(
      chapterSchema(1, 4, 3),
      JSON.stringify({ ...chapter, shots: [{ caption: '', videoPrompt: '' }, shot, shot, shot] }),
    );
    expect(empty.ok).toBe(true);
    expect(parseModelJson(chapterSchema(1, 4, 3), JSON.stringify({ ...chapter, shots: [shot, shot] })).ok).toBe(false);
  });

  it('shows every shot in the reply format', () => {
    const format = chapterSystemPrompt(15, 3).split('"shots": [')[1]!.split(']')[0]!;
    expect(format.match(/"caption"/g)).toHaveLength(3);
  });
});

describe('prompts', () => {
  it('gives longer clips room for an action and what it leads to', () => {
    expect(sceneSystemPrompt(12)).toContain('12 seconds is room for one moment that unfolds');
    expect(sceneSystemPrompt(12)).not.toContain('beats');
    expect(sceneSystemPrompt(12)).toContain('80 to 140 words');
    expect(sceneSystemPrompt(8)).toContain('8 seconds is short');
  });

  it('marks the custom idea as data and tells the director where it is in the arc', () => {
    const prompt = sceneUserPrompt(
      sceneRequest({ sceneNumber: 4, choice: { kind: 'custom', text: 'the puppy learns to fly' } }),
    );
    expect(prompt).toContain('<family_idea>the puppy learns to fly</family_idea>');
    expect(prompt).toContain('Scene 4 of 6');
    expect(prompt).toContain('The story must end by scene 6');
  });

  it('covers the whole arc', () => {
    const beats = [1, 2, 3, 4, 5, 6].map((n) => arcBeat(n, 6).split('.')[0]);
    expect(beats).toEqual(['Opening hook', 'Rising adventure', 'Twist', 'Climax setup', 'Climax', 'Warm resolution']);
  });

  it('adds a gentle Halloween note in late October', () => {
    expect(seasonNote('2026-10-17')).toContain('Halloween is 14 days away');
    expect(seasonNote('2026-07-01')).not.toContain('Halloween');
  });
});

describe('FakeDirector', () => {
  const director = new FakeDirector();

  async function playThrough(choiceIndex: number) {
    const scenes = [];
    const history: SceneRequest['history'] = [];
    let choice: SceneRequest['choice'] = null;
    let pathKey = 'root';
    for (let n = 1; n <= 6; n++) {
      const scene = await director.writeScene(sceneRequest({ sceneNumber: n, history: [...history], choice, pathKey }));
      scenes.push(scene);
      const label = scene.choices[choiceIndex] ?? null;
      history.push({ sceneNumber: n, summary: scene.summary, caption: scene.caption, choiceTaken: label });
      choice = label ? { kind: 'preset', text: label } : null;
      pathKey += `/${n}:${choiceIndex}`;
    }
    return scenes;
  }

  it('tells a six scene story that ends on the last scene', async () => {
    const scenes = await playThrough(0);
    scenes.slice(0, 5).forEach((scene) => {
      expect(scene.isEnding).toBe(false);
      expect(scene.choices).toHaveLength(2);
      expect(scene.choices[0]).not.toBe(scene.choices[1]);
    });
    expect(scenes[5]!.isEnding).toBe(true);
    expect(scenes[5]!.choices).toEqual([]);
  });

  it('references the chosen path and keeps text short and dash free', async () => {
    const scenes = await playThrough(1);
    const taken = scenes[0]!.choices[1]!.toLowerCase();
    expect(scenes[1]!.caption.toLowerCase()).toContain(taken);
    for (const scene of scenes) {
      expect(scene.caption.length).toBeLessThanOrEqual(90);
      for (const text of [scene.caption, scene.summary, scene.videoPrompt, ...scene.choices]) {
        expect(hasDash(text)).toBe(false);
      }
    }
  });

  it('varies choices between scenes and is deterministic', async () => {
    const first = await playThrough(0);
    const again = await playThrough(0);
    expect(again).toEqual(first);
    const pairs = new Set(first.slice(0, 5).map((scene) => scene.choices.join('|')));
    expect(pairs.size).toBeGreaterThan(2);
  });

  it('rotates six distinct daily ideas by date', async () => {
    const today = await director.planIdeas('2026-10-17', 6);
    const tomorrow = await director.planIdeas('2026-10-18', 6);
    expect(new Set(today.map((idea) => idea.title)).size).toBe(6);
    expect(today.map((idea) => idea.title)).not.toEqual(tomorrow.map((idea) => idea.title));
    const avoided = await director.planIdeas('2026-10-17', 2, [today[0]!.title]);
    expect(avoided.map((idea) => idea.title)).not.toContain(today[0]!.title);
  });

  it('builds a bible from a family prompt', async () => {
    const result = await director.createBible({
      prompt: 'a robot who wants to dance',
      moods: ['funny'],
      audience: 'family',
      totalScenes: 6,
    });
    expect(result.title).toBe('A Robot Who Wants to');
    expect(result.audience).toBe('family');
    expect(result.characters.length).toBeGreaterThan(0);
  });
});

describe('chapter clean up', () => {
  it('drops a copied shot label from captions and prompts', async () => {
    const { sanitizeChapter } = await import('../src/engine/scenes');
    const clean = sanitizeChapter(
      {
        summary: 'They chased the stardust.',
        shots: [{ caption: 'Shot 1: Nico runs.', videoPrompt: 'Shot 1. A boy runs across the sky.' }],
        choices: [],
        isEnding: true,
        newCharacters: [],
      },
      4,
      4,
    );
    expect(clean.shots[0]).toEqual({ caption: 'Nico runs.', videoPrompt: 'A boy runs across the sky.' });
  });
});
