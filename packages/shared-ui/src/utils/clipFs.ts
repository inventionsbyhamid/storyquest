export interface ClipFs {
  cacheDirectory: string | null;
  makeDirectoryAsync(uri: string, options: { intermediates: boolean }): Promise<void>;
  downloadAsync(url: string, fileUri: string, options: Record<string, unknown>): Promise<{ status: number }>;
  deleteAsync(uri: string, options: { idempotent: boolean }): Promise<void>;
}

// Clips are only downloaded ahead on Vega; other platforms stream them.
export function loadClipFs(): ClipFs | null {
  return null;
}
