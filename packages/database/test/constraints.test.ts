import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const authorId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3b001";
const postId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3b002";

describe("editorial D1 constraints", () => {
  it("rejects a post lifecycle value outside the published state machine", async () => {
    await env.TEST_DB.prepare(
      "INSERT INTO authors (id, access_subject, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(authorId, "subject-1", "Ada", 1_700_000_000_000, 1_700_000_000_000)
      .run();

    await expect(
      env.TEST_DB.prepare(
        "INSERT INTO posts (id, slug, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
        .bind(postId, "hello-world", "invalid", authorId, 1_700_000_000_000, 1_700_000_000_000)
        .run(),
    ).rejects.toThrow();
  });

  it("rejects a post that references a missing author", async () => {
    await expect(
      env.TEST_DB.prepare(
        "INSERT INTO posts (id, slug, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
        .bind(
          postId,
          "missing-author",
          "018f0e5d-6a25-7b01-8f4a-7d62a5d3b099",
          1_700_000_000_000,
          1_700_000_000_000,
        )
        .run(),
    ).rejects.toThrow();
  });

  it("rejects identifiers that are not lowercase UUIDv7 strings", async () => {
    await expect(
      env.TEST_DB.prepare(
        "INSERT INTO authors (id, access_subject, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
        .bind(
          "018F0E5D-6A25-7B01-8F4A-7D62A5D3B101",
          "subject-invalid-uuid",
          "Ada",
          1_700_000_000_000,
          1_700_000_000_000,
        )
        .run(),
    ).rejects.toThrow();
  });

  it("rejects UUIDv7 identifiers with non-canonical hyphen placement", async () => {
    await expect(
      env.TEST_DB.prepare(
        "INSERT INTO authors (id, access_subject, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
        .bind(
          "018f0e5d-6a25-7b01-8f4a-7d62a5d3e40-",
          "subject-extra-hyphen",
          "Ada",
          1_700_000_000_000,
          1_700_000_000_000,
        )
        .run(),
    ).rejects.toThrow();

    await expect(
      env.TEST_DB.prepare(
        "INSERT INTO authors (id, access_subject, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
        .bind(
          "018f0e5d6a25-7b01-8f4a-7d62a5d3e4012",
          "subject-missing-hyphen",
          "Ada",
          1_700_000_000_001,
          1_700_000_000_001,
        )
        .run(),
    ).rejects.toThrow();
  });

  it("rejects invalid booleans, timestamps, and structured JSON", async () => {
    const checkAuthorId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3c201";
    const checkPostId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3c202";
    const jsonPostId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3c205";
    await env.TEST_DB.prepare(
      "INSERT INTO authors (id, access_subject, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(checkAuthorId, "subject-checks", "Ada", 1_700_000_000_000, 1_700_000_000_000)
      .run();

    await expect(
      env.TEST_DB.prepare(
        "INSERT INTO posts (id, slug, noindex, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
        .bind(
          checkPostId,
          "invalid-boolean",
          2,
          checkAuthorId,
          1_700_000_000_000,
          1_700_000_000_000,
        )
        .run(),
    ).rejects.toThrow();
    await env.TEST_DB.prepare(
      "INSERT INTO posts (id, slug, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(
        jsonPostId,
        "structured-json-check",
        checkAuthorId,
        1_700_000_000_000,
        1_700_000_000_000,
      )
      .run();
    await expect(
      env.TEST_DB.prepare(
        "INSERT INTO authors (id, access_subject, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
        .bind(
          "018f0e5d-6a25-7b01-8f4a-7d62a5d3c203",
          "subject-invalid-time",
          "Ada",
          "not-a-time",
          1_700_000_000_000,
        )
        .run(),
    ).rejects.toThrow();
    await expect(
      env.TEST_DB.prepare(
        "INSERT INTO post_revisions (id, post_id, version, title, content_version, content_json, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(
          "018f0e5d-6a25-7b01-8f4a-7d62a5d3c204",
          jsonPostId,
          1,
          "Invalid JSON",
          1,
          "not-json",
          checkAuthorId,
          1_700_000_000_000,
        )
        .run(),
    ).rejects.toThrow();
  });

  it("rejects a publication job state outside pending, running, succeeded, or failed", async () => {
    const jobAuthorId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3c301";
    const jobPostId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3c302";
    const jobRevisionId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3c303";
    await env.TEST_DB.prepare(
      "INSERT INTO authors (id, access_subject, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(jobAuthorId, "subject-job-state", "Ada", 1_700_000_000_000, 1_700_000_000_000)
      .run();
    await env.TEST_DB.prepare(
      "INSERT INTO posts (id, slug, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(jobPostId, "job-state-post", jobAuthorId, 1_700_000_000_000, 1_700_000_000_000)
      .run();
    await env.TEST_DB.prepare(
      "INSERT INTO post_revisions (id, post_id, version, title, content_version, content_json, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        jobRevisionId,
        jobPostId,
        1,
        "Job state",
        1,
        '{"type":"doc"}',
        jobAuthorId,
        1_700_000_000_000,
      )
      .run();
    await expect(
      env.TEST_DB.prepare(
        "INSERT INTO publication_jobs (id, idempotency_key, post_id, revision_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(
          "018f0e5d-6a25-7b01-8f4a-7d62a5d3c304",
          "job-invalid-state",
          jobPostId,
          jobRevisionId,
          "queued",
          1_700_000_000_000,
          1_700_000_000_000,
        )
        .run(),
    ).rejects.toThrow();
  });

  it("rejects duplicate slugs, redirect sources, job keys, and revision versions", async () => {
    const duplicateAuthorId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3a101";
    const duplicatePostId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3a102";
    const duplicateRevisionId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3a103";
    const duplicateTagId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3a104";
    const duplicateRedirectId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3a105";
    const duplicateJobId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3a106";

    await env.TEST_DB.prepare(
      "INSERT INTO authors (id, access_subject, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(duplicateAuthorId, "subject-unique", "Ada", 1_700_000_000_000, 1_700_000_000_000)
      .run();
    await env.TEST_DB.prepare(
      "INSERT INTO posts (id, slug, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(duplicatePostId, "unique-post", duplicateAuthorId, 1_700_000_000_000, 1_700_000_000_000)
      .run();
    await env.TEST_DB.prepare(
      "INSERT INTO post_revisions (id, post_id, version, title, content_version, content_json, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        duplicateRevisionId,
        duplicatePostId,
        1,
        "First",
        1,
        '{"type":"doc"}',
        duplicateAuthorId,
        1_700_000_000_000,
      )
      .run();
    await env.TEST_DB.prepare("INSERT INTO tags (id, slug, name, created_at) VALUES (?, ?, ?, ?)")
      .bind(duplicateTagId, "unique-tag", "Unique tag", 1_700_000_000_000)
      .run();
    await env.TEST_DB.prepare(
      "INSERT INTO redirects (id, source, target, created_at) VALUES (?, ?, ?, ?)",
    )
      .bind(duplicateRedirectId, "/old", "/new", 1_700_000_000_000)
      .run();
    await env.TEST_DB.prepare(
      "INSERT INTO publication_jobs (id, idempotency_key, post_id, revision_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(
        duplicateJobId,
        "publish-unique",
        duplicatePostId,
        duplicateRevisionId,
        1_700_000_000_000,
        1_700_000_000_000,
      )
      .run();

    await expect(
      env.TEST_DB.prepare(
        "INSERT INTO posts (id, slug, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
        .bind(
          "018f0e5d-6a25-7b01-8f4a-7d62a5d3a107",
          "unique-post",
          duplicateAuthorId,
          1_700_000_000_001,
          1_700_000_000_001,
        )
        .run(),
    ).rejects.toThrow();
    await expect(
      env.TEST_DB.prepare("INSERT INTO tags (id, slug, name, created_at) VALUES (?, ?, ?, ?)")
        .bind("018f0e5d-6a25-7b01-8f4a-7d62a5d3a108", "unique-tag", "Duplicate", 1_700_000_000_001)
        .run(),
    ).rejects.toThrow();
    await expect(
      env.TEST_DB.prepare(
        "INSERT INTO redirects (id, source, target, created_at) VALUES (?, ?, ?, ?)",
      )
        .bind("018f0e5d-6a25-7b01-8f4a-7d62a5d3a109", "/old", "/other", 1_700_000_000_001)
        .run(),
    ).rejects.toThrow();
    await expect(
      env.TEST_DB.prepare(
        "INSERT INTO publication_jobs (id, idempotency_key, post_id, revision_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
        .bind(
          "018f0e5d-6a25-7b01-8f4a-7d62a5d3a10a",
          "publish-unique",
          duplicatePostId,
          duplicateRevisionId,
          1_700_000_000_001,
          1_700_000_000_001,
        )
        .run(),
    ).rejects.toThrow();
    await expect(
      env.TEST_DB.prepare(
        "INSERT INTO post_revisions (id, post_id, version, title, content_version, content_json, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(
          "018f0e5d-6a25-7b01-8f4a-7d62a5d3a10b",
          duplicatePostId,
          1,
          "Duplicate",
          1,
          '{"type":"doc"}',
          duplicateAuthorId,
          1_700_000_000_001,
        )
        .run(),
    ).rejects.toThrow();
  });

  it("rejects post draft versions below one", async () => {
    const draftAuthorId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3d101";
    const draftPostId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3d102";

    await env.TEST_DB.prepare(
      "INSERT INTO authors (id, access_subject, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(draftAuthorId, "subject-draft-version", "Ada", 1_700_000_000_000, 1_700_000_000_000)
      .run();
    await env.TEST_DB.prepare(
      "INSERT INTO posts (id, slug, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(draftPostId, "draft-version", draftAuthorId, 1_700_000_000_000, 1_700_000_000_000)
      .run();

    await expect(
      env.TEST_DB.prepare(
        "INSERT INTO post_drafts (post_id, version, title, content_version, content_json, author_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(draftPostId, 0, "Draft", 1, '{"type":"doc"}', draftAuthorId, 1_700_000_000_000)
        .run(),
    ).rejects.toThrow();
  });

  it("rejects post draft content versions below one", async () => {
    const draftAuthorId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3d201";
    const draftPostId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3d202";

    await env.TEST_DB.prepare(
      "INSERT INTO authors (id, access_subject, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(
        draftAuthorId,
        "subject-draft-content-version",
        "Ada",
        1_700_000_000_000,
        1_700_000_000_000,
      )
      .run();
    await env.TEST_DB.prepare(
      "INSERT INTO posts (id, slug, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(
        draftPostId,
        "draft-content-version",
        draftAuthorId,
        1_700_000_000_000,
        1_700_000_000_000,
      )
      .run();

    await expect(
      env.TEST_DB.prepare(
        "INSERT INTO post_drafts (post_id, version, title, content_version, content_json, author_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(draftPostId, 1, "Draft", 0, '{"type":"doc"}', draftAuthorId, 1_700_000_000_000)
        .run(),
    ).rejects.toThrow();
  });

  it("rejects invalid post draft content JSON", async () => {
    const draftAuthorId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3d301";
    const draftPostId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3d302";

    await env.TEST_DB.prepare(
      "INSERT INTO authors (id, access_subject, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(
        draftAuthorId,
        "subject-draft-content-json",
        "Ada",
        1_700_000_000_000,
        1_700_000_000_000,
      )
      .run();
    await env.TEST_DB.prepare(
      "INSERT INTO posts (id, slug, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(draftPostId, "draft-content-json", draftAuthorId, 1_700_000_000_000, 1_700_000_000_000)
      .run();

    await expect(
      env.TEST_DB.prepare(
        "INSERT INTO post_drafts (post_id, version, title, content_version, content_json, author_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(draftPostId, 1, "Draft", 1, "not-json", draftAuthorId, 1_700_000_000_000)
        .run(),
    ).rejects.toThrow();
  });

  it("defaults draft metadata to valid JSON and rejects invalid metadata", async () => {
    const draftAuthorId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3d401";
    const draftPostId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3d402";

    await env.TEST_DB.prepare(
      "INSERT INTO authors (id, access_subject, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(draftAuthorId, "subject-draft-metadata", "Ada", 1_700_000_000_000, 1_700_000_000_000)
      .run();
    await env.TEST_DB.prepare(
      "INSERT INTO posts (id, slug, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(draftPostId, "draft-metadata", draftAuthorId, 1_700_000_000_000, 1_700_000_000_000)
      .run();
    await env.TEST_DB.prepare(
      "INSERT INTO post_drafts (post_id, version, title, content_version, content_json, author_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(draftPostId, 1, "Draft", 1, '{"type":"doc"}', draftAuthorId, 1_700_000_000_000)
      .run();

    const draft = await env.TEST_DB.prepare(
      "SELECT metadata_json FROM post_drafts WHERE post_id = ?",
    )
      .bind(draftPostId)
      .first<{ metadata_json: string }>();
    expect(draft?.metadata_json).toBe("{}");

    await expect(
      env.TEST_DB.prepare("UPDATE post_drafts SET metadata_json = ? WHERE post_id = ?")
        .bind("not-json", draftPostId)
        .run(),
    ).rejects.toThrow();
  });

  it("rejects negative post draft timestamps", async () => {
    const draftAuthorId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3d501";
    const draftPostId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3d502";

    await env.TEST_DB.prepare(
      "INSERT INTO authors (id, access_subject, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(draftAuthorId, "subject-draft-timestamp", "Ada", 1_700_000_000_000, 1_700_000_000_000)
      .run();
    await env.TEST_DB.prepare(
      "INSERT INTO posts (id, slug, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(draftPostId, "draft-timestamp", draftAuthorId, 1_700_000_000_000, 1_700_000_000_000)
      .run();

    await expect(
      env.TEST_DB.prepare(
        "INSERT INTO post_drafts (post_id, version, title, content_version, content_json, author_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(draftPostId, 1, "Draft", 1, '{"type":"doc"}', draftAuthorId, -1)
        .run(),
    ).rejects.toThrow();
  });

  it("cascades post draft deletion when its post is deleted", async () => {
    const draftAuthorId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3d601";
    const draftPostId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3d602";

    await env.TEST_DB.prepare(
      "INSERT INTO authors (id, access_subject, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(draftAuthorId, "subject-draft-cascade", "Ada", 1_700_000_000_000, 1_700_000_000_000)
      .run();
    await env.TEST_DB.prepare(
      "INSERT INTO posts (id, slug, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(draftPostId, "draft-cascade", draftAuthorId, 1_700_000_000_000, 1_700_000_000_000)
      .run();
    await env.TEST_DB.prepare(
      "INSERT INTO post_drafts (post_id, version, title, content_version, content_json, author_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(draftPostId, 1, "Draft", 1, '{"type":"doc"}', draftAuthorId, 1_700_000_000_000)
      .run();

    await env.TEST_DB.prepare("DELETE FROM posts WHERE id = ?").bind(draftPostId).run();

    const draft = await env.TEST_DB.prepare("SELECT post_id FROM post_drafts WHERE post_id = ?")
      .bind(draftPostId)
      .first();
    expect(draft).toBeNull();
  });

  it("restricts deleting an author referenced by a post draft", async () => {
    const postAuthorId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3d701";
    const draftAuthorId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3d702";
    const draftPostId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3d703";

    await env.TEST_DB.prepare(
      "INSERT INTO authors (id, access_subject, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)",
    )
      .bind(
        postAuthorId,
        "subject-draft-post-author",
        "Ada",
        1_700_000_000_000,
        1_700_000_000_000,
        draftAuthorId,
        "subject-draft-author",
        "Grace",
        1_700_000_000_000,
        1_700_000_000_000,
      )
      .run();
    await env.TEST_DB.prepare(
      "INSERT INTO posts (id, slug, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(draftPostId, "draft-author", postAuthorId, 1_700_000_000_000, 1_700_000_000_000)
      .run();
    await env.TEST_DB.prepare(
      "INSERT INTO post_drafts (post_id, version, title, content_version, content_json, author_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(draftPostId, 1, "Draft", 1, '{"type":"doc"}', draftAuthorId, 1_700_000_000_000)
      .run();

    await expect(
      env.TEST_DB.prepare("DELETE FROM authors WHERE id = ?").bind(draftAuthorId).run(),
    ).rejects.toThrow();
  });
});
