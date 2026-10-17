import type Database from 'better-sqlite3';
import type { Db } from './database';
import { newId } from '../ids';
import type {
  Audience,
  Bible,
  Character,
  IdeaRecord,
  Mood,
  MovieStatus,
  NodeRecord,
  NodeStatus,
  NodeTimings,
  StoryRecord,
  StoryStatus,
  TreeRecord,
} from '../domain';

interface TreeRow {
  id: string;
  idea_id: string | null;
  title: string;
  logline: string;
  audience: string;
  moods: string;
  bible: string | null;
  prompt: string | null;
  total_scenes: number;
  is_private: number;
  warm_depth: number;
  warm_force: number;
  created_at: string;
}

interface IdeaRow {
  id: string;
  date: string;
  position: number;
  tree_id: string;
  root_node_id: string;
  title: string;
  logline: string;
  audience: string;
  moods: string;
  plays: number;
  featured_at: string | null;
  created_at: string;
}

interface NodeRow {
  id: string;
  tree_id: string;
  parent_id: string | null;
  choice_index: number | null;
  custom_text: string | null;
  owner_story_id: string | null;
  depth: number;
  status: string;
  summary: string | null;
  caption: string | null;
  video_prompt: string | null;
  choices: string;
  is_ending: number;
  new_characters: string;
  clip_path: string | null;
  poster_path: string | null;
  last_frame_path: string | null;
  duration_ms: number | null;
  picks: number;
  want_children: number;
  warm: number;
  attempts: number;
  error: string | null;
  error_code: string | null;
  timings: string | null;
  cost_seconds: number | null;
  created_at: string;
  updated_at: string;
}

interface StoryRow {
  id: string;
  device_id: string;
  tree_id: string;
  idea_id: string | null;
  path: string;
  status: string;
  share_slug: string | null;
  movie_path: string | null;
  movie_status: string | null;
  created_at: string;
  finished_at: string | null;
}

const toTree = (row: TreeRow): TreeRecord => ({
  id: row.id,
  ideaId: row.idea_id,
  title: row.title,
  logline: row.logline,
  audience: row.audience as Audience,
  moods: JSON.parse(row.moods) as Mood[],
  bible: row.bible ? (JSON.parse(row.bible) as Bible) : null,
  prompt: row.prompt,
  totalScenes: row.total_scenes,
  isPrivate: row.is_private === 1,
  warmDepth: row.warm_depth,
  warmForce: row.warm_force === 1,
  createdAt: row.created_at,
});

const toIdea = (row: IdeaRow): IdeaRecord => ({
  id: row.id,
  date: row.date,
  position: row.position,
  treeId: row.tree_id,
  rootNodeId: row.root_node_id,
  title: row.title,
  logline: row.logline,
  audience: row.audience as Audience,
  moods: JSON.parse(row.moods) as Mood[],
  plays: row.plays,
  featuredAt: row.featured_at,
  createdAt: row.created_at,
});

const toNode = (row: NodeRow): NodeRecord => ({
  id: row.id,
  treeId: row.tree_id,
  parentId: row.parent_id,
  choiceIndex: row.choice_index,
  customText: row.custom_text,
  ownerStoryId: row.owner_story_id,
  depth: row.depth,
  status: row.status as NodeStatus,
  summary: row.summary,
  caption: row.caption,
  videoPrompt: row.video_prompt,
  choices: JSON.parse(row.choices) as string[],
  isEnding: row.is_ending === 1,
  newCharacters: JSON.parse(row.new_characters) as Character[],
  clipPath: row.clip_path,
  posterPath: row.poster_path,
  lastFramePath: row.last_frame_path,
  durationMs: row.duration_ms,
  picks: row.picks,
  wantChildren: row.want_children === 1,
  warm: row.warm,
  attempts: row.attempts,
  error: row.error,
  errorCode: row.error_code,
  timings: row.timings ? (JSON.parse(row.timings) as NodeTimings) : null,
  costSeconds: row.cost_seconds,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toStory = (row: StoryRow): StoryRecord => ({
  id: row.id,
  deviceId: row.device_id,
  treeId: row.tree_id,
  ideaId: row.idea_id,
  path: JSON.parse(row.path) as string[],
  status: row.status as StoryStatus,
  shareSlug: row.share_slug,
  moviePath: row.movie_path,
  movieStatus: row.movie_status as MovieStatus | null,
  createdAt: row.created_at,
  finishedAt: row.finished_at,
});

export interface NewTree {
  id?: string;
  ideaId?: string | null;
  title: string;
  logline: string;
  audience: Audience;
  moods: Mood[];
  bible: Bible | null;
  prompt: string | null;
  totalScenes: number;
  isPrivate: boolean;
}

export interface NewNode {
  id?: string;
  treeId: string;
  parentId: string | null;
  choiceIndex: number | null;
  customText: string | null;
  ownerStoryId: string | null;
  depth: number;
  warm?: number;
  wantChildren?: boolean;
}

export interface NewStory {
  id?: string;
  deviceId: string;
  treeId: string;
  ideaId: string | null;
  path: string[];
}

export interface ReadyScene {
  summary: string;
  caption: string;
  videoPrompt: string;
  choices: string[];
  isEnding: boolean;
  newCharacters: Character[];
  clipPath: string;
  posterPath: string;
  lastFramePath: string;
  durationMs: number;
  timings: NodeTimings;
  costSeconds: number;
}

export class Repository {
  private readonly statements = new Map<string, Database.Statement>();

  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  private stmt(sql: string): Database.Statement {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  // Trees

  insertTree(input: NewTree): TreeRecord {
    const id = input.id ?? newId('tr');
    this.stmt(
      `INSERT INTO trees (id, idea_id, title, logline, audience, moods, bible, prompt, total_scenes, is_private, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.ideaId ?? null,
      input.title,
      input.logline,
      input.audience,
      JSON.stringify(input.moods),
      input.bible ? JSON.stringify(input.bible) : null,
      input.prompt,
      input.totalScenes,
      input.isPrivate ? 1 : 0,
      this.timestamp(),
    );
    return this.getTree(id)!;
  }

  getTree(id: string): TreeRecord | null {
    const row = this.stmt('SELECT * FROM trees WHERE id = ?').get(id) as TreeRow | undefined;
    return row ? toTree(row) : null;
  }

  setTreeBible(id: string, bible: Bible): void {
    this.stmt('UPDATE trees SET bible = ?, title = ?, logline = ? WHERE id = ?').run(
      JSON.stringify(bible),
      bible.title,
      bible.logline,
      id,
    );
  }

  // Ideas

  createDailyIdea(input: { date: string; position: number; bible: Bible; totalScenes: number; warm: number }): IdeaRecord | null {
    return this.transaction(() => {
      const taken = this.stmt('SELECT 1 FROM ideas WHERE date = ? AND position = ?').get(input.date, input.position);
      if (taken) return null;
      const ideaId = newId('id');
      const tree = this.insertTree({
        ideaId,
        title: input.bible.title,
        logline: input.bible.logline,
        audience: input.bible.audience,
        moods: input.bible.moods,
        bible: input.bible,
        prompt: null,
        totalScenes: input.totalScenes,
        isPrivate: false,
      });
      const root = this.insertNode({
        treeId: tree.id,
        parentId: null,
        choiceIndex: null,
        customText: null,
        ownerStoryId: null,
        depth: 0,
        warm: input.warm,
      });
      this.stmt(
        `INSERT INTO ideas (id, date, position, tree_id, root_node_id, title, logline, audience, moods, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        ideaId,
        input.date,
        input.position,
        tree.id,
        root.id,
        tree.title,
        tree.logline,
        tree.audience,
        JSON.stringify(tree.moods),
        this.timestamp(),
      );
      return this.getIdea(ideaId);
    });
  }

  getIdea(id: string): IdeaRecord | null {
    const row = this.stmt('SELECT * FROM ideas WHERE id = ?').get(id) as IdeaRow | undefined;
    return row ? toIdea(row) : null;
  }

  listIdeas(date: string): IdeaRecord[] {
    const rows = this.stmt('SELECT * FROM ideas WHERE date = ? ORDER BY position').all(date) as IdeaRow[];
    return rows.map(toIdea);
  }

  latestIdeaDate(): string | null {
    const row = this.stmt('SELECT MAX(date) AS date FROM ideas').get() as { date: string | null };
    return row.date;
  }

  incrementIdeaPlays(id: string): void {
    this.stmt('UPDATE ideas SET plays = plays + 1 WHERE id = ?').run(id);
  }

  /** The most recent date with at least one idea whose opening scene is ready. */
  latestDateWithReadyIdeas(): string | null {
    const row = this.stmt(
      `SELECT ideas.date FROM ideas JOIN nodes ON nodes.id = ideas.root_node_id
       WHERE nodes.status = 'ready' ORDER BY ideas.date DESC LIMIT 1`,
    ).get() as { date: string } | undefined;
    return row?.date ?? null;
  }

  setFeatured(id: string, featured: boolean): boolean {
    const info = this.stmt(
      'UPDATE ideas SET featured_at = CASE WHEN ? THEN COALESCE(featured_at, ?) ELSE NULL END WHERE id = ?',
    ).run(featured ? 1 : 0, this.timestamp(), id);
    return info.changes === 1;
  }

  listFeatured(): IdeaRecord[] {
    const rows = this.stmt(
      'SELECT * FROM ideas WHERE featured_at IS NOT NULL ORDER BY featured_at DESC, date DESC',
    ).all() as IdeaRow[];
    return rows.map(toIdea);
  }

  // Nodes

  insertNode(input: NewNode): NodeRecord {
    const id = input.id ?? newId('nd');
    const now = this.timestamp();
    this.stmt(
      `INSERT INTO nodes (id, tree_id, parent_id, choice_index, custom_text, owner_story_id, depth, warm, want_children, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.treeId,
      input.parentId,
      input.choiceIndex,
      input.customText,
      input.ownerStoryId,
      input.depth,
      input.warm ?? 0,
      input.wantChildren ? 1 : 0,
      now,
      now,
    );
    return this.getNode(id)!;
  }

  getNode(id: string): NodeRecord | null {
    const row = this.stmt('SELECT * FROM nodes WHERE id = ?').get(id) as NodeRow | undefined;
    return row ? toNode(row) : null;
  }

  getPresetChildren(parentId: string): NodeRecord[] {
    const rows = this.stmt(
      'SELECT * FROM nodes WHERE parent_id = ? AND choice_index IS NOT NULL ORDER BY choice_index',
    ).all(parentId) as NodeRow[];
    return rows.map(toNode);
  }

  /**
   * The partial unique index on (parent_id, choice_index) makes this safe when
   * two families pick the same new branch at the same moment: both get one node.
   */
  getOrCreatePresetChild(parent: NodeRecord, choiceIndex: number, warm: number): { node: NodeRecord; created: boolean } {
    return this.transaction(() => {
      const now = this.timestamp();
      const info = this.stmt(
        `INSERT INTO nodes (id, tree_id, parent_id, choice_index, custom_text, owner_story_id, depth, warm, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
         ON CONFLICT (parent_id, choice_index) WHERE choice_index IS NOT NULL DO NOTHING`,
      ).run(newId('nd'), parent.treeId, parent.id, choiceIndex, parent.ownerStoryId, parent.depth + 1, warm, now, now);
      const row = this.stmt('SELECT * FROM nodes WHERE parent_id = ? AND choice_index = ?').get(
        parent.id,
        choiceIndex,
      ) as NodeRow;
      return { node: toNode(row), created: info.changes === 1 };
    });
  }

  createCustomChild(parent: NodeRecord, text: string, storyId: string): NodeRecord {
    return this.insertNode({
      treeId: parent.treeId,
      parentId: parent.id,
      choiceIndex: null,
      customText: text,
      ownerStoryId: storyId,
      depth: parent.depth + 1,
      wantChildren: true,
    });
  }

  /** Moves a node from pending to generating. Returns false if someone else already has it. */
  claimNode(id: string): boolean {
    const info = this.stmt(
      "UPDATE nodes SET status = 'generating', updated_at = ? WHERE id = ? AND status = 'pending'",
    ).run(this.timestamp(), id);
    return info.changes === 1;
  }

  markReady(id: string, scene: ReadyScene): void {
    this.stmt(
      `UPDATE nodes SET status = 'ready', summary = ?, caption = ?, video_prompt = ?, choices = ?, is_ending = ?,
         new_characters = ?, clip_path = ?, poster_path = ?, last_frame_path = ?, duration_ms = ?, timings = ?,
         cost_seconds = ?, error = NULL, error_code = NULL, updated_at = ?
       WHERE id = ?`,
    ).run(
      scene.summary,
      scene.caption,
      scene.videoPrompt,
      JSON.stringify(scene.choices),
      scene.isEnding ? 1 : 0,
      JSON.stringify(scene.newCharacters),
      scene.clipPath,
      scene.posterPath,
      scene.lastFramePath,
      Math.round(scene.durationMs),
      JSON.stringify(scene.timings),
      scene.costSeconds,
      this.timestamp(),
      id,
    );
  }

  markFailed(id: string, code: string, message: string): void {
    this.stmt(
      "UPDATE nodes SET status = 'failed', error = ?, error_code = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?",
    ).run(message, code, this.timestamp(), id);
  }

  /** Counts a failed attempt. The node goes back to pending until it runs out of attempts. */
  recordFailure(id: string, maxAttempts: number, code: string, message: string): 'retry' | 'failed' {
    const row = this.stmt(
      `UPDATE nodes SET
         attempts = attempts + 1,
         status = CASE WHEN attempts + 1 < ? THEN 'pending' ELSE 'failed' END,
         error = CASE WHEN attempts + 1 < ? THEN NULL ELSE ? END,
         error_code = CASE WHEN attempts + 1 < ? THEN NULL ELSE ? END,
         updated_at = ?
       WHERE id = ?
       RETURNING status`,
    ).get(maxAttempts, maxAttempts, message, maxAttempts, code, this.timestamp(), id) as { status: string } | undefined;
    return row?.status === 'pending' ? 'retry' : 'failed';
  }

  resetFailed(id: string): boolean {
    const info = this.stmt(
      "UPDATE nodes SET status = 'pending', attempts = 0, error = NULL, error_code = NULL, updated_at = ? WHERE id = ? AND status = 'failed'",
    ).run(this.timestamp(), id);
    return info.changes === 1;
  }

  resetGenerating(): number {
    return this.stmt("UPDATE nodes SET status = 'pending', updated_at = ? WHERE status = 'generating'").run(
      this.timestamp(),
    ).changes;
  }

  listPendingIds(): string[] {
    const rows = this.stmt("SELECT id FROM nodes WHERE status = 'pending' ORDER BY depth, created_at").all() as {
      id: string;
    }[];
    return rows.map((row) => row.id);
  }

  setWantChildren(id: string): void {
    this.stmt('UPDATE nodes SET want_children = 1 WHERE id = ?').run(id);
  }

  addPicks(id: string, delta: number): void {
    this.stmt('UPDATE nodes SET picks = MAX(0, picks + ?) WHERE id = ?').run(delta, id);
  }

  /** The node and all its ancestors, root first. */
  getLineage(id: string): NodeRecord[] {
    const rows = this.stmt(
      `WITH RECURSIVE chain(id, parent_id) AS (
         SELECT id, parent_id FROM nodes WHERE id = ?
         UNION ALL
         SELECT n.id, n.parent_id FROM nodes n JOIN chain c ON n.id = c.parent_id
       )
       SELECT nodes.* FROM nodes JOIN chain ON chain.id = nodes.id ORDER BY nodes.depth`,
    ).all(id) as NodeRow[];
    return rows.map(toNode);
  }

  /** Records an admin warm request. Depth only grows, so a shallower request never undoes a deeper one. */
  setTreeWarm(treeId: string, depth: number, force: boolean): void {
    this.transaction(() => {
      this.stmt('UPDATE trees SET warm_depth = MAX(warm_depth, ?), warm_force = ? WHERE id = ?').run(
        depth,
        force ? 1 : 0,
        treeId,
      );
      // A node's warm value is how many levels below it should be generated.
      this.stmt(
        'UPDATE nodes SET warm = MAX(warm, ? - 1 - depth) WHERE tree_id = ? AND owner_story_id IS NULL AND depth < ?',
      ).run(depth, treeId, depth);
    });
  }

  /** Shared nodes of a tree above the given depth, the root first. Private custom branches are left out. */
  listSharedNodes(treeId: string, maxDepth: number): NodeRecord[] {
    const rows = this.stmt(
      'SELECT * FROM nodes WHERE tree_id = ? AND owner_story_id IS NULL AND depth < ? ORDER BY depth, created_at',
    ).all(treeId, maxDepth) as NodeRow[];
    return rows.map(toNode);
  }

  countSharedByStatus(treeId: string, maxDepth: number): Record<NodeStatus, number> {
    const counts: Record<NodeStatus, number> = { pending: 0, generating: 0, ready: 0, failed: 0 };
    const rows = this.stmt(
      'SELECT status, COUNT(*) AS n FROM nodes WHERE tree_id = ? AND owner_story_id IS NULL AND depth < ? GROUP BY status',
    ).all(treeId, maxDepth) as { status: NodeStatus; n: number }[];
    for (const row of rows) counts[row.status] = row.n;
    return counts;
  }

  countReadyEndings(treeId: string): number {
    const row = this.stmt(
      "SELECT COUNT(*) AS n FROM nodes WHERE tree_id = ? AND is_ending = 1 AND status = 'ready'",
    ).get(treeId) as { n: number };
    return row.n;
  }

  // Stories

  insertStory(input: NewStory): StoryRecord {
    const id = input.id ?? newId('st');
    this.stmt(
      'INSERT INTO stories (id, device_id, tree_id, idea_id, path, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, input.deviceId, input.treeId, input.ideaId, JSON.stringify(input.path), this.timestamp());
    return this.getStory(id)!;
  }

  getStory(id: string): StoryRecord | null {
    const row = this.stmt('SELECT * FROM stories WHERE id = ?').get(id) as StoryRow | undefined;
    return row ? toStory(row) : null;
  }

  getStoryBySlug(slug: string): StoryRecord | null {
    const row = this.stmt('SELECT * FROM stories WHERE share_slug = ?').get(slug) as StoryRow | undefined;
    return row ? toStory(row) : null;
  }

  setStoryPath(id: string, path: string[]): void {
    this.stmt('UPDATE stories SET path = ? WHERE id = ?').run(JSON.stringify(path), id);
  }

  finishStory(id: string, slug: string): boolean {
    const info = this.stmt(
      "UPDATE stories SET status = 'finished', share_slug = ?, movie_status = 'pending', finished_at = ? WHERE id = ? AND status = 'active'",
    ).run(slug, this.timestamp(), id);
    return info.changes === 1;
  }

  slugTaken(slug: string): boolean {
    return Boolean(this.stmt('SELECT 1 FROM stories WHERE share_slug = ?').get(slug));
  }

  setMovie(id: string, status: MovieStatus, moviePath: string | null): void {
    this.stmt('UPDATE stories SET movie_status = ?, movie_path = ? WHERE id = ?').run(status, moviePath, id);
  }

  listStoriesWithPendingMovie(): StoryRecord[] {
    const rows = this.stmt("SELECT * FROM stories WHERE movie_status = 'pending'").all() as StoryRow[];
    return rows.map(toStory);
  }

  countStoriesForTree(treeId: string): number {
    const row = this.stmt('SELECT COUNT(*) AS n FROM stories WHERE tree_id = ?').get(treeId) as { n: number };
    return row.n;
  }

  // Usage and spend

  tryConsumeCustom(day: string, deviceId: string, limit: number): boolean {
    if (limit <= 0) return false;
    const info = this.stmt(
      `INSERT INTO usage (day, device_id, custom_count) VALUES (?, ?, 1)
       ON CONFLICT (day, device_id) DO UPDATE SET custom_count = custom_count + 1 WHERE custom_count < ?`,
    ).run(day, deviceId, limit);
    return info.changes === 1;
  }

  spendSeconds(day: string): number {
    const row = this.stmt('SELECT video_seconds FROM spend WHERE day = ?').get(day) as
      | { video_seconds: number }
      | undefined;
    return row?.video_seconds ?? 0;
  }

  addVideoSeconds(day: string, seconds: number): void {
    this.stmt(
      `INSERT INTO spend (day, video_seconds) VALUES (?, MAX(0, ?))
       ON CONFLICT (day) DO UPDATE SET video_seconds = MAX(0, video_seconds + ?)`,
    ).run(day, seconds, seconds);
  }

  /** Books video seconds against today's cap. Returns false when the cap would be exceeded. */
  reserveVideoSeconds(day: string, seconds: number, cap: number): boolean {
    return this.transaction(() => {
      if (this.spendSeconds(day) + seconds > cap) return false;
      this.addVideoSeconds(day, seconds);
      return true;
    });
  }

  stats(day: string) {
    const count = (sql: string, ...params: unknown[]) => (this.stmt(sql).get(...params) as { n: number }).n;
    const nodesByStatus = Object.fromEntries(
      (this.stmt('SELECT status, COUNT(*) AS n FROM nodes GROUP BY status').all() as { status: string; n: number }[]).map(
        (row) => [row.status, row.n],
      ),
    );
    return {
      ideasToday: count('SELECT COUNT(*) AS n FROM ideas WHERE date = ?', day),
      trees: count('SELECT COUNT(*) AS n FROM trees'),
      nodesByStatus,
      storiesActive: count("SELECT COUNT(*) AS n FROM stories WHERE status = 'active'"),
      storiesFinished: count("SELECT COUNT(*) AS n FROM stories WHERE status = 'finished'"),
      storiesToday: count('SELECT COUNT(*) AS n FROM stories WHERE substr(created_at, 1, 10) = ?', day),
      videoSecondsToday: this.spendSeconds(day),
    };
  }
}
