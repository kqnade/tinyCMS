import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const authorId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3d101";
const postId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3d102";
const revisionId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3d103";

describe("post revision immutability", () => {
  it("rejects revision updates and deletes", async () => {
    await env.TEST_DB.prepare(
      "INSERT INTO authors (id, access_subject, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(authorId, "subject-immutable", "Ada", 1_700_000_000_000, 1_700_000_000_000)
      .run();
    await env.TEST_DB.prepare(
      "INSERT INTO posts (id, slug, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(postId, "immutable-post", authorId, 1_700_000_000_000, 1_700_000_000_000)
      .run();
    await env.TEST_DB.prepare(
      "INSERT INTO post_revisions (id, post_id, version, title, content_version, content_json, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(revisionId, postId, 1, "Original", 1, '{"type":"doc"}', authorId, 1_700_000_000_000)
      .run();

    await expect(
      env.TEST_DB.prepare("UPDATE post_revisions SET title = ? WHERE id = ?")
        .bind("Changed", revisionId)
        .run(),
    ).rejects.toThrow();
    await expect(
      env.TEST_DB.prepare("DELETE FROM post_revisions WHERE id = ?").bind(revisionId).run(),
    ).rejects.toThrow();

    const revision = await env.TEST_DB.prepare("SELECT title FROM post_revisions WHERE id = ?")
      .bind(revisionId)
      .first<{ title: string }>();
    expect(revision?.title).toBe("Original");
  });
});
