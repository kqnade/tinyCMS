CREATE TABLE post_drafts (
  post_id TEXT PRIMARY KEY NOT NULL REFERENCES posts(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (typeof(version) = 'integer' AND version >= 1),
  title TEXT NOT NULL,
  content_version INTEGER NOT NULL CHECK (typeof(content_version) = 'integer' AND content_version >= 1),
  content_json TEXT NOT NULL CHECK (typeof(content_json) = 'text' AND json_valid(content_json) = 1),
  excerpt TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (
    typeof(metadata_json) = 'text' AND json_valid(metadata_json) = 1
  ),
  author_id TEXT NOT NULL REFERENCES authors(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer' AND updated_at >= 0)
);
