import type { Repository } from '../db/repo';
import type { Media } from '../media';
import type { MediaStore } from '../storage';
import { DEFAULT_NIGHT } from '../tone';

/** Works out night colors for scenes filmed before they were stored. Cheap: one tiny decode per picture. */
export async function backfillTones(deps: { repo: Repository; media: Media; store: MediaStore }): Promise<number> {
  const { repo, media, store } = deps;
  let done = 0;
  for (;;) {
    const batch = repo.listNodesWithoutTone(50);
    if (batch.length === 0) return done;
    for (const node of batch) {
      const tone = (await media.tone(store.absolute(node.posterPath))) ?? DEFAULT_NIGHT;
      const endTone = node.lastFramePath ? await media.tone(store.absolute(node.lastFramePath)) : null;
      repo.setTones(node.id, tone, endTone);
      done++;
    }
  }
}
