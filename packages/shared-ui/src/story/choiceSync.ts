import type { ChooseRequest } from '@storyquest/contracts';
import type { ApiClient } from '../api/client';
import { sleep as defaultSleep } from '../api/sleep';

export interface SerialQueue {
  run<T>(task: () => Promise<T>): Promise<T>;
  idle(): Promise<void>;
}

// The server only accepts a choice from the story's current scene, so choices must arrive in order.
export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(task, task);
      tail = result.catch(() => undefined);
      return result;
    },
    idle() {
      return tail.then(() => undefined);
    },
  };
}

interface SendChoiceOptions {
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

// Sends a choice the app already acted on. Retries once, and treats a lost response as success
// when the server's story already points at the scene we are playing.
export async function sendChoice(
  client: Pick<ApiClient, 'choose' | 'getStory'>,
  storyId: string,
  request: ChooseRequest,
  expectedNodeId: string,
  { retryDelayMs = 700, sleep = defaultSleep }: SendChoiceOptions = {},
): Promise<void> {
  const alreadyThere = async () => {
    try {
      const story = await client.getStory(storyId, { retries: 0 });
      return story.currentNodeId === expectedNodeId;
    } catch {
      return false;
    }
  };

  for (let attempt = 1; ; attempt++) {
    try {
      await client.choose(storyId, request);
      return;
    } catch (error) {
      if (await alreadyThere()) return;
      if (attempt >= 2) throw error;
      await sleep(retryDelayMs);
    }
  }
}
