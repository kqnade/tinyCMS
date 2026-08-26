import { describe, expect, it } from "vitest";
import { createEditorialApplication } from "../src";

const emptyDocument = { type: "doc", content: [] } as const;

function createRepositoryStub() {
  return {
    createPostWithAuthor: async (input: any) => ({
      author: {
        id: input.author.id,
        accessSubject: input.author.accessSubject,
        displayName: input.author.displayName,
        email: input.author.email ?? null,
        avatarUrl: null,
        createdAt: input.author.createdAt,
        updatedAt: input.author.updatedAt,
      },
      post: {
        id: input.post.id,
        slug: input.post.slug,
        status: "draft",
        activePublishedRevisionId: null,
        scheduledAt: null,
        canonicalUrl: null,
        noindex: 0,
        createdBy: input.author.id,
        createdAt: input.post.createdAt,
        updatedAt: input.post.updatedAt,
      },
      revision: {
        id: input.revision.id,
        postId: input.post.id,
        version: 1,
        title: input.revision.title,
        contentVersion: 1,
        contentJson: input.revision.contentJson,
        excerpt: null,
        metadataJson: "{}",
        authorId: input.author.id,
        createdAt: input.revision.createdAt,
      },
    }),
  };
}

describe("editorial application", () => {
  it("creates a normalized post and uses a stable fallback for non-ASCII titles", async () => {
    const repository = createRepositoryStub();
    const application = createEditorialApplication({
      repository: repository as never,
      now: () => 1_700_000_000_000,
      uuidv7: () => "0192f5a4-7b3c-7d1e-8f20-123456789abc",
    });

    const result = await application.createPost(
      {
        title: "日本語の記事",
        contentVersion: 1,
        content: emptyDocument,
      },
      { subject: "access-subject", displayName: "Author" },
    );

    expect(result).toMatchObject({
      id: "0192f5a4-7b3c-7d1e-8f20-123456789abc",
      slug: "post-0192f5a4-7b3c",
      title: "日本語の記事",
      contentVersion: 1,
      content: emptyDocument,
      draftVersion: 1,
      currentRevisionVersion: 1,
      createdAt: "2023-11-14T22:13:20.000Z",
    });
  });

  it("rejects content before invoking the repository", async () => {
    let calls = 0;
    const repository = createRepositoryStub();
    const original = repository.createPostWithAuthor;
    repository.createPostWithAuthor = async (...args: Parameters<typeof original>) => {
      calls += 1;
      return original(...args);
    };
    const application = createEditorialApplication({
      repository: repository as never,
      now: () => 1_700_000_000_000,
      uuidv7: () => "0192f5a4-7b3c-7d1e-8f20-123456789abd",
    });

    await expect(
      application.createPost(
        { contentVersion: 1, content: { type: "script", content: [] } },
        { subject: "access-subject" },
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(calls).toBe(0);
  });
});
