import { z } from 'zod';
import { Audience, Mood } from '@storyquest/contracts';

const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

export const CharacterSchema = z.object({
  name: z.string().trim().min(1).max(40),
  description: z.string().trim().min(10).max(400),
});

// Some models write a character as "Name: description" instead of an object.
const LooseCharacterSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const colon = value.indexOf(':');
  return colon > 0 ? { name: value.slice(0, colon).trim(), description: value.slice(colon + 1).trim() } : value;
}, CharacterSchema);

export const BibleDraftSchema = z.object({
  title: z.string().trim().min(2).max(60),
  logline: z.string().trim().min(10).max(220),
  artStyle: z.string().trim().min(10).max(300),
  setting: z.string().trim().min(10).max(400),
  tone: z.string().trim().min(2).max(120),
  characters: z.array(LooseCharacterSchema).min(1).max(5),
});
export type BibleDraft = z.output<typeof BibleDraftSchema>;

export const PlannedIdeaSchema = BibleDraftSchema.extend({
  audience: z.enum(Audience.options),
  moods: z.array(z.enum(Mood.options)).min(1).max(3),
});

export function ideaPlanSchema(count: number) {
  return z.object({ ideas: z.array(PlannedIdeaSchema).min(count) });
}

export function sceneSchema(sceneNumber: number, totalScenes: number) {
  const isLast = sceneNumber >= totalScenes;
  return z
    .object({
      summary: z.string().trim().min(10).max(700),
      caption: z.string().trim().min(2).max(140),
      videoPrompt: z.string().trim().min(80).max(2000),
      choices: z
        .array(
          z
            .string()
            .trim()
            .min(2)
            .max(60)
            .refine((label) => wordCount(label) <= 6, 'each choice must be at most 5 words'),
        )
        .max(2),
      isEnding: z.boolean(),
      newCharacters: z.array(LooseCharacterSchema).max(3).optional().default([]),
    })
    .superRefine((scene, ctx) => {
      // The final scene is forced to be an ending later, so only the middle scenes are strict.
      if (isLast) return;
      if (scene.isEnding) {
        ctx.addIssue({
          code: 'custom',
          path: ['isEnding'],
          message: `must be false, this is scene ${sceneNumber} of ${totalScenes}`,
        });
      }
      if (scene.choices.length !== 2) {
        ctx.addIssue({ code: 'custom', path: ['choices'], message: 'must contain exactly 2 choices' });
      } else if (scene.choices[0]!.toLowerCase() === scene.choices[1]!.toLowerCase()) {
        ctx.addIssue({ code: 'custom', path: ['choices'], message: 'the two choices must be different' });
      }
    });
}
