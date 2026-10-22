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

/** The provider turned the request down before doing any work, so nothing was billed. */
export class VideoNotBilled extends Error {
  override name = 'VideoNotBilled';
}

/** The provider account is out of credit. Nothing was rendered or billed. */
export class VideoOutOfCredit extends VideoNotBilled {
  override name = 'VideoOutOfCredit';
}

/** The provider's safety check turned the prompt down. If it happened after the job started, it may still be billed. */
export class VideoRejected extends Error {
  override name = 'VideoRejected';

  constructor(
    message: string,
    readonly billed = false,
  ) {
    super(message);
  }
}
