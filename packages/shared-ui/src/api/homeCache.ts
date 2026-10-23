import { StorySummary, TodayResponse } from '@storyquest/contracts';
import { loadStore } from './deviceId';

const STORAGE_KEY = 'storyquest.home';

export interface HomeSnapshot {
  today: TodayResponse;
  stories: StorySummary[];
}

let reading: Promise<HomeSnapshot | null> | null = null;

// The last Home this TV showed, so the next launch has stories on screen while fresh ones load.
export function readHomeCache(): Promise<HomeSnapshot | null> {
  if (!reading) {
    reading = (async () => {
      try {
        const text = await loadStore()?.getItem(STORAGE_KEY);
        if (!text) return null;
        const saved = JSON.parse(text) as { today?: unknown; stories?: unknown };
        const today = TodayResponse.safeParse(saved.today);
        const stories = StorySummary.array().safeParse(saved.stories);
        return today.success && stories.success ? { today: today.data, stories: stories.data } : null;
      } catch {
        return null;
      }
    })();
  }
  return reading;
}

export function saveHomeCache(snapshot: HomeSnapshot): void {
  reading = Promise.resolve(snapshot);
  try {
    loadStore()
      ?.setItem(STORAGE_KEY, JSON.stringify(snapshot))
      .catch(() => undefined);
  } catch {
    // Home still works without the copy.
  }
}
