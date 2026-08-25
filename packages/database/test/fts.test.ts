import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const authorId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3f101";
const postId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3f102";
const revisionId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3f103";
const chunkId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3f104";

describe("search chunk FTS synchronization", () => {
  it("indexes, updates, and removes representative search chunks", async () => {
    await env.TEST_DB.prepare(
      "INSERT INTO authors (id, access_subject, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(authorId, "subject-fts", "Ada", 1_700_000_000_000, 1_700_000_000_000)
      .run();
    await env.TEST_DB.prepare(
      "INSERT INTO posts (id, slug, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(postId, "fts-post", authorId, 1_700_000_000_000, 1_700_000_000_000)
      .run();
    await env.TEST_DB.prepare(
      "INSERT INTO post_revisions (id, post_id, version, title, content_version, content_json, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(revisionId, postId, 1, "FTS", 1, '{"type":"doc"}', authorId, 1_700_000_000_000)
      .run();
    await env.TEST_DB.prepare(
      "INSERT INTO search_chunks (id, post_id, revision_id, chunk_index, title, heading, body, tags, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        chunkId,
        postId,
        revisionId,
        0,
        "Cloudflare",
        "Workers",
        "Cloudflare edge publishing",
        "edge",
        1_700_000_000_000,
      )
      .run();

    const inserted = await env.TEST_DB.prepare(
      "SELECT id FROM search_chunks_fts WHERE search_chunks_fts MATCH ?",
    )
      .bind("Cloudflare")
      .all<{ id: string }>();
    expect(inserted.results.map(({ id }) => id)).toEqual([chunkId]);

    await env.TEST_DB.prepare("UPDATE search_chunks SET body = ?, title = ? WHERE id = ?")
      .bind("SQLite migration testing", "SQLite", chunkId)
      .run();
    const oldTerm = await env.TEST_DB.prepare(
      "SELECT id FROM search_chunks_fts WHERE search_chunks_fts MATCH ?",
    )
      .bind("Cloudflare")
      .all<{ id: string }>();
    const newTerm = await env.TEST_DB.prepare(
      "SELECT id FROM search_chunks_fts WHERE search_chunks_fts MATCH ?",
    )
      .bind("SQLite")
      .all<{ id: string }>();
    expect(oldTerm.results).toHaveLength(0);
    expect(newTerm.results.map(({ id }) => id)).toEqual([chunkId]);

    await env.TEST_DB.prepare("DELETE FROM search_chunks WHERE id = ?").bind(chunkId).run();
    const deleted = await env.TEST_DB.prepare(
      "SELECT id FROM search_chunks_fts WHERE search_chunks_fts MATCH ?",
    )
      .bind("SQLite")
      .all<{ id: string }>();
    expect(deleted.results).toHaveLength(0);
  });
});
