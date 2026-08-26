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
});
