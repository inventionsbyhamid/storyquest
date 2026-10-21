const STORAGE_KEY = 'storyquest.deviceId';

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export function generateDeviceId(random: () => number = Math.random): string {
  let hex = '';
  for (let i = 0; i < 32; i++) hex += Math.floor(random() * 16).toString(16);
  return `tv_${hex}`;
}

export function loadStore(): KeyValueStore | null {
  try {
    // Loaded lazily: the storage module throws at import time when its native side is missing.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@react-native-async-storage/async-storage');
    const store = (mod?.default ?? mod) as KeyValueStore | undefined;
    return store && typeof store.getItem === 'function' ? store : null;
  } catch {
    return null;
  }
}

export async function readOrCreateDeviceId(
  store: KeyValueStore | null,
  create: () => string = generateDeviceId,
): Promise<string> {
  if (!store) return create();
  try {
    const existing = await store.getItem(STORAGE_KEY);
    if (existing) return existing;
  } catch {
    return create();
  }
  const id = create();
  try {
    await store.setItem(STORAGE_KEY, id);
  } catch {
    // Keep using the in memory id for this session.
  }
  return id;
}

let pending: Promise<string> | null = null;

export function getDeviceId(): Promise<string> {
  if (!pending) pending = readOrCreateDeviceId(loadStore());
  return pending;
}
