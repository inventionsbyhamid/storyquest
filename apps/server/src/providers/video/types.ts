export interface RenderRequest {
  prompt: string;
  /** Short on screen line, only used by the fake to label its preview clips. */
  caption: string;
  seconds: number;
  /** Last frame of the previous clip. Absent for the opening scene. */
  startFramePath: string | null;
  /** Where the provider writes the mp4. */
  outPath: string;
}

export interface RenderResult {
  billedSeconds: number;
  inferenceMs: number | null;
}

export interface VideoProvider {
  readonly name: string;
  render(request: RenderRequest): Promise<RenderResult>;
}

export class VideoRejected extends Error {
  override name = 'VideoRejected';
}
