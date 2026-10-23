let shown = false;
const waiting: Array<() => void> = [];

// Home calls this once it has something real on screen, so the app can lift its splash.
export function markHomeShown(): void {
  if (shown) return;
  shown = true;
  waiting.splice(0).forEach((resolve) => resolve());
}

export function whenHomeShown(): Promise<void> {
  return shown ? Promise.resolve() : new Promise((resolve) => waiting.push(resolve));
}
