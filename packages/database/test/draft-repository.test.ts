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
