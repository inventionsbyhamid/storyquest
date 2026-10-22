import type { Config } from '../config';
import type { Repository } from '../db/repo';
import { continuesChapter, type Bible, type Character, type NodeRecord, type TreeRecord, type WrittenChapter } from '../domain';
import { chapterSchema } from '../providers/director/schemas';
import type { Chapter, ChapterRequest, Director } from '../providers/director/types';
import type { SafetyChecker } from '../providers/safety/types';
import { badRequest, conflict, MESSAGES, notFound } from './errors';
import { ideaStep, sanitizeChapter } from './scenes';

export interface ScriptDeskDeps {
  config: Config;
  repo: Repository;
  director: Director;
  safety: SafetyChecker;
}

/** A way into a chapter: the choice index taken at the end of each earlier chapter, or the family's own words. */
export type ChapterPath = Array<number | string>;

/**
 * Lets an admin read a story's chapters before anything is filmed: draft one with the
 * director, then approve it, after which filming uses exactly that text.
 */
export class ScriptDesk {
  constructor(private readonly deps: ScriptDeskDeps) {}

  list(ideaId: string): Record<string, WrittenChapter> {
    return this.tree(ideaId).tree.scripts;
  }

  /** Asks the director for a chapter without filming or storing it. */
  async draft(ideaId: string, path: ChapterPath): Promise<{ draft: Chapter; chapter: WrittenChapter }> {
    const { tree, bible, root } = this.tree(ideaId);
    const request = this.request(tree, bible, root, path);
    const draft = await this.deps.director.writeChapter(request);
    return { draft, chapter: this.compose(tree, bible, path, draft) };
  }

  /** Checks and stores a chapter so filming that point of the story uses it word for word. */
  async approve(ideaId: string, path: ChapterPath, body: unknown, dryRun: boolean): Promise<{ key: string; chapter: WrittenChapter }> {
    const { tree, bible, root } = this.tree(ideaId);
    this.request(tree, bible, root, path);
    const number = path.length + 1;
    const parsed = chapterSchema(number, tree.totalScenes, tree.clipsPerChapter).safeParse(body);
    if (!parsed.success) throw badRequest(`${MESSAGES.badRequest} ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    const draft = { ...parsed.data, newCharacters: parsed.data.newCharacters ?? [] } as Chapter;
    const chapter = this.compose(tree, bible, path, draft);
    const text = [chapter.summary, ...chapter.choices, ...chapter.shots.flatMap((shot) => [shot.caption, shot.videoPrompt])].join('\n');
    const verdict = await this.deps.safety.check(text, { source: 'output', audience: tree.audience });
    if (!verdict.ok) throw badRequest(`${MESSAGES.badRequest} The chapter did not pass the safety check.`);
    const key = path.map((step) => (typeof step === 'string' ? ideaStep(step) : step)).join(',');
    if (!dryRun) {
      // A family's own idea is filmed fresh for each family, so its script can always change.
      const start = path.every((step) => typeof step === 'number') ? this.chapterStart(root, path as number[]) : null;
      if (start && start.status !== 'pending') throw conflict('That chapter was already filmed.');
      this.deps.repo.setTreeScript(tree.id, key, chapter);
    }
    return { key, chapter };
  }

  private tree(ideaId: string): { tree: TreeRecord; bible: Bible; root: NodeRecord } {
    const { repo } = this.deps;
    const idea = repo.getIdea(ideaId);
    if (!idea) throw notFound();
    const tree = repo.getTree(idea.treeId)!;
    if (!tree.bible) throw badRequest(`${MESSAGES.badRequest} The story has no bible yet.`);
    if (tree.clipsPerChapter < 2) throw badRequest(`${MESSAGES.badRequest} Only stories told in chapters can be scripted.`);
    return { tree, bible: tree.bible, root: repo.getNode(idea.rootNodeId)! };
  }

  /** Everyone in the story before the chapter at this path, in the order the engine uses. */
  private cast(tree: TreeRecord, bible: Bible, path: ChapterPath): Character[] {
    const cast = [...bible.characters];
    for (let k = 0; k < path.length; k++) {
      for (const character of this.earlier(tree, path, k).newCharacters) {
        if (!cast.some((c) => c.name.toLowerCase() === character.name.toLowerCase())) cast.push(character);
      }
    }
    return cast;
  }

  /** The approved chapter k (0 based) along this path. Drafting a chapter needs every chapter before it approved. */
  private earlier(tree: TreeRecord, path: ChapterPath, k: number): WrittenChapter {
    const prefix = path.slice(0, k);
    if (prefix.some((step) => typeof step !== 'number')) throw badRequest(`${MESSAGES.badRequest} Only the last step can be a family's own idea.`);
    const script = tree.scripts[prefix.join(',')];
    if (!script) throw badRequest(`${MESSAGES.badRequest} Approve chapter ${k + 1} on this path first.`);
    return script;
  }

  private request(tree: TreeRecord, bible: Bible, root: NodeRecord, path: ChapterPath): ChapterRequest {
    const number = path.length + 1;
    if (number > tree.totalScenes) throw badRequest(`${MESSAGES.badRequest} The path is longer than the story.`);
    const history = path.map((step, k) => {
      const chapter = this.earlier(tree, path, k);
      if (typeof step === 'number' && !chapter.choices[step]) throw badRequest(`${MESSAGES.badRequest} Chapter ${k + 1} has no choice ${step}.`);
      return {
        sceneNumber: k + 1,
        summary: chapter.summary,
        caption: chapter.shots[chapter.shots.length - 1]?.caption ?? '',
        choiceTaken: typeof step === 'number' ? chapter.choices[step]! : step,
      };
    });
    const last = path[path.length - 1];
    const choice: ChapterRequest['choice'] =
      last === undefined ? null : typeof last === 'string' ? { kind: 'custom', text: last } : { kind: 'preset', text: history[history.length - 1]!.choiceTaken };
    return {
      treeId: tree.id,
      nodeId: root.id,
      pathKey: `script:${path.join(',')}`,
      bible,
      cast: this.cast(tree, bible, path),
      history,
      choice,
      sceneNumber: number,
      totalScenes: tree.totalScenes,
      sceneSeconds: this.deps.config.SCENE_SECONDS,
      clips: tree.clipsPerChapter,
    };
  }

  private compose(tree: TreeRecord, bible: Bible, path: ChapterPath, draft: Chapter): WrittenChapter {
    return sanitizeChapter(draft, path.length + 1, tree.totalScenes, {
      bible,
      cast: this.cast(tree, bible, path),
      opensStory: path.length === 0,
    });
  }

  /** The first clip of the chapter at this path, if it exists yet. */
  private chapterStart(root: NodeRecord, path: number[]): NodeRecord | null {
    const { repo } = this.deps;
    let node: NodeRecord | null = root;
    for (const index of path) {
      while (node && continuesChapter(node)) {
        node = repo.getPresetChildren(node.id).find((child) => child.choiceIndex === 0) ?? null;
      }
      if (!node) return null;
      node = repo.getPresetChildren(node.id).find((child) => child.choiceIndex === index) ?? null;
    }
    return node;
  }
}
