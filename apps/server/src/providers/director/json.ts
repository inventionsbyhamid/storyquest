import type { z } from 'zod';

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Pulls the first complete JSON object out of a model reply, tolerating code fences and stray prose. */
export function extractJsonObject(text: string): unknown {
  const unfenced = text.replace(/```(?:json)?/gi, '');
  const start = unfenced.indexOf('{');
  if (start === -1) throw new SyntaxError('no JSON object found in the reply');

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < unfenced.length; i++) {
    const ch = unfenced[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return JSON.parse(unfenced.slice(start, i + 1));
    }
  }
  throw new SyntaxError('the JSON object is not closed, the reply may have been cut off');
}

export function parseModelJson<S extends z.ZodTypeAny>(schema: S, text: string): ParseResult<z.output<S>> {
  let raw: unknown;
  try {
    raw = extractJsonObject(text);
  } catch (err) {
    return { ok: false, error: `Invalid JSON: ${(err as Error).message}` };
  }
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, value: result.data };
  const issues = result.error.issues
    .slice(0, 8)
    .map((issue) => `${issue.path.length ? issue.path.join('.') : 'reply'}: ${issue.message}`);
  return { ok: false, error: issues.join('; ') };
}
