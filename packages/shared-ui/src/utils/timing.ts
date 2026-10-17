let choiceAt: number | null = null;

// Logs one line per step of a choice so `vega device start-log-stream` shows the breakdown.
export function markChoice(detail: string): void {
  choiceAt = Date.now();
  console.info(`[Timing] choose pressed ${detail}`);
}

export function logTiming(step: string, detail = ''): void {
  const since = choiceAt === null ? '' : ` +${Date.now() - choiceAt}ms`;
  console.info(`[Timing] ${step}${since}${detail ? ` ${detail}` : ''}`);
}

export function endChoiceTiming(): number | null {
  if (choiceAt === null) return null;
  const elapsed = Date.now() - choiceAt;
  choiceAt = null;
  return elapsed;
}
