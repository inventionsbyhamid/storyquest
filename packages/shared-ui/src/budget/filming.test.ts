import { afterEach, describe, expect, it } from 'vitest';
import { isFilmingPaused, markBudgetExhausted, reportFilmingPaused, resetFilming, subscribeFilming } from './filming';

describe('filming paused signal', () => {
  afterEach(resetFilming);

  it('follows the server and sticks once a budget refusal was seen', () => {
    const seen: boolean[] = [];
    const stop = subscribeFilming(() => seen.push(isFilmingPaused()));
    expect(isFilmingPaused()).toBe(false);
    reportFilmingPaused(undefined);
    reportFilmingPaused(true);
    reportFilmingPaused(true);
    reportFilmingPaused(false);
    expect(seen).toEqual([true, false]);

    markBudgetExhausted();
    markBudgetExhausted();
    reportFilmingPaused(false);
    expect(isFilmingPaused()).toBe(true);
    expect(seen).toEqual([true, false, true]);
    stop();
  });
});
