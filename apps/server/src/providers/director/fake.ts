import type { Bible, Character } from '../../domain';
import { clipText, lowerFirst, provisionalTitle, sanitizeUserText } from '../../text';
import { TEMPLATES, type StoryTemplate } from './templates';
import type { BibleRequest, Director, Scene, SceneRequest } from './types';

const SHOTS = [
  'wide establishing shot, slow push in',
  'medium shot, gentle handheld drift',
  'low angle hero shot, slow tilt up',
  'over the shoulder shot, smooth dolly forward',
  'close up on faces, soft focus pull',
  'sweeping crane shot rising up',
];

export function hashString(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function templateFor(bible: Bible): StoryTemplate {
  return (
    TEMPLATES.find((t) => t.title === bible.title || t.setting === bible.setting) ??
    TEMPLATES[hashString(bible.title) % TEMPLATES.length]!
  );
}

function toBible(template: StoryTemplate): Bible {
  return {
    title: template.title,
    logline: template.logline,
    audience: template.audience,
    moods: template.moods,
    artStyle: template.artStyle,
    setting: template.setting,
    tone: template.tone,
    characters: template.characters,
  };
}

/**
 * A deterministic director that tells small coherent stories from built in
 * templates. Same tree and path in, same scene out, so tests and demos are stable.
 */
export class FakeDirector implements Director {
  readonly name = 'fake';

  async writeScene(request: SceneRequest): Promise<Scene> {
    const template = templateFor(request.bible);
    const random = seededRandom(hashString(`${request.treeId}|${request.pathKey}|${request.stricter ? 1 : 0}`));
    const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)]!;

    const { sceneNumber, totalScenes } = request;
    const isEnding = sceneNumber >= totalScenes;
    const cast: Character[] = request.cast.length ? request.cast : template.characters;
    const hero = cast[0]!;
    const friend = cast[1] ?? hero;
    const place = template.places[Math.min(sceneNumber - 1, template.places.length - 1)]!;
    const chosen = request.choice?.text ?? '';
    const tookChoice =
      request.choice?.kind === 'custom'
        ? `tries the family's idea: ${chosen.replace(/[.!?]+$/, '')}`
        : `decides to ${lowerFirst(chosen)}`;

    let caption: string;
    let summary: string;
    let action: string;
    if (sceneNumber === 1) {
      const discovery = pick(template.discoveries);
      caption = `${hero.name} finds ${discovery}.`;
      summary = `${hero.name} and ${friend.name} discovered ${discovery} in ${place}. Their adventure began right there.`;
      action = `${hero.name} spots ${discovery} and gasps while ${friend.name} leans in close`;
    } else if (isEnding) {
      const ending = pick(template.endings);
      caption = `${hero.name} and ${friend.name} ${ending}.`;
      summary = `${hero.name} ${tookChoice}, and everything came right in ${place}. ${hero.name} and ${friend.name} ${ending}.`;
      action = `${hero.name} and ${friend.name} ${ending}, smiling as the light turns golden`;
    } else {
      const trouble = pick(template.troubles);
      caption = `${hero.name} ${tookChoice}.`;
      summary = `In ${place}, ${hero.name} ${tookChoice}. Just then, ${trouble}.`;
      action = `${hero.name} ${tookChoice} while ${friend.name} follows, and suddenly ${trouble}`;
    }

    const castLines = cast
      .slice(0, 2)
      .map((character) => `${character.name}, ${character.description}.`)
      .join(' ');
    const videoPrompt = [
      `${template.artStyle}.`,
      castLines,
      `Setting: ${place}, scene ${sceneNumber} of ${totalScenes}.`,
      `Camera: ${pick(SHOTS)}.`,
      `Action: ${action}.`,
      `Sound: ${template.sound}, ${template.music}, ${hero.name} says "${pick(template.lines)}"`,
    ].join(' ');

    return {
      summary,
      caption: clipText(caption, 90),
      videoPrompt,
      choices: isEnding ? [] : this.choicesFor(template, sceneNumber, random),
      isEnding,
      newCharacters: [],
    };
  }

  private choicesFor(template: StoryTemplate, sceneNumber: number, random: () => number): string[] {
    const pool = template.choices;
    const first = (sceneNumber * 2 + Math.floor(random() * pool.length)) % pool.length;
    const second = (first + 1 + Math.floor(random() * (pool.length - 1))) % pool.length;
    return [pool[first]!, pool[second]!];
  }

  async createBible(request: BibleRequest): Promise<Bible> {
    const template = TEMPLATES[hashString(request.prompt) % TEMPLATES.length]!;
    const prompt = sanitizeUserText(request.prompt).replace(/[.!?]+$/, '');
    return {
      ...toBible(template),
      title: provisionalTitle(prompt),
      logline: clipText(`${prompt[0]?.toUpperCase() ?? ''}${prompt.slice(1)}.`, 120),
      audience: request.audience,
      moods: request.moods.length ? request.moods : template.moods,
    };
  }

  async planIdeas(date: string, count: number, avoidTitles: string[] = []): Promise<Bible[]> {
    const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
    const start = ((day % TEMPLATES.length) + TEMPLATES.length) % TEMPLATES.length;
    const rotated = [...TEMPLATES.slice(start), ...TEMPLATES.slice(0, start)];
    const avoid = new Set(avoidTitles);
    return rotated
      .filter((template) => !avoid.has(template.title))
      .slice(0, count)
      .map(toBible);
  }
}
