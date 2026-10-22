// A browser only starts loading a clip when it is played. Fetching the next one while the current
// clip plays fills the browser cache (clips are served immutable), so the switch starts at once.
const warmed = new Set<string>();

export function warmClip(url: string): void {
  if (warmed.has(url)) return;
  warmed.add(url);
  fetch(url, { priority: 'low' } as RequestInit)
    .then((response) => (response.ok ? response.arrayBuffer() : undefined))
    .catch(() => warmed.delete(url));
}
