import { desc, type SQLWrapper, sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const uuidv7Check = (column: SQLWrapper) => sql`
  length(${column}) = 36
  AND length(replace(${column}, '-', '')) = 32
  AND ${column} = lower(${column})
  AND ${column} NOT GLOB '*[^0-9a-f-]*'
  AND substr(${column}, 9, 1) = '-'
  AND substr(${column}, 14, 1) = '-'
  AND substr(${column}, 19, 1) = '-'
  AND substr(${column}, 24, 1) = '-'
  AND substr(${column}, 15, 1) = '7'
  AND substr(${column}, 20, 1) IN ('8', '9', 'a', 'b')
`;

const epochMillisecondsCheck = (column: SQLWrapper) =>
  sql`typeof(${column}) = 'integer' AND ${column} >= 0`;

const nullableEpochMillisecondsCheck = (column: SQLWrapper) =>
  sql`${column} IS NULL OR (${epochMillisecondsCheck(column)})`;

const booleanCheck = (column: SQLWrapper) =>
  sql`typeof(${column}) = 'integer' AND ${column} IN (0, 1)`;

const jsonTextCheck = (column: SQLWrapper) =>
  sql`typeof(${column}) = 'text' AND json_valid(${column}) = 1`;

const slugCheck = (column: SQLWrapper) => sql`
  length(${column}) BETWEEN 1 AND 128
  AND ${column} = lower(${column})
  AND ${column} NOT GLOB '*[^a-z0-9-]*'
  AND ${column} NOT GLOB '-*'
  AND ${column} NOT GLOB '*-'
`;

const postRevisionReferenceColumns = (): [AnySQLiteColumn, AnySQLiteColumn] => [
  postRevisions.id,
  postRevisions.postId,
];

export const authors = sqliteTable(
  "authors",
  {
    id: text("id").primaryKey(),
    accessSubject: text("access_subject").notNull(),
    displayName: text("display_name").notNull(),
    email: text("email"),
    avatarUrl: text("avatar_url"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("authors_access_subject_idx").on(table.accessSubject),
    check("authors_id_uuidv7_check", uuidv7Check(table.id)),
    check("authors_created_at_epoch_ms_check", epochMillisecondsCheck(table.createdAt)),
    check("authors_updated_at_epoch_ms_check", epochMillisecondsCheck(table.updatedAt)),
  ],
);

export const posts = sqliteTable(
  "posts",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    status: text("status").notNull().default("draft"),
    activePublishedRevisionId: text("active_published_revision_id"),
    scheduledAt: integer("scheduled_at"),
    canonicalUrl: text("canonical_url"),
    noindex: integer("noindex").notNull().default(0),
    createdBy: text("created_by")
      .notNull()
      .references(() => authors.id, { onUpdate: "restrict", onDelete: "restrict" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("posts_slug_idx").on(table.slug),
    index("posts_status_idx").on(table.status),
    index("posts_active_revision_idx").on(table.activePublishedRevisionId),
    index("posts_scheduled_at_idx")
      .on(table.scheduledAt)
      .where(sql`${table.scheduledAt} IS NOT NULL`),
    foreignKey({
      name: "posts_active_published_revision_id_id_fk",
      columns: [table.activePublishedRevisionId, table.id],
      foreignColumns: postRevisionReferenceColumns(),
    })
      .onUpdate("restrict")
      .onDelete("restrict"),
    check("posts_id_uuidv7_check", uuidv7Check(table.id)),
    check("posts_slug_check", slugCheck(table.slug)),
    check(
      "posts_status_check",
      sql`${table.status} IN ('draft', 'scheduled', 'publishing', 'published', 'archived', 'failed', 'trash')`,
    ),
    check(
      "posts_active_published_revision_id_uuidv7_check",
      sql`${table.activePublishedRevisionId} IS NULL OR (${uuidv7Check(table.activePublishedRevisionId)})`,
    ),
    check("posts_scheduled_at_epoch_ms_check", nullableEpochMillisecondsCheck(table.scheduledAt)),
    check("posts_noindex_boolean_check", booleanCheck(table.noindex)),
    check("posts_created_at_epoch_ms_check", epochMillisecondsCheck(table.createdAt)),
    check("posts_updated_at_epoch_ms_check", epochMillisecondsCheck(table.updatedAt)),
  ],
);

export const postRevisions = sqliteTable(
  "post_revisions",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onUpdate: "restrict", onDelete: "cascade" }),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    contentVersion: integer("content_version").notNull(),
    contentJson: text("content_json").notNull(),
    excerpt: text("excerpt"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    authorId: text("author_id")
      .notNull()
      .references(() => authors.id, { onUpdate: "restrict", onDelete: "restrict" }),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("post_revisions_post_version_idx").on(table.postId, table.version),
    uniqueIndex("post_revisions_id_post_idx").on(table.id, table.postId),
    index("post_revisions_post_created_at_idx").on(table.postId, desc(table.createdAt)),
    index("post_revisions_author_idx").on(table.authorId),
    check("post_revisions_id_uuidv7_check", uuidv7Check(table.id)),
    check(
      "post_revisions_version_check",
      sql`typeof(${table.version}) = 'integer' AND ${table.version} >= 1`,
    ),
    check(
      "post_revisions_content_version_check",
      sql`typeof(${table.contentVersion}) = 'integer' AND ${table.contentVersion} >= 1`,
    ),
    check("post_revisions_content_json_check", jsonTextCheck(table.contentJson)),
    check("post_revisions_metadata_json_check", jsonTextCheck(table.metadataJson)),
    check("post_revisions_created_at_epoch_ms_check", epochMillisecondsCheck(table.createdAt)),
  ],
);

export const tags = sqliteTable(
  "tags",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("tags_slug_idx").on(table.slug),
    check("tags_id_uuidv7_check", uuidv7Check(table.id)),
    check("tags_slug_check", slugCheck(table.slug)),
    check("tags_created_at_epoch_ms_check", epochMillisecondsCheck(table.createdAt)),
  ],
);

export const postTags = sqliteTable(
  "post_tags",
  {
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onUpdate: "restrict", onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onUpdate: "restrict", onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.tagId] }),
    index("post_tags_tag_idx").on(table.tagId, table.postId),
    check("post_tags_created_at_epoch_ms_check", epochMillisecondsCheck(table.createdAt)),
  ],
);

export const media = sqliteTable(
  "media",
  {
    id: text("id").primaryKey(),
    r2Key: text("r2_key").notNull(),
    filename: text("filename").notNull(),
    mediaType: text("media_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width"),
    height: integer("height"),
    altText: text("alt_text").notNull().default(""),
    contentHash: text("content_hash"),
    state: text("state").notNull().default("pending"),
    createdBy: text("created_by")
      .notNull()
      .references(() => authors.id, { onUpdate: "restrict", onDelete: "restrict" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("media_r2_key_idx").on(table.r2Key),
    index("media_state_idx").on(table.state, desc(table.createdAt)),
    check("media_id_uuidv7_check", uuidv7Check(table.id)),
    check(
      "media_byte_size_check",
      sql`typeof(${table.byteSize}) = 'integer' AND ${table.byteSize} >= 0`,
    ),
    check(
      "media_width_check",
      sql`${table.width} IS NULL OR (typeof(${table.width}) = 'integer' AND ${table.width} >= 0)`,
    ),
    check(
      "media_height_check",
      sql`${table.height} IS NULL OR (typeof(${table.height}) = 'integer' AND ${table.height} >= 0)`,
    ),
    check("media_state_check", sql`${table.state} IN ('pending', 'ready', 'failed', 'trash')`),
    check("media_created_at_epoch_ms_check", epochMillisecondsCheck(table.createdAt)),
    check("media_updated_at_epoch_ms_check", epochMillisecondsCheck(table.updatedAt)),
  ],
);

export const redirects = sqliteTable(
  "redirects",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    target: text("target").notNull(),
    statusCode: integer("status_code").notNull().default(301),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("redirects_source_idx").on(table.source),
    index("redirects_target_idx").on(table.target),
    check("redirects_id_uuidv7_check", uuidv7Check(table.id)),
    check("redirects_status_code_check", sql`${table.statusCode} IN (301, 308)`),
    check("redirects_created_at_epoch_ms_check", epochMillisecondsCheck(table.createdAt)),
  ],
);

export const publicationJobs = sqliteTable(
  "publication_jobs",
  {
    id: text("id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onUpdate: "restrict", onDelete: "restrict" }),
    revisionId: text("revision_id").notNull(),
    state: text("state").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    errorMessage: text("error_message"),
    availableAt: integer("available_at"),
    startedAt: integer("started_at"),
    completedAt: integer("completed_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("publication_jobs_idempotency_key_idx").on(table.idempotencyKey),
    index("publication_jobs_state_idx").on(table.state, table.availableAt, table.createdAt),
    index("publication_jobs_revision_idx").on(table.revisionId),
    foreignKey({
      name: "publication_jobs_revision_post_fk",
      columns: [table.revisionId, table.postId],
      foreignColumns: [postRevisions.id, postRevisions.postId],
    })
      .onUpdate("restrict")
      .onDelete("restrict"),
    check("publication_jobs_id_uuidv7_check", uuidv7Check(table.id)),
    check(
      "publication_jobs_state_check",
      sql`${table.state} IN ('pending', 'running', 'succeeded', 'failed')`,
    ),
    check(
      "publication_jobs_attempts_check",
      sql`typeof(${table.attempts}) = 'integer' AND ${table.attempts} >= 0`,
    ),
    check(
      "publication_jobs_available_at_epoch_ms_check",
      nullableEpochMillisecondsCheck(table.availableAt),
    ),
    check(
      "publication_jobs_started_at_epoch_ms_check",
      nullableEpochMillisecondsCheck(table.startedAt),
    ),
    check(
      "publication_jobs_completed_at_epoch_ms_check",
      nullableEpochMillisecondsCheck(table.completedAt),
    ),
    check("publication_jobs_created_at_epoch_ms_check", epochMillisecondsCheck(table.createdAt)),
    check("publication_jobs_updated_at_epoch_ms_check", epochMillisecondsCheck(table.updatedAt)),
  ],
);

export const siteSettings = sqliteTable(
  "site_settings",
  {
    id: text("id").primaryKey(),
    settingKey: text("setting_key").notNull(),
    valueVersion: integer("value_version").notNull().default(1),
    valueJson: text("value_json").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("site_settings_setting_key_idx").on(table.settingKey),
    check("site_settings_id_uuidv7_check", uuidv7Check(table.id)),
    check(
      "site_settings_value_version_check",
      sql`typeof(${table.valueVersion}) = 'integer' AND ${table.valueVersion} >= 1`,
    ),
    check("site_settings_value_json_check", jsonTextCheck(table.valueJson)),
    check("site_settings_updated_at_epoch_ms_check", epochMillisecondsCheck(table.updatedAt)),
  ],
);

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id").references(() => authors.id, {
      onUpdate: "restrict",
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    payloadJson: text("payload_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("audit_events_entity_idx").on(table.entityType, table.entityId, desc(table.createdAt)),
    check("audit_events_id_uuidv7_check", uuidv7Check(table.id)),
    check(
      "audit_events_entity_id_uuidv7_check",
      sql`${table.entityId} IS NULL OR (${uuidv7Check(table.entityId)})`,
    ),
    check("audit_events_payload_json_check", jsonTextCheck(table.payloadJson)),
    check("audit_events_created_at_epoch_ms_check", epochMillisecondsCheck(table.createdAt)),
  ],
);

export const searchChunks = sqliteTable(
  "search_chunks",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onUpdate: "restrict", onDelete: "cascade" }),
    revisionId: text("revision_id").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    title: text("title").notNull().default(""),
    heading: text("heading").notNull().default(""),
    body: text("body").notNull(),
    tags: text("tags").notNull().default(""),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("search_chunks_revision_chunk_idx").on(table.revisionId, table.chunkIndex),
    index("search_chunks_post_revision_idx").on(table.postId, table.revisionId, table.chunkIndex),
    foreignKey({
      name: "search_chunks_revision_post_fk",
      columns: [table.revisionId, table.postId],
      foreignColumns: [postRevisions.id, postRevisions.postId],
    })
      .onUpdate("restrict")
      .onDelete("cascade"),
    check("search_chunks_id_uuidv7_check", uuidv7Check(table.id)),
    check(
      "search_chunks_chunk_index_check",
      sql`typeof(${table.chunkIndex}) = 'integer' AND ${table.chunkIndex} >= 0`,
    ),
    check("search_chunks_created_at_epoch_ms_check", epochMillisecondsCheck(table.createdAt)),
  ],
);

export const searchChunksFtsTableName = "search_chunks_fts" as const;

export const schema = {
  authors,
  posts,
  postRevisions,
  tags,
  postTags,
  media,
  redirects,
  publicationJobs,
  siteSettings,
  auditEvents,
  searchChunks,
};
