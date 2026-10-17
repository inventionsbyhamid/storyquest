import { rm } from 'node:fs/promises';
import type { ReportReason } from '@storyquest/contracts';
import type { Repository } from '../db/repo';
import type { NodeRecord } from '../domain';
import type { Logger } from '../log';
import type { MediaStore } from '../storage';
import { conflict, MESSAGES, notFound } from './errors';

export interface ModerationDeps {
  repo: Repository;
  store: MediaStore;
  log: Logger;
}

/**
 * Families can report any scene from the TV. One report hides it straight
 * away: a shared scene closes for everyone, a private one only ever belonged
 * to that family's story. An admin can then restore it or delete it for good.
 */
export class Moderation {
  constructor(private readonly deps: ModerationDeps) {}

  report(nodeId: string, deviceId: string, reason: ReportReason, storyId: string | null): void {
    const { repo, log } = this.deps;
    const node = repo.getNode(nodeId);
    if (!node) throw notFound();
    const story = storyId ? repo.getStory(storyId) : null;
    const created = repo.addReport({ nodeId, deviceId, storyId: story?.id ?? null, reason });
    if (created && repo.hideNode(nodeId)) {
      log.warn(
        { nodeId, treeId: node.treeId, depth: node.depth, shared: node.ownerStoryId === null, reason },
        'scene reported and hidden',
      );
    }
  }

  listReports() {
    const { repo, store } = this.deps;
    return repo.listReports().map(({ node, ...report }) => ({
      nodeId: node.id,
      treeId: node.treeId,
      shared: node.ownerStoryId === null,
      ownerStoryId: node.ownerStoryId,
      depth: node.depth,
      caption: node.caption,
      videoPrompt: node.videoPrompt,
      customText: node.customText,
      clipUrl: store.url(node.clipPath),
      hidden: node.hiddenAt !== null,
      hiddenAt: node.hiddenAt,
      deletedAt: node.deletedAt,
      createdAt: node.createdAt,
      ...report,
    }));
  }

  restore(nodeId: string): NodeRecord {
    const { repo, log } = this.deps;
    const node = repo.getNode(nodeId);
    if (!node) throw notFound();
    if (node.deletedAt) throw conflict(MESSAGES.cannotRestore);
    if (repo.restoreNode(nodeId)) log.info({ nodeId }, 'scene restored');
    return repo.getNode(nodeId)!;
  }

  /** Hides the scene for good and deletes its media, including any stitched movie that contains it. */
  async remove(nodeId: string): Promise<NodeRecord> {
    const { repo, store, log } = this.deps;
    const node = repo.getNode(nodeId);
    if (!node) throw notFound();
    const files = [node.clipPath, node.posterPath, node.lastFramePath].filter((file): file is string => Boolean(file));
    repo.markNodeDeleted(nodeId);

    const movies: string[] = [];
    for (const story of repo.listStoriesThrough(nodeId)) {
      if (story.moviePath) movies.push(story.moviePath);
      if (story.movieStatus) repo.setMovie(story.id, 'failed', null);
    }
    await Promise.all([...files, ...movies].map((file) => rm(store.absolute(file), { force: true })));
    log.warn({ nodeId, files: files.length, movies: movies.length }, 'scene deleted');
    return repo.getNode(nodeId)!;
  }
}
