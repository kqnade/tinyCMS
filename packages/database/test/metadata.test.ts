import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("editorial D1 metadata", () => {
  it("creates the query indexes and integrity triggers", async () => {
    const metadata = await env.TEST_DB.prepare(
      "SELECT type, name FROM sqlite_master WHERE (type = 'index' OR type = 'trigger') AND name NOT LIKE 'sqlite_%' AND name != '_cf_METADATA' ORDER BY type, name",
    ).all<{ type: "index" | "trigger"; name: string }>();

    expect(metadata.results).toEqual([
      { type: "index", name: "audit_events_entity_idx" },
      { type: "index", name: "authors_access_subject_idx" },
      { type: "index", name: "media_r2_key_idx" },
      { type: "index", name: "media_state_idx" },
      { type: "index", name: "media_updated_at_id_idx" },
      { type: "index", name: "media_variants_r2_key_idx" },
      { type: "index", name: "post_revisions_author_idx" },
      { type: "index", name: "post_revisions_id_post_idx" },
      { type: "index", name: "post_revisions_post_created_at_idx" },
      { type: "index", name: "post_revisions_post_version_idx" },
      { type: "index", name: "post_tags_tag_idx" },
      { type: "index", name: "posts_active_revision_idx" },
      { type: "index", name: "posts_scheduled_at_idx" },
      { type: "index", name: "posts_slug_idx" },
      { type: "index", name: "posts_status_idx" },
      { type: "index", name: "publication_jobs_idempotency_key_idx" },
      { type: "index", name: "publication_jobs_revision_idx" },
      { type: "index", name: "publication_jobs_state_idx" },
      { type: "index", name: "redirects_source_idx" },
      { type: "index", name: "redirects_target_idx" },
      { type: "index", name: "search_chunks_post_revision_idx" },
      { type: "index", name: "search_chunks_revision_chunk_idx" },
      { type: "index", name: "site_settings_setting_key_idx" },
      { type: "index", name: "tags_slug_idx" },
      { type: "trigger", name: "post_revisions_no_delete" },
      { type: "trigger", name: "post_revisions_no_update" },
      { type: "trigger", name: "posts_active_revision_same_post" },
      { type: "trigger", name: "posts_active_revision_same_post_update" },
      { type: "trigger", name: "search_chunks_fts_delete" },
      { type: "trigger", name: "search_chunks_fts_insert" },
      { type: "trigger", name: "search_chunks_fts_update" },
    ]);
  });
});
