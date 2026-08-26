import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { postRevisions, posts, schema, searchChunksFtsTableName } from "../src/schema";

describe("Drizzle editorial schema", () => {
  it("exports all relational tables and the composite active-revision foreign key", () => {
    const tableNames = Object.values(schema)
      .map((table) => getTableConfig(table).name)
      .sort();
    expect(tableNames).toEqual([
      "audit_events",
      "authors",
      "media",
      "post_drafts",
      "post_revisions",
      "post_tags",
      "posts",
      "publication_jobs",
      "redirects",
      "search_chunks",
      "site_settings",
      "tags",
    ]);
    expect(
      Object.fromEntries(
        Object.values(schema).map((table) => {
          const config = getTableConfig(table);
          return [config.name, config.columns.map((column) => column.name)];
        }),
      ),
    ).toEqual({
      audit_events: [
        "id",
        "actor_id",
        "action",
        "entity_type",
        "entity_id",
        "payload_json",
        "created_at",
      ],
      authors: [
        "id",
        "access_subject",
        "display_name",
        "email",
        "avatar_url",
        "created_at",
        "updated_at",
      ],
      media: [
        "id",
        "r2_key",
        "filename",
        "media_type",
        "byte_size",
        "width",
        "height",
        "alt_text",
        "content_hash",
        "state",
        "created_by",
        "created_at",
        "updated_at",
      ],
      post_revisions: [
        "id",
        "post_id",
        "version",
        "title",
        "content_version",
        "content_json",
        "excerpt",
        "metadata_json",
        "author_id",
        "created_at",
      ],
      post_drafts: [
        "post_id",
        "version",
        "title",
        "content_version",
        "content_json",
        "excerpt",
        "metadata_json",
        "author_id",
        "updated_at",
      ],
      post_tags: ["post_id", "tag_id", "created_at"],
      posts: [
        "id",
        "slug",
        "status",
        "active_published_revision_id",
        "scheduled_at",
        "canonical_url",
        "noindex",
        "created_by",
        "created_at",
        "updated_at",
      ],
      publication_jobs: [
        "id",
        "idempotency_key",
        "post_id",
        "revision_id",
        "state",
        "attempts",
        "error_message",
        "available_at",
        "started_at",
        "completed_at",
        "created_at",
        "updated_at",
      ],
      redirects: ["id", "source", "target", "status_code", "created_at"],
      search_chunks: [
        "id",
        "post_id",
        "revision_id",
        "chunk_index",
        "title",
        "heading",
        "body",
        "tags",
        "created_at",
      ],
      site_settings: ["id", "setting_key", "value_version", "value_json", "updated_at"],
      tags: ["id", "slug", "name", "created_at"],
    });
    expect(searchChunksFtsTableName).toBe("search_chunks_fts");

    const postForeignKeys = getTableConfig(posts).foreignKeys.map((foreignKey) => {
      const reference = foreignKey.reference();
      return {
        columns: reference.columns.map((column) => column.name),
        foreignColumns: reference.foreignColumns.map((column) => column.name),
      };
    });
    expect(postForeignKeys).toContainEqual({
      columns: ["active_published_revision_id", "id"],
      foreignColumns: ["id", "post_id"],
    });
    expect(getTableConfig(postRevisions).checks.map(({ name }) => name)).toContain(
      "post_revisions_content_json_check",
    );
  });
});
