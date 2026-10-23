import { describe, expect, it } from 'vitest';
import { ApiError } from './errors';
import { retryPatiently } from './patient';

function run(failures: ApiError[]) {
  const sleeps: number[] = [];
  let calls = 0;
  const result = retryPatiently(
    async () => {
      calls++;
      const failure = failures.shift();
      if (failure) throw failure;
      return 'home';
    },
    { signal: new AbortController().signal, sleep: async (ms) => void sleeps.push(ms) },
  );
  return { result, sleeps, calls: () => calls };
}

describe('retryPatiently', () => {
  it('keeps trying while the TV is offline and loads once it is back', async () => {
    const offline = () => new ApiError('network', 'Network request failed');
    const { result, sleeps } = run(Array.from({ length: 8 }, offline));
    await expect(result).resolves.toBe('home');
    expect(sleeps).toEqual([1000, 2000, 4000, 5000, 5000, 5000, 5000, 5000]);
  });

  it('waits as long as a busy server asks', async () => {
    const { result, sleeps } = run([new ApiError('rate_limited', 'busy', 429, 30000)]);
    await expect(result).resolves.toBe('home');
    expect(sleeps).toEqual([30000]);
  });

  it('gives up on errors that trying again will not fix', async () => {
    const { result, calls } = run([new ApiError('invalid_response', 'bad')]);
    await expect(result).rejects.toMatchObject({ code: 'invalid_response' });
    expect(calls()).toBe(1);
  });
});
