import type { Character, ShotDraft } from '../domain';

// The layout follows MiniMax's guide for H3 prompts: a line that ties the clip to its first
// frame, one description of the shot, then the sound. Music is left out on purpose, so the
// clips of a chapter join without the score jumping every 15 seconds.
const FIRST_FRAME = 'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.';
const LOOKS_LOCKED = 'Every character keeps exactly the face, hair, colours, size and clothes described here for the whole clip.';
const ONE_TAKE = 'One continuous shot with no cuts.';
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

const spoken = (text: string) =>
  sentence(text.replace(/[<>"“”]/g, '').trim());

function introduce(character: Character): string {
  const description = character.description.trim();
  const rest = description.toLowerCase().startsWith(character.name.toLowerCase())
    ? description
    : `${character.name} is ${description[0]!.toLowerCase()}${description.slice(1)}`;
  return sentence(rest);
}

export function composeShotPrompt(shot: ShotDraft, context: ShotContext): string {
  const find = (name: string) => context.characters.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
  const lines = shot.dialogue
    .map((line) => ({ text: spoken(line.line), character: find(line.speaker) }))
    .filter((line): line is { text: string; character: Character } => Boolean(line.text && line.character));
  const people: Character[] = [];
  for (const character of [...shot.cast.map(find), ...lines.map((line) => line.character)]) {
    if (character && !people.includes(character)) people.push(character);
  }

  const said = lines.map(({ text, character }) => {
    const id = context.characters.indexOf(character) + 1;
    return `${character.name} (S${id}) says in ${voiceOf(character)}: <d>[English] ${text}</d>`;
  });
  const description = [
    '[Shot 1]',
    sentence(context.artStyle),
    ...people.map(introduce),
    sentence(shot.action),
    ...said,
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
