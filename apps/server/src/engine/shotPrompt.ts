import type { Character, ShotDraft } from '../domain';

// The layout follows MiniMax's guide for H3 prompts: a line that ties the clip to its first
// frame, one description of the shot, then the sound. Music is left out on purpose, so the
// clips of a chapter join without the score jumping every 15 seconds.
const FIRST_FRAME = 'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.';
const LOOKS_LOCKED = 'Every character keeps exactly the face, hair, colours, size and clothes described here for the whole clip.';
const ONE_TAKE = 'One continuous shot with no cuts.';
const REAL_TIME = 'Everyone moves briskly and with purpose and speaks at a natural conversational speed, with no slow motion, no long pauses and no idle staring.';
const NO_TEXT = 'No subtitles, captions or written words anywhere on screen.';
const DEFAULT_VOICE = 'a clear, friendly voice';
const DEFAULT_SOUND = 'Soft ambience of the place and the sounds of the action.';

export interface ShotContext {
  artStyle: string;
  /** Everyone in the story so far, in a fixed order, so each character keeps one speaker id. */
  characters: Character[];
  /** False only for the very first clip of a story, which has no frame to start from. */
  firstFrame: boolean;
}

const sentence = (text: string) => {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return !trimmed || /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

// "A quick, excited voice." reads as "a quick, excited voice" inside a sentence.
const voiceOf = (character: Character) => {
  const voice = character.voice?.trim().replace(/[.!?,;:]+$/, '') || DEFAULT_VOICE;
  return /^an? /i.test(voice) ? voice[0]!.toLowerCase() + voice.slice(1) : voice;
};

const capitalise = (text: string) => `${text[0]!.toUpperCase()}${text.slice(1)}`;

// The video model links names to people poorly, so a character with a handle is called by it.
const called = (character: Character) => character.handle ?? character.name;
const subject = (character: Character) => (character.handle ? capitalise(character.handle) : character.name);

// Without this the model sometimes draws a character twice, or adds a stranger who looks like one.
const onlyThese = (people: Character[]) => {
  const names = people.map((c, i) => (i === 0 ? subject(c) : called(c)));
  if (names.length === 1) return `${names[0]} is the only character in the shot.`;
  const list = `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${list} are the only characters in the shot, and each appears exactly once.`;
};

const spoken = (text: string) =>
  sentence(text.replace(/[<>"“”]/g, '').trim());

function introduce(character: Character): string {
  const description = character.description.trim();
  // "Sergeant Okafor, a tall man" already names him; "Okafor is sergeant Okafor" reads like two people.
  const lead = description.split(/\s+/).slice(0, 3).join(' ').toLowerCase();
  const rest = lead.includes(character.name.toLowerCase())
    ? description
    : `${character.name} is ${description[0]!.toLowerCase()}${description.slice(1)}`;
  if (!character.handle) return sentence(rest);
  return `${sentence(rest)} In this description, ${fullName(character) ?? character.name} is called ${character.handle}.`;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const notInWord = (pattern: string) => `(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`;

// "Sergeant Okafor" and "the Captain" are the same person as "Okafor" and "Captain", so the title goes too.
const TITLES = (
  'Mr Mrs Ms Dr Sgt Miss Doctor Sergeant Captain Inspector Detective Professor Officer Chief Sir Lady ' +
  'Aunt Uncle Grandma Grandpa Granny King Queen Prince Princess'
).split(' ');
const PREFIX = `(?:[Tt]he )?(?:(?:${TITLES.map((t) => `[${t[0]}${t[0]!.toLowerCase()}]${t.slice(1)}`).join('|')})\\.? )?`;

// Spoken words stay as written. An apostrophe inside a word, as in "Wren's", is not a quote.
const QUOTED = `"[^"]*"|“[^”]*”|(?<!\\p{L})'(?:[^']|'(?=\\p{L}))*'(?!\\p{L})|‘(?:[^’]|’(?=\\p{L}))*’(?!\\p{L})`;

// "Edith Vane is a tall woman" or "Sergeant Okafor, a tall man" names them more fully than the name does.
function fullName(character: Character): string | null {
  const lead = /^([^,.;:!?]+?)(?:,| is )/.exec(character.description.trim())?.[1]?.trim();
  if (!lead || lead.length <= character.name.length || lead.split(/\s+/).length > 4) return null;
  return new RegExp(notInWord(escape(character.name)), 'u').test(lead) ? lead : null;
}

// Edith Vane may be written "Edith Vane", "Edith" or "Vane".
function aliases(character: Character): string[] {
  const full = fullName(character);
  const surname = full?.split(/\s+/).pop();
  return [full, character.name, surname && /^\p{Lu}/u.test(surname) ? surname : null].filter((name): name is string => Boolean(name));
}

// The director writes names in the action; each becomes that character's handle, the same in every clip.
function withHandles(action: string, characters: Character[]): { text: string; mentioned: Character[] } {
  const owners = new Map<string, Character>();
  for (const character of characters) {
    if (!character.handle) continue;
    for (const name of aliases(character)) if (!owners.has(name)) owners.set(name, character);
  }
  const mentioned: Character[] = [];
  if (!owners.size) return { text: action, mentioned };
  const names = [...owners.keys()].sort((a, b) => b.length - a.length).map(escape);
  const pattern = new RegExp(`(${QUOTED})|${notInWord(`(${PREFIX})(${names.join('|')})`)}`, 'gu');
  const text = action.replace(pattern, (match, quoted: string | undefined, prefix: string, name: string, offset: number) => {
    if (quoted) return match;
    const character = owners.get(name)!;
    if (!mentioned.includes(character)) mentioned.push(character);
    const starts = prefix.startsWith('The ') || /(^\s*|[.!?]["”')]*\s+)$/.test(action.slice(0, offset));
    return starts ? capitalise(character.handle!) : character.handle!;
  });
  return { text, mentioned };
}

export function composeShotPrompt(shot: ShotDraft, context: ShotContext): string {
  // A speaker or cast entry may be written as the full name, with a title, or as the handle.
  const find = (name: string) => {
    const wanted = name.trim().toLowerCase();
    const bare = wanted.replace(new RegExp(`^${PREFIX}`, 'i'), '');
    return (
      context.characters.find((c) => c.name.toLowerCase() === wanted) ??
      context.characters.find((c) => [c.name, fullName(c), c.handle].some((n) => n && [wanted, bare].includes(n.toLowerCase())))
    );
  };
  const lines = shot.dialogue
    .map((line) => ({ text: spoken(line.line), character: find(line.speaker) }))
    .filter((line): line is { text: string; character: Character } => Boolean(line.text && line.character));
  const action = withHandles(shot.action, context.characters);
  // Someone the action names is in the shot too, so they get introduced and counted.
  const people: Character[] = [];
  for (const character of [...shot.cast.map(find), ...lines.map((line) => line.character), ...action.mentioned]) {
    if (character && !people.includes(character)) people.push(character);
  }

  const said = lines.map(({ text, character }) => {
    const id = context.characters.indexOf(character) + 1;
    return `${subject(character)} (S${id}) says in ${voiceOf(character)}: <d>[English] ${text}</d>`;
  });
  const description = [
    '[Shot 1]',
    sentence(context.artStyle),
    ...people.map(introduce),
    sentence(action.text),
    /slow motion/i.test(shot.action) ? '' : REAL_TIME,
    ...said,
    people.length ? onlyThese(people) : '',
    people.length ? LOOKS_LOCKED : '',
    ONE_TAKE,
    NO_TEXT,
  ]
    .filter(Boolean)
    .join(' ');

  return [
    ...(context.firstFrame ? [FIRST_FRAME, ''] : []),
    `integrated_multimodal_description: ${description}`,
    `overall_soundscape: ${sentence(shot.sound) || DEFAULT_SOUND}`,
    'non_diegetic_music: N/A',
  ].join('\n');
}
