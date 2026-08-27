import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createEditorialRepository } from "../src/repository";

describe("editorial repository publication preparation", () => {
  it("creates one immutable revision and publication job for an idempotent request", async () => {
    const repository = createEditorialRepository(env.TEST_DB);
    const initial = await repository.createAuthorPostRevision({
      author: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d41001",
        accessSubject: "subject-publication-prepare",
        displayName: "Publication Author",
        createdAt: 1_700_000_020_000,
        updatedAt: 1_700_000_020_000,
      },
      post: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d41002",
        slug: "publication-prepare",
        createdAt: 1_700_000_020_001,
        updatedAt: 1_700_000_020_001,
      },
      revision: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d41003",
        version: 3,
        title: "Initial publication snapshot",
        contentVersion: 1,
        contentJson: '{"type":"doc","content":[]}',
        createdAt: 1_700_000_020_002,
      },
    });
    const draft = await repository.saveDraft({
      postId: initial.post.id,
      expectedDraftVersion: 1,
      authorId: initial.author.id,
      title: "Prepared publication",
      contentVersion: 1,
      contentJson:
        '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Ready"}]}]}',
      excerpt: "Prepared excerpt",
      metadataJson: '{"stage":"ready"}',
      updatedAt: 1_700_000_020_003,
    });
    const request = {
      postId: initial.post.id,
      expectedDraftVersion: draft.version,
      expectedRevisionVersion: initial.revision.version,
      revisionId: "018f0e5d-6a25-7b01-8f4a-7d62a5d41004",
      publicationJobId: "018f0e5d-6a25-7b01-8f4a-7d62a5d41005",
      idempotencyKey: "publish-publication-prepare-1",
      authorId: initial.author.id,
      createdAt: 1_700_000_020_004,
    };

    const first = await repository.preparePublication(request);
    const retry = await repository.preparePublication({
      ...request,
      revisionId: "018f0e5d-6a25-7b01-8f4a-7d62a5d41006",
      publicationJobId: "018f0e5d-6a25-7b01-8f4a-7d62a5d41007",
    });

    expect(first).toEqual({
      revision: {
        id: request.revisionId,
        postId: initial.post.id,
        version: initial.revision.version + 1,
        title: draft.title,
        contentVersion: draft.contentVersion,
        contentJson: draft.contentJson,
        excerpt: draft.excerpt,
        metadataJson: draft.metadataJson,
        authorId: initial.author.id,
        createdAt: request.createdAt,
      },
      job: {
        id: request.publicationJobId,
        idempotencyKey: request.idempotencyKey,
        postId: initial.post.id,
        revisionId: request.revisionId,
        state: "pending",
        attempts: 0,
        errorMessage: null,
        availableAt: null,
        startedAt: null,
        completedAt: null,
        createdAt: request.createdAt,
        updatedAt: request.createdAt,
      },
    });
    expect(retry).toEqual(first);
    await expect(
      repository.listRevisions({ postId: initial.post.id, limit: 10 }),
    ).resolves.toHaveLength(2);
    await expect(
      env.TEST_DB.prepare("SELECT COUNT(*) AS count FROM publication_jobs WHERE post_id = ?")
        .bind(initial.post.id)
        .first<{ count: number }>(),
    ).resolves.toEqual({ count: 1 });
  });

  it("activates the prepared revision only after publication completes", async () => {
    const repository = createEditorialRepository(env.TEST_DB);
    const initial = await repository.createAuthorPostRevision({
      author: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d41101",
        accessSubject: "subject-publication-complete",
        displayName: "Publication Completion Author",
        createdAt: 1_700_000_021_000,
        updatedAt: 1_700_000_021_000,
      },
      post: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d41102",
        slug: "publication-complete",
        createdAt: 1_700_000_021_001,
        updatedAt: 1_700_000_021_001,
      },
      revision: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d41103",
        version: 1,
        title: "Initial completion snapshot",
        contentVersion: 1,
        contentJson: '{"type":"doc","content":[]}',
        createdAt: 1_700_000_021_002,
      },
    });
    const prepared = await repository.preparePublication({
      postId: initial.post.id,
      expectedDraftVersion: 1,
      expectedRevisionVersion: initial.revision.version,
      revisionId: "018f0e5d-6a25-7b01-8f4a-7d62a5d41104",
      publicationJobId: "018f0e5d-6a25-7b01-8f4a-7d62a5d41105",
      idempotencyKey: "publish-publication-complete-1",
      authorId: initial.author.id,
      createdAt: 1_700_000_021_003,
    });
    await expect(repository.getPost(initial.post.id)).resolves.toMatchObject({
      status: "draft",
      activePublishedRevisionId: null,
    });
    const request = {
      publicationJobId: prepared.job.id,
      postId: initial.post.id,
      revisionId: prepared.revision.id,
      completedAt: 1_700_000_021_004,
    };

    const completed = await repository.completePublication(request);
    const retry = await repository.completePublication(request);

    expect(completed.post).toMatchObject({
      id: initial.post.id,
      status: "published",
      activePublishedRevisionId: prepared.revision.id,
      updatedAt: request.completedAt,
    });
    expect(completed.job).toMatchObject({
      id: prepared.job.id,
      state: "succeeded",
      attempts: 1,
      startedAt: request.completedAt,
      completedAt: request.completedAt,
      updatedAt: request.completedAt,
    });
    expect(retry).toEqual(completed);
  });

  it("keeps the active revision when publication fails", async () => {
    const repository = createEditorialRepository(env.TEST_DB);
    const initial = await repository.createAuthorPostRevision({
      author: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d41201",
        accessSubject: "subject-publication-failure",
        displayName: "Publication Failure Author",
        createdAt: 1_700_000_022_000,
        updatedAt: 1_700_000_022_000,
      },
      post: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d41202",
        slug: "publication-failure",
        createdAt: 1_700_000_022_001,
        updatedAt: 1_700_000_022_001,
      },
      revision: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d41203",
        version: 1,
        title: "Currently published",
        contentVersion: 1,
        contentJson: '{"type":"doc","content":[]}',
        createdAt: 1_700_000_022_002,
      },
    });
    await env.TEST_DB.prepare(
      "UPDATE posts SET status = 'published', active_published_revision_id = ? WHERE id = ?",
    )
      .bind(initial.revision.id, initial.post.id)
      .run();
    const draft = await repository.saveDraft({
      postId: initial.post.id,
      expectedDraftVersion: 1,
      authorId: initial.author.id,
      title: "Publication that fails",
      contentVersion: 1,
      contentJson: '{"type":"doc","content":[]}',
      updatedAt: 1_700_000_022_003,
    });
    const prepared = await repository.preparePublication({
      postId: initial.post.id,
      expectedDraftVersion: draft.version,
      expectedRevisionVersion: initial.revision.version,
      revisionId: "018f0e5d-6a25-7b01-8f4a-7d62a5d41204",
      publicationJobId: "018f0e5d-6a25-7b01-8f4a-7d62a5d41205",
      idempotencyKey: "publish-publication-failure-1",
      authorId: initial.author.id,
      createdAt: 1_700_000_022_004,
    });
    const request = {
      publicationJobId: prepared.job.id,
      postId: initial.post.id,
      revisionId: prepared.revision.id,
      errorMessage: "Failed to write Markdown artifact",
      failedAt: 1_700_000_022_005,
    };

    const failed = await repository.failPublication(request);
    const retry = await repository.failPublication(request);

    expect(failed).toMatchObject({
      id: prepared.job.id,
      state: "failed",
      attempts: 1,
      errorMessage: request.errorMessage,
      startedAt: request.failedAt,
      completedAt: request.failedAt,
      updatedAt: request.failedAt,
    });
    expect(retry).toEqual(failed);
    await expect(repository.getPost(initial.post.id)).resolves.toMatchObject({
      status: "published",
      activePublishedRevisionId: initial.revision.id,
    });
  });
});
