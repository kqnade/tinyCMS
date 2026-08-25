import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createEditorialRepository, RepositoryError, RepositoryErrorCode } from "../src/repository";

describe("editorial repository", () => {
  it("creates and reads an author, draft post, and initial revision", async () => {
    const repository = createEditorialRepository(env.TEST_DB);
    const input = {
      author: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3e401",
        accessSubject: "subject-repository-success",
        displayName: "Ada Lovelace",
        email: "ada@example.com",
        avatarUrl: "https://example.com/ada.png",
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_001,
      },
      post: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3e402",
        slug: "repository-success",
        canonicalUrl: "https://example.com/repository-success",
        noindex: 1 as const,
        createdAt: 1_700_000_000_002,
        updatedAt: 1_700_000_000_003,
      },
      revision: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3e403",
        version: 1,
        title: "Repository success",
        contentVersion: 2,
        contentJson: '{"type":"doc","children":[]}',
        excerpt: "An exact excerpt",
        metadataJson: '{"template":"article"}',
        createdAt: 1_700_000_000_004,
      },
    };

    const created = await repository.createAuthorPostRevision(input);

    expect(created.author).toMatchObject({
      id: input.author.id,
      accessSubject: input.author.accessSubject,
      displayName: input.author.displayName,
      email: input.author.email,
      avatarUrl: input.author.avatarUrl,
      createdAt: input.author.createdAt,
      updatedAt: input.author.updatedAt,
    });
    expect(created.post).toMatchObject({
      id: input.post.id,
      slug: input.post.slug,
      status: "draft",
      canonicalUrl: input.post.canonicalUrl,
      noindex: input.post.noindex,
      createdBy: input.author.id,
      createdAt: input.post.createdAt,
      updatedAt: input.post.updatedAt,
    });
    expect(created.revision).toMatchObject({
      id: input.revision.id,
      postId: input.post.id,
      version: input.revision.version,
      title: input.revision.title,
      contentVersion: input.revision.contentVersion,
      contentJson: input.revision.contentJson,
      excerpt: input.revision.excerpt,
      metadataJson: input.revision.metadataJson,
      authorId: input.author.id,
      createdAt: input.revision.createdAt,
    });

    await expect(repository.getAuthor(input.author.id)).resolves.toEqual(created.author);
    await expect(repository.getPost(input.post.id)).resolves.toEqual(created.post);
    await expect(repository.getRevision(input.revision.id)).resolves.toEqual(created.revision);
  });

  it("rolls back the author and post when the final revision statement fails", async () => {
    const repository = createEditorialRepository(env.TEST_DB);
    const input = {
      author: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3e411",
        accessSubject: "subject-repository-rollback",
        displayName: "Grace Hopper",
        createdAt: 1_700_000_000_010,
        updatedAt: 1_700_000_000_010,
      },
      post: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3e412",
        slug: "repository-rollback",
        createdAt: 1_700_000_000_011,
        updatedAt: 1_700_000_000_011,
      },
      revision: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3e413",
        version: 1,
        title: "Rollback",
        contentVersion: 1,
        contentJson: "not-json",
        createdAt: 1_700_000_000_012,
      },
    };

    let error: unknown;
    try {
      await repository.createAuthorPostRevision(input);
    } catch (cause) {
      error = cause;
    }

    expect(error).toBeInstanceOf(RepositoryError);
    expect(error).toMatchObject({ code: RepositoryErrorCode.WRITE_FAILED });
    expect((error as RepositoryError).cause).toBeDefined();
    await expect(repository.getAuthor(input.author.id)).rejects.toMatchObject({
      code: RepositoryErrorCode.NOT_FOUND,
    });
    await expect(repository.getPost(input.post.id)).rejects.toMatchObject({
      code: RepositoryErrorCode.NOT_FOUND,
    });
    await expect(repository.getRevision(input.revision.id)).rejects.toMatchObject({
      code: RepositoryErrorCode.NOT_FOUND,
    });
  });

  it("reports missing records with a stable not-found error", async () => {
    const repository = createEditorialRepository(env.TEST_DB);

    await expect(
      repository.getAuthor("018f0e5d-6a25-7b01-8f4a-7d62a5d3e421"),
    ).rejects.toMatchObject({
      code: RepositoryErrorCode.NOT_FOUND,
    });
    await expect(repository.getPost("018f0e5d-6a25-7b01-8f4a-7d62a5d3e422")).rejects.toMatchObject({
      code: RepositoryErrorCode.NOT_FOUND,
    });
    await expect(repository.getPostBySlug("repository-missing")).rejects.toMatchObject({
      code: RepositoryErrorCode.NOT_FOUND,
    });
    await expect(
      repository.getRevision("018f0e5d-6a25-7b01-8f4a-7d62a5d3e423"),
    ).rejects.toMatchObject({ code: RepositoryErrorCode.NOT_FOUND });
  });

  it("reads a post by slug and keeps its aggregate revisions scoped to that post", async () => {
    const repository = createEditorialRepository(env.TEST_DB);
    const first = await repository.createAuthorPostRevision({
      author: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3e431",
        accessSubject: "subject-repository-aggregate-first",
        displayName: "First Author",
        createdAt: 1_700_000_000_020,
        updatedAt: 1_700_000_000_020,
      },
      post: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3e432",
        slug: "repository-aggregate-first",
        createdAt: 1_700_000_000_021,
        updatedAt: 1_700_000_000_021,
      },
      revision: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3e433",
        version: 1,
        title: "First aggregate",
        contentVersion: 1,
        contentJson: '{"type":"doc"}',
        createdAt: 1_700_000_000_022,
      },
    });
    const second = await repository.createAuthorPostRevision({
      author: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3e441",
        accessSubject: "subject-repository-aggregate-second",
        displayName: "Second Author",
        createdAt: 1_700_000_000_030,
        updatedAt: 1_700_000_000_030,
      },
      post: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3e442",
        slug: "repository-aggregate-second",
        createdAt: 1_700_000_000_031,
        updatedAt: 1_700_000_000_031,
      },
      revision: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3e443",
        version: 1,
        title: "Second aggregate",
        contentVersion: 1,
        contentJson: '{"type":"doc"}',
        createdAt: 1_700_000_000_032,
      },
    });

    await expect(repository.getPostBySlug("repository-aggregate-first")).resolves.toEqual(
      first.post,
    );
    await expect(repository.getPostAggregate(first.post.id)).resolves.toEqual({
      post: first.post,
      revisions: [first.revision],
    });
    expect(second.revision.postId).not.toBe(first.revision.postId);
  });

  it("purges a post and its dependent publication and search records", async () => {
    const repository = createEditorialRepository(env.TEST_DB);
    const created = await repository.createAuthorPostRevision({
      author: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3e501",
        accessSubject: "subject-repository-purge",
        displayName: "Purge Author",
        createdAt: 1_700_000_000_100,
        updatedAt: 1_700_000_000_100,
      },
      post: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3e502",
        slug: "repository-purge",
        createdAt: 1_700_000_000_101,
        updatedAt: 1_700_000_000_101,
      },
      revision: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3e503",
        version: 1,
        title: "Purge me",
        contentVersion: 1,
        contentJson: '{"type":"doc"}',
        createdAt: 1_700_000_000_102,
      },
    });
    const jobId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3e504";
    const chunkId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3e505";

    await env.TEST_DB.prepare("UPDATE posts SET active_published_revision_id = ? WHERE id = ?")
      .bind(created.revision.id, created.post.id)
      .run();
    await env.TEST_DB.prepare(
      "INSERT INTO publication_jobs (id, idempotency_key, post_id, revision_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        jobId,
        "repository-purge-job",
        created.post.id,
        created.revision.id,
        "pending",
        1_700_000_000_103,
        1_700_000_000_103,
      )
      .run();
    await env.TEST_DB.prepare(
      "INSERT INTO search_chunks (id, post_id, revision_id, chunk_index, title, heading, body, tags, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        chunkId,
        created.post.id,
        created.revision.id,
        0,
        "Purgeable",
        "Cleanup",
        "This content is removed with the post",
        "cleanup",
        1_700_000_000_104,
      )
      .run();

    await expect(repository.purgePost(created.post.id)).resolves.toBeUndefined();

    await expect(
      env.TEST_DB.prepare("SELECT id FROM posts WHERE id = ?").bind(created.post.id).first(),
    ).resolves.toBeNull();
    await expect(
      env.TEST_DB.prepare("SELECT id FROM post_revisions WHERE id = ?")
        .bind(created.revision.id)
        .first(),
    ).resolves.toBeNull();
    await expect(
      env.TEST_DB.prepare("SELECT id FROM publication_jobs WHERE id = ?").bind(jobId).first(),
    ).resolves.toBeNull();
    await expect(
      env.TEST_DB.prepare("SELECT id FROM search_chunks WHERE id = ?").bind(chunkId).first(),
    ).resolves.toBeNull();
    await expect(
      env.TEST_DB.prepare("SELECT id FROM search_chunks_fts WHERE search_chunks_fts MATCH ?")
        .bind("Purgeable")
        .all(),
    ).resolves.toMatchObject({ results: [] });

    await expect(
      repository.purgePost("018f0e5d-6a25-7b01-8f4a-7d62a5d3e506"),
    ).rejects.toMatchObject({ code: RepositoryErrorCode.NOT_FOUND });
  });
});
