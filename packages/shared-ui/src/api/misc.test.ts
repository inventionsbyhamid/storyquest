import { describe, expect, it } from 'vitest';
import { generateDeviceId, readOrCreateDeviceId } from './deviceId';
import { ApiError, isApiError, isTransient } from './errors';
import { resolveMediaUrl } from './media';

describe('resolveMediaUrl', () => {
  const base = 'https://api.example.test';

  it('keeps absolute urls', () => {
    expect(resolveMediaUrl('https://cdn.test/a.mp4', base)).toBe('https://cdn.test/a.mp4');
  });

  it('joins relative urls to the api base', () => {
    expect(resolveMediaUrl('/media/a.mp4', base)).toBe('https://api.example.test/media/a.mp4');
    expect(resolveMediaUrl('media/a.mp4', base)).toBe('https://api.example.test/media/a.mp4');
  });

  it('handles empty values', () => {
    expect(resolveMediaUrl(null, base)).toBeNull();
    expect(resolveMediaUrl('', base)).toBeNull();
  });
});

describe('device id', () => {
  it('generates a stable looking id', () => {
    expect(generateDeviceId(() => 0.5)).toBe(`tv_${'8'.repeat(32)}`);
    expect(generateDeviceId()).toMatch(/^tv_[0-9a-f]{32}$/);
  });

  it('reuses a stored id', async () => {
    const store = { getItem: async () => 'tv_saved', setItem: async () => undefined };
    await expect(readOrCreateDeviceId(store, () => 'tv_new')).resolves.toBe('tv_saved');
  });

  it('creates and saves a new id', async () => {
    const saved: string[] = [];
    const store = { getItem: async () => null, setItem: async (_k: string, v: string) => void saved.push(v) };
    await expect(readOrCreateDeviceId(store, () => 'tv_new')).resolves.toBe('tv_new');
    expect(saved).toEqual(['tv_new']);
  });

  it('falls back to memory when storage fails', async () => {
    const broken = {
      getItem: async () => {
        throw new Error('no storage');
      },
      setItem: async () => undefined,
    };
    await expect(readOrCreateDeviceId(broken, () => 'tv_mem')).resolves.toBe('tv_mem');
    await expect(readOrCreateDeviceId(null, () => 'tv_mem')).resolves.toBe('tv_mem');

    const readOnly = {
      getItem: async () => null,
      setItem: async () => {
        throw new Error('full');
      },
    };
    await expect(readOrCreateDeviceId(readOnly, () => 'tv_mem')).resolves.toBe('tv_mem');
  });
});

describe('errors', () => {
  it('recognises api errors and transient codes', () => {
    const error = new ApiError('rate_limited', 'slow down', 429);
    expect(isApiError(error)).toBe(true);
    expect(isApiError(new Error('x'))).toBe(false);
    expect(isTransient(error)).toBe(true);
    expect(isTransient(new ApiError('unsafe_input', 'no'))).toBe(false);
  });
});
