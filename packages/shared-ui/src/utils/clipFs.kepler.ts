export interface ClipFs {
  cacheDirectory: string | null;
  makeDirectoryAsync(uri: string, options: { intermediates: boolean }): Promise<void>;
  downloadAsync(url: string, fileUri: string, options: Record<string, unknown>): Promise<{ status: number }>;
  deleteAsync(uri: string, options: { idempotent: boolean }): Promise<void>;
}

let loaded: ClipFs | null | undefined;

// Uses the Vega file system module directly: the package entry point needs expo-modules-core,
// which the Vega app does not ship. Loaded lazily so a missing native module only turns caching off.
export function loadClipFs(): ClipFs | null {
  if (loaded !== undefined) return loaded;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@amazon-devices/expo-file-system/build/ExponentFileSystem.kepler');
    const fs = (mod?.default ?? mod) as ClipFs;
    loaded = fs && typeof fs.downloadAsync === 'function' ? fs : null;
  } catch (error) {
    console.warn('[ClipCache] file system unavailable, clips will stream', error);
    loaded = null;
  }
  return loaded;
}
