// Whether new scenes can be filmed. The server says so on today and the wallet; any
// budget_exhausted answer during this session also counts, since caps do not lift mid session.
let serverPaused = false;
let exhaustedSeen = false;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

export function isFilmingPaused(): boolean {
  return serverPaused || exhaustedSeen;
}

export function reportFilmingPaused(paused: boolean | undefined): void {
  if (paused === undefined || paused === serverPaused) return;
  serverPaused = paused;
  emit();
}

export function markBudgetExhausted(): void {
  if (exhaustedSeen) return;
  exhaustedSeen = true;
  emit();
}

export function subscribeFilming(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetFilming(): void {
  serverPaused = false;
  exhaustedSeen = false;
  emit();
}
