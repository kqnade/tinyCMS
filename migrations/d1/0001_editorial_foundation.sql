CREATE TABLE authors (
  id TEXT PRIMARY KEY NOT NULL CHECK (
    length(id) = 36
    AND id = lower(id)
    AND id NOT GLOB '*[^0-9a-f-]*'
    AND substr(id, 9, 1) = '-'
    AND substr(id, 14, 1) = '-'
    AND substr(id, 19, 1) = '-'
    AND substr(id, 24, 1) = '-'
    AND substr(id, 15, 1) = '7'
    AND substr(id, 20, 1) IN ('8', '9', 'a', 'b')
  ),
  access_subject TEXT NOT NULL,
  display_name TEXT NOT NULL,
  email TEXT,
  avatar_url TEXT,
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer' AND updated_at >= 0)
);

CREATE TABLE posts (
  id TEXT PRIMARY KEY NOT NULL CHECK (
    length(id) = 36
    AND id = lower(id)
    AND id NOT GLOB '*[^0-9a-f-]*'
    AND substr(id, 9, 1) = '-'
    AND substr(id, 14, 1) = '-'
    AND substr(id, 19, 1) = '-'
    AND substr(id, 24, 1) = '-'
    AND substr(id, 15, 1) = '7'
    AND substr(id, 20, 1) IN ('8', '9', 'a', 'b')
  ),
  slug TEXT NOT NULL CHECK (
    length(slug) BETWEEN 1 AND 128
    AND slug = lower(slug)
    AND slug NOT GLOB '*[^a-z0-9-]*'
    AND slug NOT GLOB '-*'
    AND slug NOT GLOB '*-'
  ),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'scheduled', 'publishing', 'published', 'archived', 'failed', 'trash')
  ),
  active_published_revision_id TEXT CHECK (
    active_published_revision_id IS NULL
    OR (
      length(active_published_revision_id) = 36
      AND active_published_revision_id = lower(active_published_revision_id)
      AND active_published_revision_id NOT GLOB '*[^0-9a-f-]*'
      AND substr(active_published_revision_id, 9, 1) = '-'
      AND substr(active_published_revision_id, 14, 1) = '-'
      AND substr(active_published_revision_id, 19, 1) = '-'
      AND substr(active_published_revision_id, 24, 1) = '-'
      AND substr(active_published_revision_id, 15, 1) = '7'
      AND substr(active_published_revision_id, 20, 1) IN ('8', '9', 'a', 'b')
    )
  ),
  scheduled_at INTEGER CHECK (
    scheduled_at IS NULL OR (typeof(scheduled_at) = 'integer' AND scheduled_at >= 0)
  ),
  canonical_url TEXT,
  noindex INTEGER NOT NULL DEFAULT 0 CHECK (typeof(noindex) = 'integer' AND noindex IN (0, 1)),
  created_by TEXT NOT NULL REFERENCES authors(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer' AND updated_at >= 0),
  FOREIGN KEY (active_published_revision_id, id)
    REFERENCES post_revisions(id, post_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE post_revisions (
  id TEXT PRIMARY KEY NOT NULL CHECK (
    length(id) = 36
    AND id = lower(id)
    AND id NOT GLOB '*[^0-9a-f-]*'
    AND substr(id, 9, 1) = '-'
    AND substr(id, 14, 1) = '-'
    AND substr(id, 19, 1) = '-'
    AND substr(id, 24, 1) = '-'
    AND substr(id, 15, 1) = '7'
    AND substr(id, 20, 1) IN ('8', '9', 'a', 'b')
  ),
  post_id TEXT NOT NULL REFERENCES posts(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (typeof(version) = 'integer' AND version >= 1),
  title TEXT NOT NULL,
  content_version INTEGER NOT NULL CHECK (typeof(content_version) = 'integer' AND content_version >= 1),
  content_json TEXT NOT NULL CHECK (typeof(content_json) = 'text' AND json_valid(content_json) = 1),
  excerpt TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (
    typeof(metadata_json) = 'text' AND json_valid(metadata_json) = 1
  ),
  author_id TEXT NOT NULL REFERENCES authors(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0)
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY NOT NULL CHECK (
    length(id) = 36
    AND id = lower(id)
    AND id NOT GLOB '*[^0-9a-f-]*'
    AND substr(id, 9, 1) = '-'
    AND substr(id, 14, 1) = '-'
    AND substr(id, 19, 1) = '-'
    AND substr(id, 24, 1) = '-'
    AND substr(id, 15, 1) = '7'
    AND substr(id, 20, 1) IN ('8', '9', 'a', 'b')
  ),
  slug TEXT NOT NULL CHECK (
    length(slug) BETWEEN 1 AND 128
    AND slug = lower(slug)
    AND slug NOT GLOB '*[^a-z0-9-]*'
    AND slug NOT GLOB '-*'
    AND slug NOT GLOB '*-'
  ),
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0)
);

CREATE TABLE post_tags (
  post_id TEXT NOT NULL REFERENCES posts(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  PRIMARY KEY (post_id, tag_id)
);

CREATE TABLE media (
  id TEXT PRIMARY KEY NOT NULL CHECK (
    length(id) = 36
    AND id = lower(id)
    AND id NOT GLOB '*[^0-9a-f-]*'
    AND substr(id, 9, 1) = '-'
    AND substr(id, 14, 1) = '-'
    AND substr(id, 19, 1) = '-'
    AND substr(id, 24, 1) = '-'
    AND substr(id, 15, 1) = '7'
    AND substr(id, 20, 1) IN ('8', '9', 'a', 'b')
  ),
  r2_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  media_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (typeof(byte_size) = 'integer' AND byte_size >= 0),
  width INTEGER CHECK (width IS NULL OR (typeof(width) = 'integer' AND width >= 0)),
  height INTEGER CHECK (height IS NULL OR (typeof(height) = 'integer' AND height >= 0)),
  alt_text TEXT NOT NULL DEFAULT '',
  content_hash TEXT,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'ready', 'failed', 'trash')),
  created_by TEXT NOT NULL REFERENCES authors(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer' AND updated_at >= 0)
);

CREATE TABLE redirects (
  id TEXT PRIMARY KEY NOT NULL CHECK (
    length(id) = 36
    AND id = lower(id)
    AND id NOT GLOB '*[^0-9a-f-]*'
    AND substr(id, 9, 1) = '-'
    AND substr(id, 14, 1) = '-'
    AND substr(id, 19, 1) = '-'
    AND substr(id, 24, 1) = '-'
    AND substr(id, 15, 1) = '7'
    AND substr(id, 20, 1) IN ('8', '9', 'a', 'b')
  ),
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  status_code INTEGER NOT NULL DEFAULT 301 CHECK (status_code IN (301, 308)),
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0)
);

CREATE TABLE publication_jobs (
  id TEXT PRIMARY KEY NOT NULL CHECK (
    length(id) = 36
    AND id = lower(id)
    AND id NOT GLOB '*[^0-9a-f-]*'
    AND substr(id, 9, 1) = '-'
    AND substr(id, 14, 1) = '-'
    AND substr(id, 19, 1) = '-'
    AND substr(id, 24, 1) = '-'
    AND substr(id, 15, 1) = '7'
    AND substr(id, 20, 1) IN ('8', '9', 'a', 'b')
  ),
  idempotency_key TEXT NOT NULL,
  post_id TEXT NOT NULL REFERENCES posts(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  revision_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'running', 'succeeded', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (typeof(attempts) = 'integer' AND attempts >= 0),
  error_message TEXT,
  available_at INTEGER CHECK (
    available_at IS NULL OR (typeof(available_at) = 'integer' AND available_at >= 0)
  ),
  started_at INTEGER CHECK (started_at IS NULL OR (typeof(started_at) = 'integer' AND started_at >= 0)),
  completed_at INTEGER CHECK (
    completed_at IS NULL OR (typeof(completed_at) = 'integer' AND completed_at >= 0)
  ),
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer' AND updated_at >= 0),
  FOREIGN KEY (revision_id, post_id)
    REFERENCES post_revisions(id, post_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE site_settings (
  id TEXT PRIMARY KEY NOT NULL CHECK (
    length(id) = 36
    AND id = lower(id)
    AND id NOT GLOB '*[^0-9a-f-]*'
    AND substr(id, 9, 1) = '-'
    AND substr(id, 14, 1) = '-'
    AND substr(id, 19, 1) = '-'
    AND substr(id, 24, 1) = '-'
    AND substr(id, 15, 1) = '7'
    AND substr(id, 20, 1) IN ('8', '9', 'a', 'b')
  ),
  setting_key TEXT NOT NULL,
  value_version INTEGER NOT NULL DEFAULT 1 CHECK (typeof(value_version) = 'integer' AND value_version >= 1),
  value_json TEXT NOT NULL CHECK (typeof(value_json) = 'text' AND json_valid(value_json) = 1),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer' AND updated_at >= 0)
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY NOT NULL CHECK (
    length(id) = 36
    AND id = lower(id)
    AND id NOT GLOB '*[^0-9a-f-]*'
    AND substr(id, 9, 1) = '-'
    AND substr(id, 14, 1) = '-'
    AND substr(id, 19, 1) = '-'
    AND substr(id, 24, 1) = '-'
    AND substr(id, 15, 1) = '7'
    AND substr(id, 20, 1) IN ('8', '9', 'a', 'b')
  ),
  actor_id TEXT REFERENCES authors(id) ON UPDATE RESTRICT ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT CHECK (
    entity_id IS NULL
    OR (
      length(entity_id) = 36
      AND entity_id = lower(entity_id)
      AND entity_id NOT GLOB '*[^0-9a-f-]*'
      AND substr(entity_id, 9, 1) = '-'
      AND substr(entity_id, 14, 1) = '-'
      AND substr(entity_id, 19, 1) = '-'
      AND substr(entity_id, 24, 1) = '-'
      AND substr(entity_id, 15, 1) = '7'
      AND substr(entity_id, 20, 1) IN ('8', '9', 'a', 'b')
    )
  ),
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (typeof(payload_json) = 'text' AND json_valid(payload_json) = 1),
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0)
);

CREATE TABLE search_chunks (
  id TEXT PRIMARY KEY NOT NULL CHECK (
    length(id) = 36
    AND id = lower(id)
    AND id NOT GLOB '*[^0-9a-f-]*'
    AND substr(id, 9, 1) = '-'
    AND substr(id, 14, 1) = '-'
    AND substr(id, 19, 1) = '-'
    AND substr(id, 24, 1) = '-'
    AND substr(id, 15, 1) = '7'
    AND substr(id, 20, 1) IN ('8', '9', 'a', 'b')
  ),
  post_id TEXT NOT NULL REFERENCES posts(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  revision_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL CHECK (typeof(chunk_index) = 'integer' AND chunk_index >= 0),
  title TEXT NOT NULL DEFAULT '',
  heading TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  FOREIGN KEY (revision_id, post_id)
    REFERENCES post_revisions(id, post_id)
    ON UPDATE RESTRICT ON DELETE CASCADE
);

CREATE UNIQUE INDEX authors_access_subject_idx ON authors (access_subject);
CREATE UNIQUE INDEX posts_slug_idx ON posts (slug);
CREATE UNIQUE INDEX post_revisions_post_version_idx ON post_revisions (post_id, version);
CREATE UNIQUE INDEX post_revisions_id_post_idx ON post_revisions (id, post_id);
CREATE UNIQUE INDEX tags_slug_idx ON tags (slug);
CREATE UNIQUE INDEX media_r2_key_idx ON media (r2_key);
CREATE UNIQUE INDEX redirects_source_idx ON redirects (source);
CREATE UNIQUE INDEX publication_jobs_idempotency_key_idx ON publication_jobs (idempotency_key);
CREATE UNIQUE INDEX site_settings_setting_key_idx ON site_settings (setting_key);
CREATE UNIQUE INDEX search_chunks_revision_chunk_idx ON search_chunks (revision_id, chunk_index);
CREATE INDEX posts_status_idx ON posts (status);
CREATE INDEX posts_active_revision_idx ON posts (active_published_revision_id);
CREATE INDEX posts_scheduled_at_idx ON posts (scheduled_at) WHERE scheduled_at IS NOT NULL;
CREATE INDEX post_revisions_post_created_at_idx ON post_revisions (post_id, created_at DESC);
CREATE INDEX post_revisions_author_idx ON post_revisions (author_id);
CREATE INDEX post_tags_tag_idx ON post_tags (tag_id, post_id);
CREATE INDEX media_state_idx ON media (state, created_at DESC);
CREATE INDEX redirects_target_idx ON redirects (target);
CREATE INDEX publication_jobs_state_idx ON publication_jobs (state, available_at, created_at);
CREATE INDEX publication_jobs_revision_idx ON publication_jobs (revision_id);
CREATE INDEX audit_events_entity_idx ON audit_events (entity_type, entity_id, created_at DESC);
CREATE INDEX search_chunks_post_revision_idx ON search_chunks (post_id, revision_id, chunk_index);

CREATE VIRTUAL TABLE search_chunks_fts USING fts5(
  id UNINDEXED,
  title,
  heading,
  body,
  tags,
  content='search_chunks',
  content_rowid='rowid'
);

CREATE TRIGGER posts_active_revision_same_post
BEFORE INSERT ON posts
WHEN NEW.active_published_revision_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM post_revisions
    WHERE id = NEW.active_published_revision_id AND post_id = NEW.id
  )
BEGIN
  SELECT RAISE(ABORT, 'active published revision must belong to post');
END;

CREATE TRIGGER posts_active_revision_same_post_update
BEFORE UPDATE OF active_published_revision_id ON posts
WHEN NEW.active_published_revision_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM post_revisions
    WHERE id = NEW.active_published_revision_id AND post_id = NEW.id
  )
BEGIN
  SELECT RAISE(ABORT, 'active published revision must belong to post');
END;

CREATE TRIGGER post_revisions_no_update
BEFORE UPDATE ON post_revisions
BEGIN
  SELECT RAISE(ABORT, 'post revisions are immutable');
END;

CREATE TRIGGER post_revisions_no_delete
BEFORE DELETE ON post_revisions
BEGIN
  SELECT RAISE(ABORT, 'post revisions are immutable');
END;

CREATE TRIGGER search_chunks_fts_insert
AFTER INSERT ON search_chunks
BEGIN
  INSERT INTO search_chunks_fts (rowid, id, title, heading, body, tags)
  VALUES (NEW.rowid, NEW.id, NEW.title, NEW.heading, NEW.body, NEW.tags);
END;

CREATE TRIGGER search_chunks_fts_delete
AFTER DELETE ON search_chunks
BEGIN
  INSERT INTO search_chunks_fts (search_chunks_fts, rowid, id, title, heading, body, tags)
  VALUES ('delete', OLD.rowid, OLD.id, OLD.title, OLD.heading, OLD.body, OLD.tags);
END;

CREATE TRIGGER search_chunks_fts_update
AFTER UPDATE ON search_chunks
BEGIN
  INSERT INTO search_chunks_fts (search_chunks_fts, rowid, id, title, heading, body, tags)
  VALUES ('delete', OLD.rowid, OLD.id, OLD.title, OLD.heading, OLD.body, OLD.tags);
  INSERT INTO search_chunks_fts (rowid, id, title, heading, body, tags)
  VALUES (NEW.rowid, NEW.id, NEW.title, NEW.heading, NEW.body, NEW.tags);
END;
