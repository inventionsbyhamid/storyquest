import type { ErrorCode } from '@storyquest/contracts';

// Every message here can reach a family's TV screen, so: friendly, short, no dashes.
export const MESSAGES = {
  badRequest: 'That request did not look right.',
  missingDevice: 'A device id is required.',
  notFound: 'We could not find that.',
  staleChoice: 'That choice is no longer the current step of this story.',
  notReady: 'This scene is still being made. Please wait a moment.',
  notAnEnding: 'This story has not reached its ending yet.',
  storyFinished: 'This story has already finished.',
  atEnding: 'This story has already reached its ending.',
  noSuchChoice: 'That choice does not exist.',
  unsafeInput: "Let's keep the story friendly for everyone. Please try a different idea.",
  customLimit: 'You have made lots of new scenes today. Pick one of the story choices, and new ideas open again tomorrow.',
  budget:
    'The story studio has made all its new scenes for today. Stories you have already seen still play, and new scenes are back tomorrow.',
  sceneFailed: 'This scene could not be made. Please try another choice.',
  sceneUnsafe: 'This part of the story did not turn out right. Please try another choice.',
  rateLimited: 'That was a lot of requests. Please wait a moment and try again.',
  internal: 'Something went wrong on our side. Please try again.',
  unauthorized: 'That token is not valid.',
} as const;

export class AppError extends Error {
  override name = 'AppError';

  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string = MESSAGES.badRequest) => new AppError('bad_request', 400, message);
export const notFound = (message: string = MESSAGES.notFound) => new AppError('not_found', 404, message);
export const conflict = (message: string) => new AppError('bad_request', 409, message);
export const notReady = (message: string = MESSAGES.notReady) => new AppError('not_ready', 409, message);
export const unsafeInput = () => new AppError('unsafe_input', 422, MESSAGES.unsafeInput);
export const budgetExhausted = () => new AppError('budget_exhausted', 429, MESSAGES.budget);
export const rateLimited = (message: string = MESSAGES.rateLimited) => new AppError('rate_limited', 429, message);

/** A failure while generating a scene. Non retryable ones fail the node straight away. */
export class GenerationError extends Error {
  override name = 'GenerationError';

  constructor(
    readonly code: 'budget_exhausted' | 'unsafe_output',
    readonly userMessage: string,
    detail?: string,
  ) {
    super(detail ?? userMessage);
  }
}
