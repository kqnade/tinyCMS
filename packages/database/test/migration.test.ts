import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("editorial D1 migration", () => {
  it("applies the migrations and creates the editorial tables", async () => {
    const tables = await env.TEST_DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'search_chunks_fts_%' AND name != '_cf_METADATA' ORDER BY name",
    ).all<{ name: string }>();

    expect(tables.results.map(({ name }) => name)).toEqual([
      "audit_events",
      "authors",
      "d1_migrations",
      "media",
      "post_drafts",
      "post_revisions",
      "post_tags",
      "posts",
      "publication_jobs",
      "redirects",
      "search_chunks",
      "search_chunks_fts",
      "site_settings",
      "tags",
    ]);
  });
});
