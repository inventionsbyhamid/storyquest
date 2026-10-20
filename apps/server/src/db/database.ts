import Database from 'better-sqlite3';

export type Db = Database.Database;

const MIGRATIONS: string[] = [
  `
  CREATE TABLE trees (
    id TEXT PRIMARY KEY,
    idea_id TEXT,
    title TEXT NOT NULL,
    logline TEXT NOT NULL,
    audience TEXT NOT NULL,
    moods TEXT NOT NULL DEFAULT '[]',
    bible TEXT,
    prompt TEXT,
    total_scenes INTEGER NOT NULL,
    is_private INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE nodes (
    id TEXT PRIMARY KEY,
    tree_id TEXT NOT NULL REFERENCES trees(id),
    parent_id TEXT REFERENCES nodes(id),
    choice_index INTEGER,
    custom_text TEXT,
    owner_story_id TEXT,
    depth INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'generating', 'ready', 'failed')),
    summary TEXT,
    caption TEXT,
    video_prompt TEXT,
    choices TEXT NOT NULL DEFAULT '[]',
    is_ending INTEGER NOT NULL DEFAULT 0,
    new_characters TEXT NOT NULL DEFAULT '[]',
    clip_path TEXT,
    poster_path TEXT,
    last_frame_path TEXT,
    duration_ms INTEGER,
    picks INTEGER NOT NULL DEFAULT 0,
    want_children INTEGER NOT NULL DEFAULT 0,
    warm INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    error_code TEXT,
    timings TEXT,
    cost_seconds REAL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX nodes_preset_child ON nodes(parent_id, choice_index) WHERE choice_index IS NOT NULL;
  CREATE INDEX nodes_parent ON nodes(parent_id);
  CREATE INDEX nodes_tree ON nodes(tree_id);
  CREATE INDEX nodes_status ON nodes(status);

  CREATE TABLE ideas (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    position INTEGER NOT NULL,
    tree_id TEXT NOT NULL REFERENCES trees(id),
    root_node_id TEXT NOT NULL REFERENCES nodes(id),
    title TEXT NOT NULL,
    logline TEXT NOT NULL,
    audience TEXT NOT NULL,
    moods TEXT NOT NULL DEFAULT '[]',
    plays INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE (date, position)
  );

  CREATE TABLE stories (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    tree_id TEXT NOT NULL REFERENCES trees(id),
    idea_id TEXT REFERENCES ideas(id),
    path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished')),
    share_slug TEXT UNIQUE,
    movie_path TEXT,
    movie_status TEXT CHECK (movie_status IN ('pending', 'ready', 'failed')),
    created_at TEXT NOT NULL,
    finished_at TEXT
  );
  CREATE INDEX stories_device ON stories(device_id);
  CREATE INDEX stories_tree ON stories(tree_id);

  CREATE TABLE usage (
    day TEXT NOT NULL,
    device_id TEXT NOT NULL,
    custom_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, device_id)
  );

  CREATE TABLE spend (
    day TEXT PRIMARY KEY,
    video_seconds REAL NOT NULL DEFAULT 0
  );
  `,
  `
  ALTER TABLE ideas ADD COLUMN featured_at TEXT;
  CREATE INDEX ideas_featured ON ideas(featured_at) WHERE featured_at IS NOT NULL;
  ALTER TABLE trees ADD COLUMN warm_depth INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE trees ADD COLUMN warm_force INTEGER NOT NULL DEFAULT 0;
  `,
  `
  ALTER TABLE usage ADD COLUMN free_used INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE nodes ADD COLUMN charge TEXT;

  CREATE TABLE wallets (
    wallet_key TEXT PRIMARY KEY,
    sparks INTEGER NOT NULL DEFAULT 0 CHECK (sparks >= 0),
    free_sparks INTEGER NOT NULL DEFAULT 0 CHECK (free_sparks >= 0),
    purchased INTEGER NOT NULL DEFAULT 0,
    spent INTEGER NOT NULL DEFAULT 0,
    free_spent INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE purchases (
    receipt_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    sku TEXT NOT NULL,
    sparks INTEGER NOT NULL,
    mode TEXT NOT NULL,
    test_transaction INTEGER NOT NULL DEFAULT 0,
    raw TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX purchases_user ON purchases(user_id);

  CREATE TABLE devices (
    device_id TEXT PRIMARY KEY,
    scenes_seen INTEGER NOT NULL DEFAULT 0,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL
  );
  `,
  `
  ALTER TABLE nodes ADD COLUMN hidden_at TEXT;
  ALTER TABLE nodes ADD COLUMN deleted_at TEXT;

  CREATE TABLE reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id TEXT NOT NULL REFERENCES nodes(id),
    device_id TEXT NOT NULL,
    story_id TEXT,
    reason TEXT NOT NULL CHECK (reason IN ('scary', 'inappropriate', 'broken', 'other')),
    created_at TEXT NOT NULL,
    UNIQUE (node_id, device_id)
  );
  CREATE INDEX reports_node ON reports(node_id);
  `,
  `
  CREATE TABLE totals (
    name TEXT PRIMARY KEY,
    value REAL NOT NULL DEFAULT 0
  );
  INSERT INTO totals (name, value) SELECT 'video_seconds', COALESCE(SUM(video_seconds), 0) FROM spend;

  CREATE TABLE spend_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    day TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('video', 'director')),
    task TEXT NOT NULL,
    status TEXT NOT NULL,
    node_id TEXT,
    tree_id TEXT,
    idea_id TEXT,
    video_seconds REAL NOT NULL DEFAULT 0,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    ms INTEGER
  );
  CREATE INDEX spend_log_day ON spend_log(day);
  CREATE INDEX spend_log_node ON spend_log(node_id);
  `,
  `
  ALTER TABLE nodes ADD COLUMN tone TEXT;
  ALTER TABLE nodes ADD COLUMN end_tone TEXT;
  `,
];

export function openDatabase(file: string): Db {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version]!);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
}
