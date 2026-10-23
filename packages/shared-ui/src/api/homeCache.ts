import { StorySummary, TodayResponse } from '@storyquest/contracts';
import { loadStore } from './deviceId';

const STORAGE_KEY = 'storyquest.home';

export interface HomeSnapshot {
  today: TodayResponse;
  stories: StorySummary[];
}

let reading: Promise<HomeSnapshot | null> | null = null;
let latest: HomeSnapshot | null = null;

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
        latest = today.success && stories.success ? { today: today.data, stories: stories.data } : null;
      } catch {
        latest = null;
      }
      return latest;
    })();
  }
  return reading;
}

// The saved Home if the read started at launch has already finished, so Home can draw it in its first frame.
export function peekHomeCache(): HomeSnapshot | null {
  return latest;
}

export function saveHomeCache(snapshot: HomeSnapshot): void {
  latest = snapshot;
  reading = Promise.resolve(snapshot);
  try {
    loadStore()
      ?.setItem(STORAGE_KEY, JSON.stringify(snapshot))
      .catch(() => undefined);
  } catch {
    // Home still works without the copy.
  }
}
