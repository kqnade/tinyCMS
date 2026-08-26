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
