import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createEditorialRepository, RepositoryError, RepositoryErrorCode } from "../src/repository";

const contentJson = JSON.stringify({
  type: "doc",
  content: [
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: true },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Review the draft" }],
            },
          ],
        },
      ],
    },
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableHeader",
              attrs: { colspan: 1, rowspan: 1, colwidth: null },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Status" }] }],
            },
            {
              type: "tableHeader",
              attrs: { colspan: 1, rowspan: 1, colwidth: null },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Owner" }] }],
            },
          ],
        },
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              attrs: { colspan: 1, rowspan: 1, colwidth: null },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Ready" }] }],
            },
            {
              type: "tableCell",
              attrs: { colspan: 1, rowspan: 1, colwidth: null },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Ada" }] }],
            },
          ],
        },
      ],
    },
  ],
});

describe("editorial repository drafts", () => {
  it("keeps the create return shape and seeds a version-one draft", async () => {
    const repository = createEditorialRepository(env.TEST_DB);
    const input = {
      author: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fa01",
        accessSubject: "subject-draft-create-success",
        displayName: "Draft Author",
        email: "draft@example.com",
        avatarUrl: "https://example.com/draft.png",
        createdAt: 1_700_000_010_000,
        updatedAt: 1_700_000_010_001,
      },
      post: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fa02",
        slug: "draft-create-success",
        canonicalUrl: "https://example.com/draft-create-success",
        noindex: 1 as const,
        createdAt: 1_700_000_010_002,
        updatedAt: 1_700_000_010_003,
      },
      revision: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fa03",
        version: 7,
        title: "Draft seed",
        contentVersion: 1,
        contentJson,
        excerpt: "Draft excerpt",
        metadataJson: JSON.stringify({ template: "article", stage: "draft" }),
        createdAt: 1_700_000_010_004,
      },
    };

    const created = await repository.createAuthorPostRevision(input);
    const draft = await repository.getDraft(input.post.id);

    expect(Object.keys(created)).toEqual(["author", "post", "revision"]);
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
    expect(draft).toEqual({
      postId: input.post.id,
      version: 1,
      title: input.revision.title,
      contentVersion: input.revision.contentVersion,
      contentJson: input.revision.contentJson,
      excerpt: input.revision.excerpt,
      metadataJson: input.revision.metadataJson,
      authorId: input.author.id,
      updatedAt: input.revision.createdAt,
    });
  });

  it("autosaves every editable field without changing immutable revisions", async () => {
    const repository = createEditorialRepository(env.TEST_DB);
    const initial = await repository.createAuthorPostRevision({
      author: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fb01",
        accessSubject: "subject-draft-save-initial",
        displayName: "Draft Save Initial",
        createdAt: 1_700_000_010_200,
        updatedAt: 1_700_000_010_200,
      },
      post: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fb02",
        slug: "draft-save-success",
        createdAt: 1_700_000_010_201,
        updatedAt: 1_700_000_010_201,
      },
      revision: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fb03",
        version: 7,
        title: "Immutable initial title",
        contentVersion: 1,
        contentJson: JSON.stringify({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Initial" }] }],
        }),
        excerpt: "Immutable initial excerpt",
        metadataJson: JSON.stringify({ stage: "initial" }),
        createdAt: 1_700_000_010_202,
      },
    });
    const saveAuthorId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3fb04";
    await env.TEST_DB.prepare(
      "INSERT INTO authors (id, access_subject, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(
        saveAuthorId,
        "subject-draft-save-author",
        "Draft Save Author",
        1_700_000_010_203,
        1_700_000_010_203,
      )
      .run();
    const initialDraft = await repository.getDraft(initial.post.id);

    const firstSave = await repository.saveDraft({
      postId: initial.post.id,
      expectedDraftVersion: 1,
      authorId: saveAuthorId,
      title: "First save'); --",
      contentVersion: 1,
      contentJson: JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "First content'); --" }] }],
      }),
      excerpt: "First excerpt'); --",
      metadataJson: JSON.stringify({ stage: "first", marker: "metadata'); --" }),
      updatedAt: 1_700_000_010_204,
    });
    await expect(repository.getPost(initial.post.id)).resolves.toMatchObject({
      updatedAt: 1_700_000_010_204,
    });
    const secondSave = await repository.saveDraft({
      postId: initial.post.id,
      expectedDraftVersion: 2,
      authorId: initial.author.id,
      title: "Second save'); --",
      contentVersion: 1,
      contentJson: JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Second content'); --" }] }],
      }),
      excerpt: null,
      metadataJson: JSON.stringify({ stage: "second", marker: "metadata'); --" }),
      updatedAt: 1_700_000_010_205,
    });
    await expect(repository.getPost(initial.post.id)).resolves.toMatchObject({
      updatedAt: 1_700_000_010_205,
    });

    expect(firstSave).toEqual({
      postId: initial.post.id,
      version: 2,
      title: "First save'); --",
      contentVersion: 1,
      contentJson: JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "First content'); --" }] }],
      }),
      excerpt: "First excerpt'); --",
      metadataJson: JSON.stringify({ stage: "first", marker: "metadata'); --" }),
      authorId: saveAuthorId,
      updatedAt: 1_700_000_010_204,
    });
    expect(secondSave).toEqual({
      postId: initial.post.id,
      version: 3,
      title: "Second save'); --",
      contentVersion: 1,
      contentJson: JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Second content'); --" }] }],
      }),
      excerpt: null,
      metadataJson: JSON.stringify({ stage: "second", marker: "metadata'); --" }),
      authorId: initial.author.id,
      updatedAt: 1_700_000_010_205,
    });

    expect([initialDraft.version, firstSave.version, secondSave.version]).toEqual([1, 2, 3]);
    await expect(repository.getDraft(initial.post.id)).resolves.toEqual(secondSave);
    await expect(repository.getRevision(initial.revision.id)).resolves.toEqual(initial.revision);
    const aggregate = await repository.getPostAggregate(initial.post.id);
    expect(aggregate.revisions.map((revision) => revision.version)).toEqual([7]);
    expect(aggregate.revisions).toEqual([initial.revision]);
  });

  it("checkpoints the current draft as an immutable revision without changing the draft", async () => {
    const repository = createEditorialRepository(env.TEST_DB);
    const initial = await repository.createAuthorPostRevision({
      author: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fd01",
        accessSubject: "subject-draft-checkpoint-success",
        displayName: "Checkpoint Author",
        createdAt: 1_700_000_010_400,
        updatedAt: 1_700_000_010_400,
      },
      post: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fd02",
        slug: "draft-checkpoint-success",
        createdAt: 1_700_000_010_401,
        updatedAt: 1_700_000_010_401,
      },
      revision: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fd03",
        version: 4,
        title: "Initial snapshot",
        contentVersion: 1,
        contentJson: '{"type":"doc","content":[]}',
        excerpt: "Initial excerpt",
        metadataJson: '{"stage":"initial"}',
        createdAt: 1_700_000_010_402,
      },
    });

    const firstDraft = await repository.saveDraft({
      postId: initial.post.id,
      expectedDraftVersion: 1,
      authorId: initial.author.id,
      title: "First checkpoint title",
      contentVersion: 1,
      contentJson:
        '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"First checkpoint"}]}]}',
      excerpt: "First checkpoint excerpt",
      metadataJson: '{"stage":"first-checkpoint"}',
      updatedAt: 1_700_000_010_403,
    });
    const draftBeforeFirstCheckpoint = await repository.getDraft(initial.post.id);

    const firstCheckpoint = await repository.checkpointDraft({
      postId: initial.post.id,
      expectedDraftVersion: firstDraft.version,
      expectedRevisionVersion: initial.revision.version,
      revisionId: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fd04",
      authorId: initial.author.id,
      createdAt: 1_700_000_010_404,
    });

    expect(firstCheckpoint).toEqual({
      id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fd04",
      postId: initial.post.id,
      version: 5,
      title: firstDraft.title,
      contentVersion: firstDraft.contentVersion,
      contentJson: firstDraft.contentJson,
      excerpt: firstDraft.excerpt,
      metadataJson: firstDraft.metadataJson,
      authorId: initial.author.id,
      createdAt: 1_700_000_010_404,
    });
    await expect(repository.getPost(initial.post.id)).resolves.toMatchObject({
      updatedAt: 1_700_000_010_404,
    });
    await expect(repository.getDraft(initial.post.id)).resolves.toEqual(draftBeforeFirstCheckpoint);

    const secondDraft = await repository.saveDraft({
      postId: initial.post.id,
      expectedDraftVersion: firstDraft.version,
      authorId: initial.author.id,
      title: "Second checkpoint title",
      contentVersion: 1,
      contentJson:
        '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Second checkpoint"}]}]}',
      excerpt: null,
      metadataJson: '{"stage":"second-checkpoint"}',
      updatedAt: 1_700_000_010_405,
    });
    const draftBeforeSecondCheckpoint = await repository.getDraft(initial.post.id);

    const secondCheckpoint = await repository.checkpointDraft({
      postId: initial.post.id,
      expectedDraftVersion: secondDraft.version,
      expectedRevisionVersion: firstCheckpoint.version,
      revisionId: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fd05",
      authorId: initial.author.id,
      createdAt: 1_700_000_010_406,
    });

    expect(secondCheckpoint).toEqual({
      id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fd05",
      postId: initial.post.id,
      version: 6,
      title: secondDraft.title,
      contentVersion: secondDraft.contentVersion,
      contentJson: secondDraft.contentJson,
      excerpt: secondDraft.excerpt,
      metadataJson: secondDraft.metadataJson,
      authorId: initial.author.id,
      createdAt: 1_700_000_010_406,
    });
    await expect(repository.getPost(initial.post.id)).resolves.toMatchObject({
      updatedAt: 1_700_000_010_406,
    });
    await expect(repository.getDraft(initial.post.id)).resolves.toEqual(
      draftBeforeSecondCheckpoint,
    );

    const aggregate = await repository.getPostAggregate(initial.post.id);
    expect([firstDraft.version, secondDraft.version]).toEqual([2, 3]);
    expect(aggregate.revisions.map((revision) => revision.version)).toEqual([4, 5, 6]);
    expect(aggregate.revisions).toEqual([initial.revision, firstCheckpoint, secondCheckpoint]);
  });

  it("rejects a stale draft checkpoint without changing the draft or revisions", async () => {
    const repository = createEditorialRepository(env.TEST_DB);
    const initial = await repository.createAuthorPostRevision({
      author: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fe01",
        accessSubject: "subject-draft-checkpoint-stale-draft",
        displayName: "Stale Draft Checkpoint Author",
        createdAt: 1_700_000_010_500,
        updatedAt: 1_700_000_010_500,
      },
      post: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fe02",
        slug: "draft-checkpoint-stale-draft",
        createdAt: 1_700_000_010_501,
        updatedAt: 1_700_000_010_501,
      },
      revision: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fe03",
        version: 3,
        title: "Initial stale-draft snapshot",
        contentVersion: 1,
        contentJson: '{"type":"doc","content":[]}',
        createdAt: 1_700_000_010_502,
      },
    });
    const currentDraft = await repository.saveDraft({
      postId: initial.post.id,
      expectedDraftVersion: 1,
      authorId: initial.author.id,
      title: "Current stale-draft content",
      contentVersion: 1,
      contentJson:
        '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Current"}]}]}',
      excerpt: "Current stale-draft excerpt",
      metadataJson: '{"stage":"current"}',
      updatedAt: 1_700_000_010_503,
    });
    const beforeDraft = await repository.getDraft(initial.post.id);
    const beforeAggregate = await repository.getPostAggregate(initial.post.id);

    await expect(
      repository.checkpointDraft({
        postId: initial.post.id,
        expectedDraftVersion: currentDraft.version - 1,
        expectedRevisionVersion: initial.revision.version,
        revisionId: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fe04",
        authorId: initial.author.id,
        createdAt: 1_700_000_010_504,
      }),
    ).rejects.toMatchObject({
      code: RepositoryErrorCode.CONFLICT,
      message: "Draft checkpoint conflicted with a newer version",
    });
    await expect(repository.getDraft(initial.post.id)).resolves.toEqual(beforeDraft);
    await expect(repository.getPostAggregate(initial.post.id)).resolves.toEqual(beforeAggregate);
  });

  it("rejects a stale revision checkpoint without changing the draft or revisions", async () => {
    const repository = createEditorialRepository(env.TEST_DB);
    const initial = await repository.createAuthorPostRevision({
      author: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3ff01",
        accessSubject: "subject-draft-checkpoint-stale-revision",
        displayName: "Stale Revision Checkpoint Author",
        createdAt: 1_700_000_010_600,
        updatedAt: 1_700_000_010_600,
      },
      post: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3ff02",
        slug: "draft-checkpoint-stale-revision",
        createdAt: 1_700_000_010_601,
        updatedAt: 1_700_000_010_601,
      },
      revision: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3ff03",
        version: 6,
        title: "Initial stale-revision snapshot",
        contentVersion: 1,
        contentJson: '{"type":"doc","content":[]}',
        createdAt: 1_700_000_010_602,
      },
    });
    const currentDraft = await repository.saveDraft({
      postId: initial.post.id,
      expectedDraftVersion: 1,
      authorId: initial.author.id,
      title: "Current stale-revision content",
      contentVersion: 1,
      contentJson:
        '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Current"}]}]}',
      excerpt: "Current stale-revision excerpt",
      metadataJson: '{"stage":"current"}',
      updatedAt: 1_700_000_010_603,
    });
    const appended = await repository.appendRevision({
      postId: initial.post.id,
      authorId: initial.author.id,
      expectedVersion: initial.revision.version,
      revision: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3ff04",
        title: "Concurrent immutable snapshot",
        contentVersion: 1,
        contentJson: '{"type":"doc","content":[]}',
        createdAt: 1_700_000_010_604,
      },
    });
    const beforeDraft = await repository.getDraft(initial.post.id);
    const beforeAggregate = await repository.getPostAggregate(initial.post.id);

    await expect(
      repository.checkpointDraft({
        postId: initial.post.id,
        expectedDraftVersion: currentDraft.version,
        expectedRevisionVersion: initial.revision.version,
        revisionId: "018f0e5d-6a25-7b01-8f4a-7d62a5d3ff05",
        authorId: initial.author.id,
        createdAt: 1_700_000_010_605,
      }),
    ).rejects.toMatchObject({
      code: RepositoryErrorCode.CONFLICT,
      message: "Draft checkpoint conflicted with a newer version",
    });
    await expect(repository.getDraft(initial.post.id)).resolves.toEqual(beforeDraft);
    await expect(repository.getPostAggregate(initial.post.id)).resolves.toEqual(beforeAggregate);
    expect(beforeAggregate.revisions).toEqual([initial.revision, appended]);
  });

  it("maps a checkpoint for a missing draft to not-found", async () => {
    const repository = createEditorialRepository(env.TEST_DB);

    await expect(
      repository.checkpointDraft({
        postId: "018f0e5d-6a25-7b01-8f4a-7d62a5d3ff11",
        expectedDraftVersion: 1,
        expectedRevisionVersion: 1,
        revisionId: "018f0e5d-6a25-7b01-8f4a-7d62a5d3ff12",
        authorId: "018f0e5d-6a25-7b01-8f4a-7d62a5d3ff13",
        createdAt: 1_700_000_010_606,
      }),
    ).rejects.toMatchObject({
      code: RepositoryErrorCode.NOT_FOUND,
      message: "post draft was not found",
    });
  });

  it("preserves an existing post when its checkpoint draft was deleted", async () => {
    const repository = createEditorialRepository(env.TEST_DB);
    const initial = await repository.createAuthorPostRevision({
      author: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fc41",
        accessSubject: "subject-draft-checkpoint-deleted-draft",
        displayName: "Deleted Checkpoint Draft Author",
        createdAt: 1_700_000_010_340,
        updatedAt: 1_700_000_010_340,
      },
      post: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fc42",
        slug: "draft-checkpoint-deleted-draft",
        createdAt: 1_700_000_010_341,
        updatedAt: 1_700_000_010_341,
      },
      revision: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fc43",
        version: 1,
        title: "Deleted checkpoint draft initial",
        contentVersion: 1,
        contentJson,
        createdAt: 1_700_000_010_342,
      },
    });
    const beforePost = await repository.getPost(initial.post.id);
    const beforeAggregate = await repository.getPostAggregate(initial.post.id);
    await env.TEST_DB.prepare("DELETE FROM post_drafts WHERE post_id = ?")
      .bind(initial.post.id)
      .run();

    await expect(
      repository.checkpointDraft({
        postId: initial.post.id,
        expectedDraftVersion: 1,
        expectedRevisionVersion: initial.revision.version,
        revisionId: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fc44",
        authorId: initial.author.id,
        createdAt: 1_700_000_010_343,
      }),
    ).rejects.toMatchObject({
      code: RepositoryErrorCode.NOT_FOUND,
      message: "post draft was not found",
    });
    await expect(repository.getPost(initial.post.id)).resolves.toEqual(beforePost);
    await expect(repository.getPostAggregate(initial.post.id)).resolves.toEqual(beforeAggregate);
  });

  it("rolls back the post timestamp when checkpointing the revision fails", async () => {
    const repository = createEditorialRepository(env.TEST_DB);
    const initial = await repository.createAuthorPostRevision({
      author: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fc51",
        accessSubject: "subject-draft-checkpoint-rollback",
        displayName: "Checkpoint Rollback Author",
        createdAt: 1_700_000_010_350,
        updatedAt: 1_700_000_010_350,
      },
      post: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fc52",
        slug: "draft-checkpoint-rollback",
        createdAt: 1_700_000_010_351,
        updatedAt: 1_700_000_010_351,
      },
      revision: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fc53",
        version: 1,
        title: "Checkpoint rollback initial",
        contentVersion: 1,
        contentJson,
        createdAt: 1_700_000_010_352,
      },
    });
    const beforePost = await repository.getPost(initial.post.id);
    const beforeDraft = await repository.getDraft(initial.post.id);
    const beforeAggregate = await repository.getPostAggregate(initial.post.id);
    const failedRevisionId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3fc54";

    let error: unknown;
    try {
      await repository.checkpointDraft({
        postId: initial.post.id,
        expectedDraftVersion: beforeDraft.version,
        expectedRevisionVersion: initial.revision.version,
        revisionId: failedRevisionId,
        authorId: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fc55",
        createdAt: 1_700_000_010_353,
      });
    } catch (cause) {
      error = cause;
    }

    expect(error).toBeInstanceOf(RepositoryError);
    expect(error).toMatchObject({
      code: RepositoryErrorCode.WRITE_FAILED,
      message: "Failed to checkpoint post draft",
    });
    expect((error as RepositoryError).message).not.toMatch(/INSERT|post_revisions|SQL/i);
    await expect(repository.getPost(initial.post.id)).resolves.toEqual(beforePost);
    await expect(repository.getDraft(initial.post.id)).resolves.toEqual(beforeDraft);
    await expect(repository.getPostAggregate(initial.post.id)).resolves.toEqual(beforeAggregate);
    await expect(repository.getRevision(failedRevisionId)).rejects.toMatchObject({
      code: RepositoryErrorCode.NOT_FOUND,
    });
  });

  it("rejects stale saves without changing the entire draft", async () => {
    const repository = createEditorialRepository(env.TEST_DB);
    const initial = await repository.createAuthorPostRevision({
      author: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fc01",
        accessSubject: "subject-draft-save-stale",
        displayName: "Draft Save Stale",
        createdAt: 1_700_000_010_300,
        updatedAt: 1_700_000_010_300,
      },
      post: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fc02",
        slug: "draft-save-stale",
        createdAt: 1_700_000_010_301,
        updatedAt: 1_700_000_010_301,
      },
      revision: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fc03",
        version: 1,
        title: "Stale initial",
        contentVersion: 1,
        contentJson: '{"type":"doc","content":[]}',
        createdAt: 1_700_000_010_302,
      },
    });
    const current = await repository.saveDraft({
      postId: initial.post.id,
      expectedDraftVersion: 1,
      authorId: initial.author.id,
      title: "Current draft",
      contentVersion: 1,
      contentJson:
        '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"current"}]}]}',
      excerpt: "Current excerpt",
      metadataJson: '{"stage":"current"}',
      updatedAt: 1_700_000_010_303,
    });
    const beforeStaleSave = await repository.getDraft(initial.post.id);
    const beforeStalePost = await repository.getPost(initial.post.id);

    let error: unknown;
    try {
      await repository.saveDraft({
        postId: initial.post.id,
        expectedDraftVersion: 1,
        authorId: initial.author.id,
        title: "Stale replacement",
        contentVersion: 1,
        contentJson:
          '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"stale"}]}]}',
        excerpt: "Stale excerpt",
        metadataJson: '{"stage":"stale"}',
        updatedAt: 1_700_000_010_304,
      });
    } catch (cause) {
      error = cause;
    }

    expect(error).toBeInstanceOf(RepositoryError);
    expect(error).toMatchObject({
      code: RepositoryErrorCode.CONFLICT,
      message: "Draft save conflicted with a newer version",
    });
    expect((error as RepositoryError).message).not.toMatch(/UPDATE|post_drafts|SQL/i);
    expect(current).toEqual(beforeStaleSave);
    await expect(repository.getPost(initial.post.id)).resolves.toEqual(beforeStalePost);
    await expect(repository.getDraft(initial.post.id)).resolves.toEqual(beforeStaleSave);
  });

  it("maps a save for a missing draft to not-found", async () => {
    const repository = createEditorialRepository(env.TEST_DB);

    await expect(
      repository.saveDraft({
        postId: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fc11",
        expectedDraftVersion: 1,
        authorId: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fc12",
        title: "Missing draft",
        contentVersion: 1,
        contentJson: '{"type":"doc","content":[]}',
        updatedAt: 1_700_000_010_305,
      }),
    ).rejects.toMatchObject({
      code: RepositoryErrorCode.NOT_FOUND,
      message: "post draft was not found",
    });
  });

  it("preserves an existing post when its draft was deleted", async () => {
    const repository = createEditorialRepository(env.TEST_DB);
    const initial = await repository.createAuthorPostRevision({
      author: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fc21",
        accessSubject: "subject-draft-save-deleted-draft",
        displayName: "Deleted Draft Author",
        createdAt: 1_700_000_010_320,
        updatedAt: 1_700_000_010_320,
      },
      post: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fc22",
        slug: "draft-save-deleted-draft",
        createdAt: 1_700_000_010_321,
        updatedAt: 1_700_000_010_321,
      },
      revision: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fc23",
        version: 1,
        title: "Deleted draft initial",
        contentVersion: 1,
        contentJson,
        createdAt: 1_700_000_010_322,
      },
    });
    const beforeSave = await repository.getPost(initial.post.id);
    await env.TEST_DB.prepare("DELETE FROM post_drafts WHERE post_id = ?")
      .bind(initial.post.id)
      .run();

    await expect(
      repository.saveDraft({
        postId: initial.post.id,
        expectedDraftVersion: 1,
        authorId: initial.author.id,
        title: "Deleted draft replacement",
        contentVersion: 1,
        contentJson,
        updatedAt: 1_700_000_010_323,
      }),
    ).rejects.toMatchObject({
      code: RepositoryErrorCode.NOT_FOUND,
      message: "post draft was not found",
    });
    await expect(repository.getPost(initial.post.id)).resolves.toEqual(beforeSave);
  });

  it("rolls back the post timestamp when saving the draft fails", async () => {
    const repository = createEditorialRepository(env.TEST_DB);
    const initial = await repository.createAuthorPostRevision({
      author: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fc31",
        accessSubject: "subject-draft-save-rollback",
        displayName: "Draft Save Rollback Author",
        createdAt: 1_700_000_010_330,
        updatedAt: 1_700_000_010_330,
      },
      post: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fc32",
        slug: "draft-save-rollback",
        createdAt: 1_700_000_010_331,
        updatedAt: 1_700_000_010_331,
      },
      revision: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fc33",
        version: 1,
        title: "Save rollback initial",
        contentVersion: 1,
        contentJson,
        createdAt: 1_700_000_010_332,
      },
    });
    const beforePost = await repository.getPost(initial.post.id);
    const beforeDraft = await repository.getDraft(initial.post.id);

    let error: unknown;
    try {
      await repository.saveDraft({
        postId: initial.post.id,
        expectedDraftVersion: beforeDraft.version,
        authorId: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fc34",
        title: "Rejected draft",
        contentVersion: 1,
        contentJson,
        updatedAt: 1_700_000_010_333,
      });
    } catch (cause) {
      error = cause;
    }

    expect(error).toBeInstanceOf(RepositoryError);
    expect(error).toMatchObject({
      code: RepositoryErrorCode.WRITE_FAILED,
      message: "Failed to save post draft",
    });
    expect((error as RepositoryError).message).not.toMatch(/UPDATE|post_drafts|SQL/i);
    await expect(repository.getPost(initial.post.id)).resolves.toEqual(beforePost);
    await expect(repository.getDraft(initial.post.id)).resolves.toEqual(beforeDraft);
  });

  it("maps a missing draft to a stable not-found error", async () => {
    const repository = createEditorialRepository(env.TEST_DB);

    let error: unknown;
    try {
      await repository.getDraft("018f0e5d-6a25-7b01-8f4a-7d62a5d3fa11");
    } catch (cause) {
      error = cause;
    }

    expect(error).toBeInstanceOf(RepositoryError);
    expect(error).toMatchObject({
      code: RepositoryErrorCode.NOT_FOUND,
      message: "post draft was not found",
    });
    expect((error as RepositoryError).message).not.toMatch(/SELECT|post_drafts|SQL/i);
  });

  it("rolls back all four rows when initial creation fails", async () => {
    const repository = createEditorialRepository(env.TEST_DB);
    const input = {
      author: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fa21",
        accessSubject: "subject-draft-create-rollback",
        displayName: "Rollback Author",
        createdAt: 1_700_000_010_100,
        updatedAt: 1_700_000_010_100,
      },
      post: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fa22",
        slug: "draft-create-rollback",
        createdAt: 1_700_000_010_101,
        updatedAt: 1_700_000_010_101,
      },
      revision: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fa23",
        version: 1,
        title: "Rollback draft",
        contentVersion: 1,
        contentJson: "not-json",
        createdAt: 1_700_000_010_102,
      },
    };

    await expect(repository.createAuthorPostRevision(input)).rejects.toMatchObject({
      code: RepositoryErrorCode.WRITE_FAILED,
    });
    await expect(repository.getAuthor(input.author.id)).rejects.toMatchObject({
      code: RepositoryErrorCode.NOT_FOUND,
    });
    await expect(repository.getPost(input.post.id)).rejects.toMatchObject({
      code: RepositoryErrorCode.NOT_FOUND,
    });
    await expect(repository.getRevision(input.revision.id)).rejects.toMatchObject({
      code: RepositoryErrorCode.NOT_FOUND,
    });
    await expect(repository.getDraft(input.post.id)).rejects.toMatchObject({
      code: RepositoryErrorCode.NOT_FOUND,
    });
  });

  it("restores an older same-post revision into the draft and appends a new snapshot", async () => {
    const repository = createEditorialRepository(env.TEST_DB);
    const initial = await repository.createAuthorPostRevision({
      author: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fb11",
        accessSubject: "subject-draft-restore-success",
        displayName: "Draft Restore Initial",
        createdAt: 1_700_000_011_000,
        updatedAt: 1_700_000_011_000,
      },
      post: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fb12",
        slug: "draft-restore-success",
        createdAt: 1_700_000_011_001,
        updatedAt: 1_700_000_011_001,
      },
      revision: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fb13",
        version: 4,
        title: "Older source title",
        contentVersion: 1,
        contentJson: JSON.stringify({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Older source" }] }],
        }),
        excerpt: "Older source excerpt",
        metadataJson: JSON.stringify({ stage: "older-source" }),
        createdAt: 1_700_000_011_002,
      },
    });
    const restoreAuthorId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3fb14";
    await env.TEST_DB.prepare(
      "INSERT INTO authors (id, access_subject, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(
        restoreAuthorId,
        "subject-draft-restore-author",
        "Draft Restore Author",
        1_700_000_011_003,
        1_700_000_011_003,
      )
      .run();

    const firstDraft = await repository.saveDraft({
      postId: initial.post.id,
      expectedDraftVersion: 1,
      authorId: initial.author.id,
      title: "First divergent draft",
      contentVersion: 1,
      contentJson: JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "First divergent" }] }],
      }),
      excerpt: "First divergent excerpt",
      metadataJson: JSON.stringify({ stage: "first-divergent" }),
      updatedAt: 1_700_000_011_004,
    });
    const firstCheckpoint = await repository.checkpointDraft({
      postId: initial.post.id,
      expectedDraftVersion: firstDraft.version,
      expectedRevisionVersion: initial.revision.version,
      revisionId: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fb15",
      authorId: initial.author.id,
      createdAt: 1_700_000_011_005,
    });
    const secondDraft = await repository.saveDraft({
      postId: initial.post.id,
      expectedDraftVersion: firstDraft.version,
      authorId: initial.author.id,
      title: "Second divergent draft",
      contentVersion: 1,
      contentJson: JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Second divergent" }] }],
      }),
      excerpt: "Second divergent excerpt",
      metadataJson: JSON.stringify({ stage: "second-divergent" }),
      updatedAt: 1_700_000_011_006,
    });
    const secondCheckpoint = await repository.checkpointDraft({
      postId: initial.post.id,
      expectedDraftVersion: secondDraft.version,
      expectedRevisionVersion: firstCheckpoint.version,
      revisionId: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fb16",
      authorId: initial.author.id,
      createdAt: 1_700_000_011_007,
    });
    const divergentDraft = await repository.saveDraft({
      postId: initial.post.id,
      expectedDraftVersion: secondDraft.version,
      authorId: initial.author.id,
      title: "Unsaved divergent draft",
      contentVersion: 1,
      contentJson: JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Unsaved divergent" }] }],
      }),
      excerpt: "Unsaved divergent excerpt",
      metadataJson: JSON.stringify({ stage: "unsaved-divergent" }),
      updatedAt: 1_700_000_011_008,
    });
    const revisionsBeforeRestore = await repository.getPostAggregate(initial.post.id);

    const restored = await repository.restoreDraft({
      postId: initial.post.id,
      sourceRevisionId: initial.revision.id,
      expectedDraftVersion: divergentDraft.version,
      expectedRevisionVersion: secondCheckpoint.version,
      revisionId: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fb17",
      authorId: restoreAuthorId,
      createdAt: 1_700_000_011_009,
      updatedAt: 1_700_000_011_010,
    });

    expect(restored).toEqual({
      revision: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fb17",
        postId: initial.post.id,
        version: 7,
        title: initial.revision.title,
        contentVersion: initial.revision.contentVersion,
        contentJson: initial.revision.contentJson,
        excerpt: initial.revision.excerpt,
        metadataJson: initial.revision.metadataJson,
        authorId: restoreAuthorId,
        createdAt: 1_700_000_011_009,
      },
      draft: {
        postId: initial.post.id,
        version: 5,
        title: initial.revision.title,
        contentVersion: initial.revision.contentVersion,
        contentJson: initial.revision.contentJson,
        excerpt: initial.revision.excerpt,
        metadataJson: initial.revision.metadataJson,
        authorId: restoreAuthorId,
        updatedAt: 1_700_000_011_010,
      },
    });
    await expect(repository.getPost(initial.post.id)).resolves.toMatchObject({
      updatedAt: 1_700_000_011_010,
    });

    const aggregate = await repository.getPostAggregate(initial.post.id);
    expect(aggregate.revisions).toEqual([...revisionsBeforeRestore.revisions, restored.revision]);
    expect(aggregate.revisions.map((revision) => revision.version)).toEqual([4, 5, 6, 7]);
    await expect(repository.getDraft(initial.post.id)).resolves.toEqual(restored.draft);
  });

  it("rejects a stale draft restore without changing the draft or revisions", async () => {
    const repository = createEditorialRepository(env.TEST_DB);
    const initial = await repository.createAuthorPostRevision({
      author: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fc11",
        accessSubject: "subject-draft-restore-stale-draft",
        displayName: "Stale Draft Restore Author",
        createdAt: 1_700_000_011_100,
        updatedAt: 1_700_000_011_100,
      },
      post: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fc12",
        slug: "draft-restore-stale-draft",
        createdAt: 1_700_000_011_101,
        updatedAt: 1_700_000_011_101,
      },
      revision: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fc13",
        version: 1,
        title: "Stale draft source",
        contentVersion: 1,
        contentJson: JSON.stringify({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Stale source" }] }],
        }),
        excerpt: "Stale source excerpt",
        metadataJson: JSON.stringify({ stage: "stale-source" }),
        createdAt: 1_700_000_011_102,
      },
    });
    const currentDraft = await repository.saveDraft({
      postId: initial.post.id,
      expectedDraftVersion: 1,
      authorId: initial.author.id,
      title: "Current draft before stale restore",
      contentVersion: 1,
      contentJson: JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Current draft" }] }],
      }),
      excerpt: "Current draft excerpt",
      metadataJson: JSON.stringify({ stage: "current-draft" }),
      updatedAt: 1_700_000_011_103,
    });
    const beforeDraft = await repository.getDraft(initial.post.id);
    const beforeAggregate = await repository.getPostAggregate(initial.post.id);
    const rejectedRevisionId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3fc14";

    await expect(
      repository.restoreDraft({
        postId: initial.post.id,
        sourceRevisionId: initial.revision.id,
        expectedDraftVersion: currentDraft.version - 1,
        expectedRevisionVersion: initial.revision.version,
        revisionId: rejectedRevisionId,
        authorId: initial.author.id,
        createdAt: 1_700_000_011_104,
        updatedAt: 1_700_000_011_105,
      }),
    ).rejects.toMatchObject({
      code: RepositoryErrorCode.CONFLICT,
      message: "Draft restore conflicted with a newer version",
    });
    expect(await repository.getDraft(initial.post.id)).toEqual(beforeDraft);
    await expect(repository.getPostAggregate(initial.post.id)).resolves.toEqual(beforeAggregate);
    await expect(repository.getRevision(rejectedRevisionId)).rejects.toMatchObject({
      code: RepositoryErrorCode.NOT_FOUND,
    });
  });

  it("rejects a stale revision restore without changing the draft or revisions", async () => {
    const repository = createEditorialRepository(env.TEST_DB);
    const initial = await repository.createAuthorPostRevision({
      author: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fd11",
        accessSubject: "subject-draft-restore-stale-revision",
        displayName: "Stale Revision Restore Author",
        createdAt: 1_700_000_011_200,
        updatedAt: 1_700_000_011_200,
      },
      post: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fd12",
        slug: "draft-restore-stale-revision",
        createdAt: 1_700_000_011_201,
        updatedAt: 1_700_000_011_201,
      },
      revision: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fd13",
        version: 1,
        title: "Stale revision source",
        contentVersion: 1,
        contentJson: JSON.stringify({
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Stale revision source" }] },
          ],
        }),
        excerpt: "Stale revision source excerpt",
        metadataJson: JSON.stringify({ stage: "stale-revision-source" }),
        createdAt: 1_700_000_011_202,
      },
    });
    const currentDraft = await repository.saveDraft({
      postId: initial.post.id,
      expectedDraftVersion: 1,
      authorId: initial.author.id,
      title: "Current draft before stale revision restore",
      contentVersion: 1,
      contentJson: JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Current draft" }] }],
      }),
      excerpt: "Current draft excerpt",
      metadataJson: JSON.stringify({ stage: "current-draft" }),
      updatedAt: 1_700_000_011_203,
    });
    const concurrentRevision = await repository.appendRevision({
      postId: initial.post.id,
      authorId: initial.author.id,
      expectedVersion: initial.revision.version,
      revision: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fd14",
        title: "Concurrent revision",
        contentVersion: 1,
        contentJson: JSON.stringify({
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Concurrent revision" }] },
          ],
        }),
        excerpt: "Concurrent revision excerpt",
        metadataJson: JSON.stringify({ stage: "concurrent" }),
        createdAt: 1_700_000_011_204,
      },
    });
    const beforeDraft = await repository.getDraft(initial.post.id);
    const beforeAggregate = await repository.getPostAggregate(initial.post.id);
    const rejectedRevisionId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3fd15";

    await expect(
      repository.restoreDraft({
        postId: initial.post.id,
        sourceRevisionId: initial.revision.id,
        expectedDraftVersion: currentDraft.version,
        expectedRevisionVersion: initial.revision.version,
        revisionId: rejectedRevisionId,
        authorId: initial.author.id,
        createdAt: 1_700_000_011_205,
        updatedAt: 1_700_000_011_206,
      }),
    ).rejects.toMatchObject({
      code: RepositoryErrorCode.CONFLICT,
      message: "Draft restore conflicted with a newer version",
    });
    await expect(repository.getDraft(initial.post.id)).resolves.toEqual(beforeDraft);
    await expect(repository.getPostAggregate(initial.post.id)).resolves.toEqual(beforeAggregate);
    expect(beforeAggregate.revisions).toEqual([initial.revision, concurrentRevision]);
    await expect(repository.getRevision(rejectedRevisionId)).rejects.toMatchObject({
      code: RepositoryErrorCode.NOT_FOUND,
    });
  });

  it("maps missing posts, drafts, and same-post sources to not-found", async () => {
    const repository = createEditorialRepository(env.TEST_DB);
    const target = await repository.createAuthorPostRevision({
      author: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fe11",
        accessSubject: "subject-draft-restore-not-found-target",
        displayName: "Not Found Target Author",
        createdAt: 1_700_000_011_300,
        updatedAt: 1_700_000_011_300,
      },
      post: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fe12",
        slug: "draft-restore-not-found-target",
        createdAt: 1_700_000_011_301,
        updatedAt: 1_700_000_011_301,
      },
      revision: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fe13",
        version: 1,
        title: "Not found target source",
        contentVersion: 1,
        contentJson: JSON.stringify({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Target source" }] }],
        }),
        excerpt: "Target source excerpt",
        metadataJson: JSON.stringify({ stage: "target" }),
        createdAt: 1_700_000_011_302,
      },
    });
    const foreign = await repository.createAuthorPostRevision({
      author: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fe14",
        accessSubject: "subject-draft-restore-not-found-foreign",
        displayName: "Not Found Foreign Author",
        createdAt: 1_700_000_011_303,
        updatedAt: 1_700_000_011_303,
      },
      post: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fe15",
        slug: "draft-restore-not-found-foreign",
        createdAt: 1_700_000_011_304,
        updatedAt: 1_700_000_011_304,
      },
      revision: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fe16",
        version: 1,
        title: "Not found foreign source",
        contentVersion: 1,
        contentJson: JSON.stringify({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Foreign source" }] }],
        }),
        excerpt: "Foreign source excerpt",
        metadataJson: JSON.stringify({ stage: "foreign" }),
        createdAt: 1_700_000_011_305,
      },
    });
    const targetBeforeRejectedRestore = await repository.getPostAggregate(target.post.id);
    const foreignBeforeRejectedRestore = await repository.getPostAggregate(foreign.post.id);
    const targetDraftBeforeRejectedRestore = await repository.getDraft(target.post.id);
    const foreignDraftBeforeRejectedRestore = await repository.getDraft(foreign.post.id);
    const restoreAuthorId = target.author.id;

    await expect(
      repository.restoreDraft({
        postId: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fe17",
        sourceRevisionId: target.revision.id,
        expectedDraftVersion: 1,
        expectedRevisionVersion: 1,
        revisionId: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fe18",
        authorId: restoreAuthorId,
        createdAt: 1_700_000_011_306,
        updatedAt: 1_700_000_011_307,
      }),
    ).rejects.toMatchObject({
      code: RepositoryErrorCode.NOT_FOUND,
      message: "post was not found",
    });

    await expect(
      repository.restoreDraft({
        postId: target.post.id,
        sourceRevisionId: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fe19",
        expectedDraftVersion: 1,
        expectedRevisionVersion: 1,
        revisionId: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fe1a",
        authorId: restoreAuthorId,
        createdAt: 1_700_000_011_308,
        updatedAt: 1_700_000_011_309,
      }),
    ).rejects.toMatchObject({
      code: RepositoryErrorCode.NOT_FOUND,
      message: "post revision was not found",
    });
    await expect(
      repository.restoreDraft({
        postId: target.post.id,
        sourceRevisionId: foreign.revision.id,
        expectedDraftVersion: 1,
        expectedRevisionVersion: 1,
        revisionId: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fe1b",
        authorId: restoreAuthorId,
        createdAt: 1_700_000_011_310,
        updatedAt: 1_700_000_011_311,
      }),
    ).rejects.toMatchObject({
      code: RepositoryErrorCode.NOT_FOUND,
      message: "post revision was not found",
    });
    await expect(repository.getPostAggregate(target.post.id)).resolves.toEqual(
      targetBeforeRejectedRestore,
    );
    await expect(repository.getPostAggregate(foreign.post.id)).resolves.toEqual(
      foreignBeforeRejectedRestore,
    );
    await expect(repository.getDraft(target.post.id)).resolves.toEqual(
      targetDraftBeforeRejectedRestore,
    );
    await expect(repository.getDraft(foreign.post.id)).resolves.toEqual(
      foreignDraftBeforeRejectedRestore,
    );

    await env.TEST_DB.prepare("DELETE FROM post_drafts WHERE post_id = ?")
      .bind(target.post.id)
      .run();
    const targetAggregateBeforeMissingDraftRestore = await repository.getPostAggregate(
      target.post.id,
    );
    await expect(
      repository.restoreDraft({
        postId: target.post.id,
        sourceRevisionId: target.revision.id,
        expectedDraftVersion: 1,
        expectedRevisionVersion: 1,
        revisionId: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fe1c",
        authorId: restoreAuthorId,
        createdAt: 1_700_000_011_312,
        updatedAt: 1_700_000_011_313,
      }),
    ).rejects.toMatchObject({
      code: RepositoryErrorCode.NOT_FOUND,
      message: "post draft was not found",
    });
    await expect(repository.getPostAggregate(target.post.id)).resolves.toEqual(
      targetAggregateBeforeMissingDraftRestore,
    );
  });

  it("maps an unexpected restore batch failure to a stable write error", async () => {
    const database = new Proxy(env.TEST_DB, {
      get(target, property, receiver) {
        if (property === "batch") {
          return () => Promise.reject(new Error("SQL restore failure details"));
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const repository = createEditorialRepository(database);

    let error: unknown;
    try {
      await repository.restoreDraft({
        postId: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fe21",
        sourceRevisionId: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fe22",
        expectedDraftVersion: 1,
        expectedRevisionVersion: 1,
        revisionId: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fe23",
        authorId: "018f0e5d-6a25-7b01-8f4a-7d62a5d3fe24",
        createdAt: 1_700_000_011_400,
        updatedAt: 1_700_000_011_401,
      });
    } catch (cause) {
      error = cause;
    }

    expect(error).toBeInstanceOf(RepositoryError);
    expect(error).toMatchObject({
      code: RepositoryErrorCode.WRITE_FAILED,
      message: "Failed to restore post draft",
    });
    expect((error as RepositoryError).message).not.toMatch(/INSERT|post_revisions|SQL/i);
  });

  it("rolls back a restore when a later statement violates a database constraint", async () => {
    const repository = createEditorialRepository(env.TEST_DB);
    const initial = await repository.createAuthorPostRevision({
      author: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3ff31",
        accessSubject: "subject-draft-restore-batch-rollback",
        displayName: "Restore Batch Rollback Author",
        createdAt: 1_700_000_011_500,
        updatedAt: 1_700_000_011_500,
      },
      post: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3ff32",
        slug: "draft-restore-batch-rollback",
        createdAt: 1_700_000_011_501,
        updatedAt: 1_700_000_011_501,
      },
      revision: {
        id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3ff33",
        version: 1,
        title: "Restore rollback source",
        contentVersion: 1,
        contentJson: JSON.stringify({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Source" }] }],
        }),
        excerpt: "Restore rollback source excerpt",
        metadataJson: JSON.stringify({ stage: "source" }),
        createdAt: 1_700_000_011_502,
      },
    });
    const beforeDraft = await repository.getDraft(initial.post.id);
    const beforeAggregate = await repository.getPostAggregate(initial.post.id);
    const restoredRevisionId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3ff34";

    await expect(
      repository.restoreDraft({
        postId: initial.post.id,
        sourceRevisionId: initial.revision.id,
        expectedDraftVersion: beforeDraft.version,
        expectedRevisionVersion: initial.revision.version,
        revisionId: restoredRevisionId,
        authorId: "018f0e5d-6a25-7b01-8f4a-7d62a5d3ff35",
        createdAt: 1_700_000_011_503,
        updatedAt: 1_700_000_011_504,
      }),
    ).rejects.toMatchObject({
      code: RepositoryErrorCode.WRITE_FAILED,
      message: "Failed to restore post draft",
    });

    await expect(repository.getDraft(initial.post.id)).resolves.toEqual(beforeDraft);
    await expect(repository.getPostAggregate(initial.post.id)).resolves.toEqual(beforeAggregate);
    await expect(repository.getRevision(restoredRevisionId)).rejects.toMatchObject({
      code: RepositoryErrorCode.NOT_FOUND,
    });
  });
});
