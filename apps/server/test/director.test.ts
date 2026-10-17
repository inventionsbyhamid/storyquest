import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import type { Bible } from '../src/domain';
import { silentLogger } from '../src/log';
import { BedrockDirector, type MessagesClient } from '../src/providers/director/bedrock';
import { FakeDirector } from '../src/providers/director/fake';
import { extractJsonObject, parseModelJson } from '../src/providers/director/json';
import { arcBeat, sceneUserPrompt, seasonNote } from '../src/providers/director/prompts';
import { sceneSchema } from '../src/providers/director/schemas';
import { DirectorFormatError, DirectorRefusal, type SceneRequest } from '../src/providers/director/types';
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
    const parsed = parseModelJson(sceneSchema(3, 6), JSON.stringify({ ...goodScene, isEnding: true, choices: ['Only one'] }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain('isEnding');
      expect(parsed.error).toContain('exactly 2 choices');
    }
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
  const client: MessagesClient = {
    messages: {
      async create(body) {
        requests.push(structuredClone(body));
        const next = replies.shift();
        if (!next) throw new Error('no more stubbed replies');
        return next;
      },
    },
  };
  return { client, requests };
}

describe('BedrockDirector', () => {
  const options = { model: 'anthropic.claude-opus-5-5', effort: 'low' as const, sceneSeconds: 8 };

  it('sends a cached system prompt, the effort and no thinking parameter', async () => {
    const { client, requests } = stubClient([reply(JSON.stringify(goodScene))]);
    const director = new BedrockDirector(client, options, silentLogger);
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
  });

  it('reads fenced JSON from the text blocks only', async () => {
    const { client } = stubClient([reply(`\`\`\`json\n${JSON.stringify(goodScene)}\n\`\`\``)]);
    const scene = await new BedrockDirector(client, options, silentLogger).writeScene(sceneRequest());
    expect(scene.choices).toEqual(goodScene.choices);
  });

  it('retries once with the validation error fed back', async () => {
    const { client, requests } = stubClient([
      reply('{"summary": "too short"}'),
      reply(JSON.stringify(goodScene)),
    ]);
    const scene = await new BedrockDirector(client, options, silentLogger).writeScene(sceneRequest());
    expect(scene.summary).toBe(goodScene.summary);
    expect(requests).toHaveLength(2);
    const second = requests[1]!.messages;
    expect(second).toHaveLength(3);
    expect(second[1]!.role).toBe('assistant');
    expect(Array.isArray(second[1]!.content)).toBe(true);
    expect(String(second[2]!.content)).toContain('could not be used');
    expect(String(second[2]!.content)).toContain('caption');
  });

  it('gives up after two broken replies', async () => {
    const { client } = stubClient([reply('nope'), reply('{"still": "broken"')]);
    await expect(new BedrockDirector(client, options, silentLogger).writeScene(sceneRequest())).rejects.toBeInstanceOf(
      DirectorFormatError,
    );
  });

  it('treats a refusal as unsafe', async () => {
    const { client } = stubClient([reply('', 'refusal')]);
    await expect(new BedrockDirector(client, options, silentLogger).writeScene(sceneRequest())).rejects.toBeInstanceOf(
      DirectorRefusal,
    );
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
    const result = await new BedrockDirector(client, options, silentLogger).createBible({
      prompt: 'a shy dragon who bakes',
      moods: ['cozy'],
      audience: 'kids',
      totalScenes: 6,
    });
    expect(result).toMatchObject({ title: 'The Shy Dragon', audience: 'kids', moods: ['cozy'] });
  });
});

describe('prompts', () => {
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
    const result = await director.createBible({ prompt: 'a robot who wants to dance', moods: ['funny'], audience: 'family', totalScenes: 6 });
    expect(result.title).toBe('A Robot Who Wants to');
    expect(result.audience).toBe('family');
    expect(result.characters.length).toBeGreaterThan(0);
  });
});
