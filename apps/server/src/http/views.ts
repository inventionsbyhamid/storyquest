import type {
  ChoiceView,
  FinishResponse,
  IdeaView,
  MovieStatus,
  SceneView,
  ShareScene,
  ShareView,
  StorySummary,
  StoryView,
} from '@storyquest/contracts';
import { continuesChapter, isPaid, type IdeaRecord, type NodeRecord, type StoryRecord } from '../domain';
import { MESSAGES } from '../engine/errors';
import { choiceLabel } from '../engine/scenes';
import type { Services } from '../services';

/** Maps database records to the API shapes in @storyquest/contracts. */
export class Views {
  constructor(private readonly services: Services) {}

  private url(path: string | null): string | null {
    return this.services.store.url(path);
  }

  shareUrl(slug: string): string {
    return `${this.services.config.PUBLIC_BASE_URL}/s/${slug}`;
  }

  story(story: StoryRecord): StoryView {
    const tree = this.services.repo.getTree(story.treeId)!;
    return {
      id: story.id,
      title: tree.title,
      audience: tree.audience,
      ideaId: story.ideaId,
      currentNodeId: story.path[story.path.length - 1]!,
      path: story.path,
      status: story.status,
      shareSlug: story.shareSlug,
    };
  }

  /** True when every clip of the chapter that starts at this node is filmed and up. */
  private chapterFilmed(start: NodeRecord): boolean {
    const { repo } = this.services;
    let node: NodeRecord | undefined = start;
    while (node && node.status === 'ready' && !node.hiddenAt) {
      if (!continuesChapter(node)) return true;
      node = repo.getPresetChildren(node.id).find((child) => child.choiceIndex === 0);
    }
    return false;
  }

  scene(node: NodeRecord): SceneView {
    const { repo } = this.services;
    const tree = repo.getTree(node.treeId)!;
    // A scene that was taken down looks like a failed one, so the TV offers another choice from the scene before.
    if (node.hiddenAt) {
      return {
        id: node.id,
        treeId: node.treeId,
        depth: node.depth,
        sceneNumber: node.chapter + 1,
        totalScenes: tree.totalScenes,
        status: 'failed',
        caption: null,
        clipUrl: null,
        posterUrl: null,
        lastFrameUrl: null,
        durationMs: null,
        isEnding: false,
        choices: [],
        generationMs: node.timings?.totalMs ?? null,
        error: MESSAGES.sceneRemoved,
      };
    }
    const ready = node.status === 'ready';
    const continues = ready && continuesChapter(node);
    // While filming is paused, a chapter that is only partly filmed could leave a family stuck half way.
    const paused = this.services.budget.exhausted() !== null;
    let choices: ChoiceView[] = [];
    if (ready && !node.isEnding) {
      const children = repo.getPresetChildren(node.id);
      choices = node.choices.map((label, index) => {
        const found = children.find((candidate) => candidate.choiceIndex === index) ?? null;
        const child = found && paused && !continues && !this.chapterFilmed(found) ? null : found;
        const free = continues || node.ownerStoryId === null || (child !== null && isPaid(child));
        const playable = child?.status === 'ready' && !child.hiddenAt;
        return {
          index,
          label,
          nodeId: child?.id ?? null,
          ready: playable,
          posterUrl: playable ? this.url(child.posterPath) : null,
          tone: playable ? child.tone : null,
          sparks: free ? 0 : this.services.config.SCENE_COST_SPARKS,
          filmed: playable && this.chapterFilmed(child),
        };
      });
    }
    return {
      id: node.id,
      treeId: node.treeId,
      depth: node.depth,
      sceneNumber: node.chapter + 1,
      totalScenes: tree.totalScenes,
      status: node.status,
      caption: ready ? node.caption : null,
      clipUrl: ready ? this.url(node.clipPath) : null,
      posterUrl: ready ? this.url(node.posterPath) : null,
      lastFrameUrl: ready ? this.url(node.lastFramePath) : null,
      tone: ready ? node.tone : null,
      endTone: ready ? (node.endTone ?? node.tone) : null,
      durationMs: ready ? node.durationMs : null,
      isEnding: ready && node.isEnding,
      continues,
      choices,
      generationMs: node.timings?.totalMs ?? null,
      error: node.status === 'failed' ? node.error : null,
    };
  }

  idea(idea: IdeaRecord): IdeaView {
    const root = this.services.repo.getNode(idea.rootNodeId);
    const ready = root?.status === 'ready' && !root.hiddenAt;
    return {
      id: idea.id,
      date: idea.date,
      title: idea.title,
      logline: idea.logline,
      audience: idea.audience,
      moods: idea.moods,
      posterUrl: ready ? this.url(root.posterPath) : null,
      tone: ready ? root.tone : null,
      trailerUrl: ready ? this.url(root.clipPath) : null,
      plays: idea.plays,
      ready,
    };
  }

  /** The longest filmed shared path from a story's opening, for the website. */
  filmedPath(idea: IdeaRecord): Array<{ posterUrl: string; caption: string; choiceTaken: string | null }> {
    const { repo } = this.services;
    const playable = (node: NodeRecord) => node.status === 'ready' && !node.hiddenAt && Boolean(node.posterPath);
    const children = (node: NodeRecord) => repo.getPresetChildren(node.id).filter(playable);
    const reach = (node: NodeRecord): number => 1 + Math.max(0, ...children(node).map(reach));

    const root = repo.getNode(idea.rootNodeId);
    if (!root || !playable(root)) return [];
    const path = [root];
    for (let next = root; ; ) {
      const options = children(next).sort((a, b) => reach(b) - reach(a) || (a.choiceIndex ?? 0) - (b.choiceIndex ?? 0));
      if (!options[0]) break;
      path.push((next = options[0]));
    }
    // One picture per chapter: the clips that follow on their own are not separate steps.
    return path
      .map((node, index) => ({ node, parent: index > 0 ? path[index - 1]! : null }))
      .filter(({ parent }) => !parent || !continuesChapter(parent))
      .map(({ node, parent }) => ({
        posterUrl: this.url(node.posterPath)!,
        caption: node.caption ?? '',
        choiceTaken: parent ? choiceLabel(parent, node) : null,
      }));
  }

  storySummary(story: StoryRecord): StorySummary {
    const { repo } = this.services;
    const tree = repo.getTree(story.treeId)!;
    const nodes = story.path.map((id) => repo.getNode(id));
    const current = nodes[nodes.length - 1] ?? null;
    // The picture of the latest clip that can be shown, so a story waiting on its next clip still has one.
    const shown = [...nodes].reverse().find((node) => node?.status === 'ready' && !node.hiddenAt && node.posterPath) ?? null;
    return {
      id: story.id,
      title: tree.title,
      status: story.status,
      audience: tree.audience,
      ideaId: story.ideaId,
      currentNodeId: story.path[story.path.length - 1]!,
      chapter: (current?.chapter ?? 0) + 1,
      totalChapters: tree.totalScenes,
      posterUrl: shown ? this.url(shown.posterPath) : null,
      tone: shown?.tone ?? null,
      updatedAt: story.updatedAt,
    };
  }

  /** The stitched movie is only offered while every scene in it is still up. */
  private movie(story: StoryRecord): { movieStatus: MovieStatus; movieUrl: string | null } {
    const removed = story.path.some((id) => this.services.repo.getNode(id)?.hiddenAt);
    if (removed) return { movieStatus: 'failed', movieUrl: null };
    return {
      movieStatus: story.movieStatus ?? 'pending',
      movieUrl: story.movieStatus === 'ready' ? this.url(story.moviePath) : null,
    };
  }

  finish(story: StoryRecord): FinishResponse {
    return {
      story: this.story(story),
      shareSlug: story.shareSlug!,
      shareUrl: this.shareUrl(story.shareSlug!),
      ...this.movie(story),
      stats: this.services.engine.stats(story),
    };
  }

  share(story: StoryRecord): ShareView {
    const { repo } = this.services;
    const tree = repo.getTree(story.treeId)!;
    const nodes = story.path.map((id) => repo.getNode(id)).filter((node): node is NodeRecord => node !== null);
    const scenes: ShareScene[] = nodes
      .filter((node) => node.hiddenAt || (node.status === 'ready' && node.clipPath))
      .map((node) => {
        const parent = nodes.find((candidate) => candidate.id === node.parentId) ?? null;
        const chapterStart = !parent || !continuesChapter(parent);
        const choiceTaken = parent && chapterStart ? choiceLabel(parent, node) : null;
        if (node.hiddenAt) {
          return { caption: node.caption, clipUrl: '', posterUrl: null, choiceTaken, chapterStart, removed: true };
        }
        return {
          caption: node.caption,
          clipUrl: this.url(node.clipPath)!,
          posterUrl: this.url(node.posterPath),
          tone: node.tone,
          choiceTaken,
          chapterStart,
        };
      });
    return {
      slug: story.shareSlug!,
      title: tree.title,
      createdAt: story.finishedAt ?? story.createdAt,
      ...this.movie(story),
      scenes,
      stats: this.services.engine.stats(story),
    };
  }
}
