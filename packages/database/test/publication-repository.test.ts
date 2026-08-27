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
});
