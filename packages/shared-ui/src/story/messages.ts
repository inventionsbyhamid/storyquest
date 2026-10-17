import type { ApiErrorCode } from '../api/errors';

export type MessageContext = 'preset' | 'custom' | 'start' | 'today' | 'general';

export const messages = {
  pathClosed: 'That path could not be made. Pick the other one.',
  customFailed: 'That idea could not be filmed. Pick a choice or try another idea.',
  sceneWouldNotPlay: 'That scene would not play. Pick what happens next.',
  storyCouldNotStart: 'This story could not start. Try again in a moment.',
  slowScene: 'This scene is taking longer than usual. Try again.',
  promptTooShort: 'Add a few more words to your idea.',
  promptTooLong: 'That idea is too long. Try a shorter one.',
  movieAlmostReady: 'Your movie is still being made.',
  movieFailed: 'The movie could not be made this time.',
  choiceNotSaved: 'Your choice was not saved, but the story goes on.',
  purchaseCancelled: 'No purchase was made.',
  purchasesUnavailable: 'Purchases are not available on this TV right now.',
  purchaseInvalid: 'Amazon could not confirm that purchase, so no Sparks were added.',
  sparksPending: 'Your purchase went through. Your Sparks will show up shortly.',
  purchaseStillOpen: 'A purchase is still being finished. Try again in a moment.',
  reportThanks: 'Thanks. We removed this scene for your family and will review it.',
  reportFailed: 'The report could not be sent. Try again.',
  storyRemoved: 'Thanks for telling us. We took this story down and will review it. Pick another one from home.',
};

export function messageForError(code: ApiErrorCode | 'node_failed', context: MessageContext = 'general'): string {
  if (context === 'today' && code !== 'network' && code !== 'timeout') {
    return "Tonight's stories are not ready yet. Try again in a moment.";
  }
  switch (code) {
    case 'unsafe_input':
      return 'Try a different idea.';
    case 'payment_required':
      return 'You need more Sparks for that.';
    case 'purchase_invalid':
      return messages.purchaseInvalid;
    case 'budget_exhausted':
      if (context === 'custom') return 'New scenes are paused until tomorrow. Pick one of the choices.';
      if (context === 'preset') return 'New scenes are paused until tomorrow. Pick the other choice.';
      if (context === 'start') return "New stories are paused until tomorrow. Pick one of tonight's stories.";
      return 'New scenes are paused until tomorrow.';
    case 'rate_limited':
      return 'StoryQuest is busy right now. Try again in a moment.';
    case 'network':
      return "StoryQuest can't be reached. Check the connection and try again.";
    case 'timeout':
      return context === 'preset' || context === 'custom'
        ? messages.slowScene
        : 'StoryQuest is slow to answer. Try again.';
    case 'path_closed':
      if (context === 'start') return 'That story is not available. Pick another one.';
      return context === 'custom' ? messages.customFailed : messages.pathClosed;
    case 'generation_failed':
    case 'node_failed':
      if (context === 'preset') return messages.pathClosed;
      if (context === 'custom') return messages.customFailed;
      if (context === 'start') return messages.storyCouldNotStart;
      return 'That scene could not be made. Try again.';
    case 'not_found':
      return 'That story could not be found. Go home and pick another.';
    case 'bad_request':
      return context === 'custom' || context === 'start'
        ? 'Try saying that differently.'
        : 'That did not work. Try again.';
    default:
      return 'Something went wrong. Try again.';
  }
}
