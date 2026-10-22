import { describe, expect, it } from 'vitest';
import { composeShotPrompt } from '../src/engine/shotPrompt';

const characters = [
  { name: 'Pip', description: 'A small red fox kit with a blue scarf.', voice: "a bright, quick young boy's voice" },
  { name: 'Moss', description: 'A round old tortoise with a mossy shell.' },
  { name: 'Tilly', description: 'A small girl in a blue raincoat.', voice: "A quick, excited little girl's voice." },
];
const context = { artStyle: 'Soft 3D animated film look', characters, firstFrame: true };

describe('shot prompts', () => {
  it('follows the H3 layout with fixed looks, voices and no music', () => {
    const prompt = composeShotPrompt(
      {
        caption: 'Pip finds a glowing seed.',
        cast: ['Pip'],
        action: 'Pip digs in the moss and lifts a glowing seed as the camera pushes in slowly',
        dialogue: [{ speaker: 'Pip', line: 'Look, it is glowing!' }],
        sound: 'Crickets and soft rustling leaves',
      },
      context,
    );
    const lines = prompt.split('\n');
    expect(lines[0]).toBe('For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.');
    expect(lines[1]).toBe('');
    expect(lines[2]).toMatch(/^integrated_multimodal_description: \[Shot 1\] Soft 3D animated film look\. Pip is a small red fox kit with a blue scarf\. Pip digs/);
    expect(prompt).toContain("Pip (S1) says in a bright, quick young boy's voice: <d>[English] Look, it is glowing!</d>");
    expect(prompt).toContain('One continuous shot with no cuts.');
    expect(prompt).toContain('No subtitles, captions or written words anywhere on screen.');
    expect(lines[3]).toBe('overall_soundscape: Crickets and soft rustling leaves.');
    expect(lines[4]).toBe('non_diegetic_music: N/A');
  });

  it('opens a story without a first frame and keeps speaker ids stable', () => {
    const prompt = composeShotPrompt(
      {
        caption: 'Moss wakes up.',
        cast: [],
        action: 'Moss slowly opens one eye under a falling leaf while the camera drifts closer',
        dialogue: [{ speaker: 'Moss', line: 'Hmm' }, { speaker: 'Nobody', line: 'Who said that?' }],
        sound: '',
      },
      { ...context, firstFrame: false },
    );
    expect(prompt.startsWith('integrated_multimodal_description:')).toBe(true);
    expect(prompt).toContain('Moss is a round old tortoise with a mossy shell.');
    expect(prompt).toContain('Moss (S2) says in a clear, friendly voice: <d>[English] Hmm.</d>');
    expect(prompt).not.toContain('Nobody');
    const tilly = composeShotPrompt({ caption: 'Hi', cast: ['Tilly'], action: 'Tilly waves at the camera from the window as rain falls', dialogue: [{ speaker: 'Tilly', line: 'Hello!' }], sound: '' }, context);
    expect(tilly).toContain("Tilly (S3) says in a quick, excited little girl's voice: <d>[English] Hello!</d>");
    expect(prompt).toContain('overall_soundscape: Soft ambience of the place and the sounds of the action.');
  });
});
