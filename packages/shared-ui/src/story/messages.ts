import type { ApiErrorCode } from '../api/errors';

export type MessageContext = 'preset' | 'custom' | 'start' | 'today' | 'general';

export const messages = {
  pathClosed: 'That path is closed. Try the other one.',
  customFailed: 'That idea got lost on the way. Try a choice or another idea.',
  sceneWouldNotPlay: 'That scene would not play. Pick what happens next.',
  storyCouldNotStart: 'This story could not start. Try again in a moment.',
  slowScene: 'This scene is taking longer than usual. Try again.',
  promptTooShort: 'Tell us a little more about your idea.',
  promptTooLong: 'That is a lot of story! Try something shorter.',
  movieAlmostReady: 'Your movie is almost ready.',
  movieFailed: 'We could not make the movie this time.',
  choiceNotSaved: 'We could not save that choice, but your story keeps going.',
};

export function messageForError(code: ApiErrorCode | 'node_failed', context: MessageContext = 'general'): string {
  if (context === 'today' && code !== 'network' && code !== 'timeout') {
    return "Tonight's stories are still being written. Try again in a moment.";
  }
  switch (code) {
    case 'unsafe_input':
      return "Let's try a different idea.";
    case 'budget_exhausted':
      if (context === 'custom') return 'New paths are resting until tomorrow. Pick one of the choices.';
      if (context === 'preset') return 'New paths are resting until tomorrow. Try the other choice.';
      if (context === 'start') return "New stories are resting until tomorrow. Pick one of tonight's stories.";
      return 'StoryQuest is resting until tomorrow.';
    case 'rate_limited':
      return 'Lots of families are making stories right now. Try again in a moment.';
    case 'network':
      return "We can't reach StoryQuest right now. Check your connection and try again.";
    case 'timeout':
      return context === 'preset' || context === 'custom'
        ? messages.slowScene
        : 'StoryQuest is taking a while to answer. Try again.';
    case 'generation_failed':
    case 'node_failed':
      if (context === 'preset') return messages.pathClosed;
      if (context === 'custom') return messages.customFailed;
      if (context === 'start') return messages.storyCouldNotStart;
      return 'Something went wrong while drawing. Try again.';
    case 'not_found':
      return 'We could not find that story. Head home and pick another.';
    case 'bad_request':
      return context === 'custom' || context === 'start'
        ? 'Try saying that a little differently.'
        : 'Something did not work. Try again.';
    default:
      return 'Something went wrong on our side. Try again.';
  }
}
