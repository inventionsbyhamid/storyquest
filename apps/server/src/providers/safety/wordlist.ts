import type { Audience } from '../../domain';
import type { SafetyChecker, SafetyContext, SafetyVerdict } from './types';

// A deliberately small local list. It catches the obvious cases offline;
// Bedrock Guardrails handles the subtle ones when it is configured.

const EVERYONE = [
  'porn', 'porno', 'pornography', 'sex', 'sexy', 'sexual', 'nude', 'nudes', 'naked', 'rape', 'raped', 'rapist',
  'molest', 'pedophile', 'paedophile', 'suicide', 'kill myself', 'kill yourself', 'self harm', 'cut myself',
  'cocaine', 'heroin', 'meth', 'overdose', 'behead', 'beheading', 'beheaded', 'dismember', 'dismembered',
  'gore', 'gory', 'torture', 'tortured', 'massacre', 'genocide', 'terrorist', 'terrorism', 'nazi', 'hitler',
  'swastika', 'school shooting', 'fuck', 'fucking', 'fucker', 'motherfucker', 'shit', 'bullshit', 'bitch',
  'cunt', 'whore', 'slut', 'asshole', 'bastard', 'nigger', 'nigga', 'faggot', 'fag', 'retard', 'retarded',
];

const NOT_FOR_KIDS = [
  'kill', 'kills', 'killed', 'killing', 'killer', 'murder', 'murdered', 'murderer', 'blood', 'bloody',
  'gun', 'guns', 'pistol', 'rifle', 'shoot', 'shooting', 'shot dead', 'bomb', 'bombs', 'explode people',
  'corpse', 'dead body', 'stab', 'stabbed', 'stabbing', 'drunk', 'beer', 'vodka', 'whisky', 'whiskey',
  'cigarette', 'cigarettes', 'vape', 'weed', 'damn', 'hell', 'demon', 'satan', 'zombie', 'zombies',
];

const NOT_FOR_FAMILY = [
  'murder', 'murdered', 'murderer', 'corpse', 'dead body', 'stab', 'stabbed', 'stabbing', 'shot dead',
  'drunk', 'vodka', 'cigarette', 'cigarettes', 'vape', 'weed', 'bloodbath',
];

const INSTRUCTION_ATTACKS = [
  /\bignore\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier)\s+(instructions|rules|prompts?)\b/,
  /\bsystem\s+prompt\b/,
  /\byou\s+are\s+now\b/,
  /\bjailbreak\b/,
  /\bdeveloper\s+mode\b/,
];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };

export function normalizeForMatching(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .replace(/[013457@$]/g, (ch) => LEET[ch] ?? ch)
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compile(words: string[]): RegExp {
  const escaped = words.map((word) => word.replace(/\s+/g, '\\s+'));
  return new RegExp(`\\b(${escaped.join('|')})\\b`);
}

const PATTERNS: Record<Audience, RegExp> = {
  kids: compile([...EVERYONE, ...NOT_FOR_KIDS]),
  family: compile([...EVERYONE, ...NOT_FOR_FAMILY]),
  grownups: compile(EVERYONE),
};

export class WordlistSafety implements SafetyChecker {
  readonly name = 'wordlist';

  async check(text: string, context: SafetyContext): Promise<SafetyVerdict> {
    const lowered = text.toLowerCase();
    if (context.source === 'input' && INSTRUCTION_ATTACKS.some((pattern) => pattern.test(lowered))) {
      return { ok: false, reason: 'instructions' };
    }
    const match = PATTERNS[context.audience].exec(normalizeForMatching(text));
    return match ? { ok: false, reason: `word:${match[1]}` } : { ok: true };
  }
}
