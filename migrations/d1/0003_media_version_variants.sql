ALTER TABLE media
ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (typeof(version) = 'integer' AND version >= 1);

CREATE TABLE media_variants (
  media_id TEXT NOT NULL REFERENCES media(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  name TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('avif', 'webp')),
  r2_key TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (typeof(byte_size) = 'integer' AND byte_size >= 0),
  width INTEGER NOT NULL CHECK (typeof(width) = 'integer' AND width > 0),
  height INTEGER NOT NULL CHECK (typeof(height) = 'integer' AND height > 0),
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  PRIMARY KEY (media_id, name)
);

CREATE UNIQUE INDEX media_variants_r2_key_idx ON media_variants (r2_key);
CREATE INDEX media_updated_at_id_idx ON media (updated_at DESC, id DESC);
