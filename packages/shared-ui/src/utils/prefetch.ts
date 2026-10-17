import { Image } from 'react-native';

const requested = new Set<string>();
const MAX_TRACKED = 200;

export function prefetchImage(url: string | null | undefined): void {
  if (!url || requested.has(url)) return;
  if (requested.size > MAX_TRACKED) requested.clear();
  requested.add(url);
  try {
    Image.prefetch(url).catch(() => requested.delete(url));
  } catch {
    requested.delete(url);
  }
}
