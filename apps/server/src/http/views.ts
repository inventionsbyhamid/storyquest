import type {
  ChoiceView,
  FinishResponse,
  IdeaView,
  SceneView,
  ShareScene,
  ShareView,
  StoryView,
} from '@storyquest/contracts';
import type { IdeaRecord, NodeRecord, StoryRecord } from '../domain';
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

  scene(node: NodeRecord): SceneView {
    const { repo } = this.services;
    const tree = repo.getTree(node.treeId)!;
    const ready = node.status === 'ready';
    let choices: ChoiceView[] = [];
    if (ready && !node.isEnding) {
      const children = repo.getPresetChildren(node.id);
      choices = node.choices.map((label, index) => {
        const child = children.find((candidate) => candidate.choiceIndex === index) ?? null;
        return {
          index,
          label,
          nodeId: child?.id ?? null,
          ready: child?.status === 'ready',
          posterUrl: child?.status === 'ready' ? this.url(child.posterPath) : null,
        };
      });
    }
    return {
      id: node.id,
      treeId: node.treeId,
      depth: node.depth,
      sceneNumber: node.depth + 1,
      totalScenes: tree.totalScenes,
      status: node.status,
      caption: ready ? node.caption : null,
      clipUrl: ready ? this.url(node.clipPath) : null,
      posterUrl: ready ? this.url(node.posterPath) : null,
      lastFrameUrl: ready ? this.url(node.lastFramePath) : null,
      durationMs: ready ? node.durationMs : null,
      isEnding: ready && node.isEnding,
      choices,
      generationMs: node.timings?.totalMs ?? null,
      error: node.status === 'failed' ? node.error : null,
    };
  }

  idea(idea: IdeaRecord): IdeaView {
    const root = this.services.repo.getNode(idea.rootNodeId);
    const ready = root?.status === 'ready';
    return {
      id: idea.id,
      date: idea.date,
      title: idea.title,
      logline: idea.logline,
      audience: idea.audience,
      moods: idea.moods,
      posterUrl: ready ? this.url(root.posterPath) : null,
      trailerUrl: ready ? this.url(root.clipPath) : null,
      plays: idea.plays,
      ready,
    };
  }

  finish(story: StoryRecord): FinishResponse {
    return {
      story: this.story(story),
      shareSlug: story.shareSlug!,
      shareUrl: this.shareUrl(story.shareSlug!),
      movieStatus: story.movieStatus ?? 'pending',
      movieUrl: story.movieStatus === 'ready' ? this.url(story.moviePath) : null,
      stats: this.services.engine.stats(story),
    };
  }

  share(story: StoryRecord): ShareView {
    const { repo } = this.services;
    const tree = repo.getTree(story.treeId)!;
    const nodes = story.path.map((id) => repo.getNode(id)).filter((node): node is NodeRecord => node !== null);
    const scenes: ShareScene[] = nodes
      .filter((node) => node.status === 'ready' && node.clipPath)
      .map((node) => {
        const parent = nodes.find((candidate) => candidate.id === node.parentId) ?? null;
        return {
          caption: node.caption,
          clipUrl: this.url(node.clipPath)!,
          posterUrl: this.url(node.posterPath),
          choiceTaken: parent ? choiceLabel(parent, node) : null,
        };
      });
    return {
      slug: story.shareSlug!,
      title: tree.title,
      createdAt: story.finishedAt ?? story.createdAt,
      movieStatus: story.movieStatus ?? 'pending',
      movieUrl: story.movieStatus === 'ready' ? this.url(story.moviePath) : null,
      scenes,
      stats: this.services.engine.stats(story),
    };
  }
}
