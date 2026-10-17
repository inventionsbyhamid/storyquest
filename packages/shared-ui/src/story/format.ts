import type { Audience, ChoiceStat, Mood } from '@storyquest/contracts';
import { messages } from './messages';

export function formatCount(value: number): string {
  const digits = String(Math.max(0, Math.round(value)));
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return out;
}

export function formatPlays(plays: number): string {
  if (plays <= 0) return 'New tonight';
  return `${formatCount(plays)} played`;
}

export function formatMadeIn(generationMs: number | null | undefined): string | null {
  if (generationMs == null || !Number.isFinite(generationMs) || generationMs <= 0) return null;
  const seconds = generationMs / 1000;
  return seconds < 60 ? `Made in ${seconds.toFixed(1)} s` : `Made in ${Math.round(seconds)} s`;
}

export function formatFolio(sceneNumber: number, totalScenes: number): string {
  return totalScenes > 0 ? `${sceneNumber} / ${totalScenes}` : String(sceneNumber);
}

export function formatSceneProgress(sceneNumber: number, totalScenes: number): string {
  return totalScenes > 0 ? `Scene ${sceneNumber} of ${totalScenes}` : `Scene ${sceneNumber}`;
}

const quoted = (label: string) => `\u201C${label.trim().replace(/[.!?]+$/, '')}\u201D`;

export function formatRarestChoice(stat: ChoiceStat | null | undefined): string | null {
  if (!stat) return null;
  const label = quoted(stat.label);
  if (stat.custom) return `Only your family went with ${label}`;
  if (stat.percent < 1) return `Fewer than 1% of families chose ${label}`;
  const percent = Math.round(stat.percent);
  if (percent <= 50) return `Only ${percent}% of families chose ${label}`;
  return `${percent}% of families also chose ${label}`;
}

export function formatEndingsDiscovered(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? '1 ending discovered so far' : `${formatCount(count)} endings discovered so far`;
}

export function formatFamiliesPlayed(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? '1 family played this story' : `${formatCount(count)} families played this story`;
}

const MOOD_LABELS: Record<Mood, string> = {
  funny: 'Funny',
  adventure: 'Adventure',
  cozy: 'Cozy',
  mystery: 'Mystery',
  spooky: 'A little spooky',
};

export const MOODS: Mood[] = ['funny', 'adventure', 'cozy', 'mystery', 'spooky'];

export function moodLabel(mood: Mood): string {
  return MOOD_LABELS[mood];
}

const AUDIENCE_LABELS: Record<Audience, string> = {
  kids: 'Kids',
  family: 'Family',
  grownups: 'Grown ups',
};

export const AUDIENCES: Audience[] = ['kids', 'family', 'grownups'];

export function audienceLabel(audience: Audience): string {
  return AUDIENCE_LABELS[audience];
}

const AUDIENCE_FACTS: Record<Audience, string> = {
  kids: 'For kids',
  family: 'For families',
  grownups: 'For grown ups',
};

export function audienceFact(audience: Audience): string {
  return AUDIENCE_FACTS[audience];
}

export interface TextCheck {
  ok: boolean;
  text: string;
  message: string | null;
}

export function checkPromptText(raw: string, min: number, max: number): TextCheck {
  const text = raw.trim();
  if (text.length < min) return { ok: false, text, message: messages.promptTooShort };
  if (text.length > max) return { ok: false, text, message: messages.promptTooLong };
  return { ok: true, text, message: null };
}

export const PROMPT_LIMITS = { min: 3, max: 240 };
export const CUSTOM_CHOICE_LIMITS = { min: 2, max: 200 };
