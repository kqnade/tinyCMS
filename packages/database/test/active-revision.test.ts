import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const authorId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3e101";
const firstPostId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3e102";
const secondPostId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3e103";
const firstRevisionId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3e104";
const secondRevisionId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3e105";

describe("active published revision ownership", () => {
  it("rejects an active revision belonging to another post", async () => {
    await env.TEST_DB.prepare(
      "INSERT INTO authors (id, access_subject, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(authorId, "subject-active", "Ada", 1_700_000_000_000, 1_700_000_000_000)
      .run();
    await env.TEST_DB.prepare(
      "INSERT INTO posts (id, slug, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)",
    )
      .bind(
        firstPostId,
        "first-post",
        authorId,
        1_700_000_000_000,
        1_700_000_000_000,
        secondPostId,
        "second-post",
        authorId,
        1_700_000_000_000,
        1_700_000_000_000,
      )
      .run();
    await env.TEST_DB.prepare(
      "INSERT INTO post_revisions (id, post_id, version, title, content_version, content_json, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        firstRevisionId,
        firstPostId,
        1,
        "First",
        1,
        '{"type":"doc"}',
        authorId,
        1_700_000_000_000,
        secondRevisionId,
        secondPostId,
        1,
        "Second",
        1,
        '{"type":"doc"}',
        authorId,
        1_700_000_000_000,
      )
      .run();

    await expect(
      env.TEST_DB.prepare("UPDATE posts SET active_published_revision_id = ? WHERE id = ?")
        .bind(secondRevisionId, firstPostId)
        .run(),
    ).rejects.toThrow();

    await env.TEST_DB.prepare("UPDATE posts SET active_published_revision_id = ? WHERE id = ?")
      .bind(firstRevisionId, firstPostId)
      .run();
    const post = await env.TEST_DB.prepare(
      "SELECT active_published_revision_id FROM posts WHERE id = ?",
    )
      .bind(firstPostId)
      .first<{ active_published_revision_id: string }>();
    expect(post?.active_published_revision_id).toBe(firstRevisionId);
  });
});
