import { describe, expect, it, vi } from "vitest";
import { createEditorialApplication, type EditorialRepositoryPort } from "../src";

const emptyDocument = { type: "doc", content: [] } as const;

function createRepositoryStub(
  createPostWithAuthor: EditorialRepositoryPort["createPostWithAuthor"] = async (input) => ({
    author: {
      id: input.author.id,
      accessSubject: input.author.accessSubject,
      displayName: input.author.displayName,
      email: input.author.email ?? null,
      avatarUrl: input.author.avatarUrl ?? null,
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
): EditorialRepositoryPort {
  const unavailable = (method: string): never => {
    throw new Error(`${method} is not configured for this test`);
  };

  return {
    createPostWithAuthor,
    upsertAuthorByAccessSubject: async (input) => {
      void input;
      return unavailable("upsertAuthorByAccessSubject");
    },
    saveDraft: async (input) => {
      void input;
      return unavailable("saveDraft");
    },
    checkpointDraft: async (input) => {
      void input;
      return unavailable("checkpointDraft");
    },
    preparePublication: async (input) => {
      void input;
      return unavailable("preparePublication");
    },
    completePublication: async (input) => {
      void input;
      return unavailable("completePublication");
    },
    failPublication: async (input) => {
      void input;
      return unavailable("failPublication");
    },
    restoreDraft: async (input) => {
      void input;
      return unavailable("restoreDraft");
    },
    getPost: async (input) => {
      void input;
      return unavailable("getPost");
    },
    getDraft: async (input) => {
      void input;
      return unavailable("getDraft");
    },
    getLatestRevisionVersion: async (input) => {
      void input;
      return unavailable("getLatestRevisionVersion");
    },
    listPosts: async (input) => {
      void input;
      return unavailable("listPosts");
    },
    listRevisions: async (input) => {
      void input;
      return unavailable("listRevisions");
    },
  };
}

describe("editorial application", () => {
  it("renders an unsaved preview without reading or writing the repository", async () => {
    const application = createEditorialApplication({ repository: createRepositoryStub() });

    const result = await application.previewPost({
      title: "Preview <title>",
      excerpt: "An & excerpt",
      metadata: { seo: { description: "Preview description" } },
      contentVersion: 1,
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Body & text" }] }],
      },
    });

    expect(result.html).toBe(
      '<article><header><h1>Preview &lt;title&gt;</h1><p class="preview-excerpt">An &amp; excerpt</p></header><p>Body &amp; text</p></article>',
    );
  });

  it("writes immutable HTML and Markdown before activating a publication", async () => {
    const postId = "0192f5a4-7b3c-7d1e-8f20-123456789ac1";
    const authorId = "0192f5a4-7b3c-7d1e-8f20-123456789ac2";
    const revisionId = "0192f5a4-7b3c-7d1e-8f20-123456789ac3";
    const publicationJobId = "0192f5a4-7b3c-7d1e-8f20-123456789ac4";
    const timestamp = 1_700_000_030_000;
    const draft = {
      postId,
      version: 2,
      title: "Published <title>",
      contentVersion: 1,
      contentJson:
        '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Published body"}]}]}',
      excerpt: "A concise excerpt",
      metadataJson: "{}",
      authorId,
      updatedAt: timestamp - 1,
    };
    const revision = {
      id: revisionId,
      postId,
      version: 4,
      title: draft.title,
      contentVersion: draft.contentVersion,
      contentJson: draft.contentJson,
      excerpt: draft.excerpt,
      metadataJson: draft.metadataJson,
      authorId,
      createdAt: timestamp,
    };
    const job = {
      id: publicationJobId,
      idempotencyKey: "publish-request-1",
      postId,
      revisionId,
      state: "pending",
      attempts: 0,
      errorMessage: null,
      availableAt: null,
      startedAt: null,
      completedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const publishedPost = {
      id: postId,
      slug: "published-title",
      status: "published",
      activePublishedRevisionId: revisionId,
      scheduledAt: null,
      canonicalUrl: null,
      noindex: 0,
      createdBy: authorId,
      createdAt: timestamp - 10,
      updatedAt: timestamp,
    };
    const repository = Object.assign(createRepositoryStub(), {
      upsertAuthorByAccessSubject: vi.fn(async () => ({
        id: authorId,
        accessSubject: "publisher",
        displayName: "Publisher",
        email: null,
        avatarUrl: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })),
      preparePublication: vi.fn(async () => ({ revision, job })),
      completePublication: vi.fn(async () => ({
        post: publishedPost,
        job: {
          ...job,
          state: "succeeded",
          attempts: 1,
          startedAt: timestamp,
          completedAt: timestamp,
        },
      })),
      failPublication: vi.fn(),
      getPost: vi.fn(async () => publishedPost),
      getDraft: vi.fn(async () => draft),
      getLatestRevisionVersion: vi.fn(async () => revision.version),
    });
    const artifactStore = { put: vi.fn(async () => {}) };
    const identifiers = [authorId, revisionId, publicationJobId];
    const application = createEditorialApplication({
      repository,
      artifactStore,
      now: () => timestamp,
      uuidv7: () => identifiers.shift() as string,
    } as never);

    const result = await application.publishPost(
      postId,
      {
        expectedDraftVersion: draft.version,
        expectedRevisionVersion: revision.version - 1,
        idempotencyKey: job.idempotencyKey,
      },
      { subject: "publisher", displayName: "Publisher" },
    );

    const htmlPath = `posts/${postId}/revisions/${revisionId}.html`;
    const markdownPath = `posts/${postId}/revisions/${revisionId}.md`;
    expect(artifactStore.put.mock.calls).toEqual([
      [
        htmlPath,
        '<article><header><h1>Published &lt;title&gt;</h1><p class="article-excerpt">A concise excerpt</p></header><p>Published body</p></article>',
        {
          contentType: "text/html; charset=utf-8",
          cacheControl: "public, max-age=31536000, immutable",
        },
      ],
      [
        markdownPath,
        "# Published &lt;title&gt;\n\nA concise excerpt\n\nPublished body\n",
        {
          contentType: "text/markdown; charset=utf-8",
          cacheControl: "public, max-age=31536000, immutable",
        },
      ],
    ]);
    expect(repository.completePublication).toHaveBeenCalledAfter(artifactStore.put);
    expect(result).toMatchObject({
      publicationJobId,
      htmlPath,
      markdownPath,
      post: { id: postId, lifecycle: "published", currentRevisionVersion: revision.version },
      revision: { id: revisionId, revisionVersion: revision.version },
    });
  });

  it("creates a normalized post and uses a stable fallback for non-ASCII titles", async () => {
    const repository = createRepositoryStub();
    const application = createEditorialApplication({
      repository,
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
      slug: "post-0192f5a4-7b3c-7d1e-8f20-123456789abc",
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
      repository,
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

  it("maps synchronously thrown repository failures to a generic application error", async () => {
    const repository = {
      createPostWithAuthor: () => {
        throw new Error("database secret");
      },
    };
    const application = createEditorialApplication({
      repository: createRepositoryStub(repository.createPostWithAuthor),
      now: () => 1_700_000_000_000,
      uuidv7: () => "0192f5a4-7b3c-7d1e-8f20-123456789abe",
    });

    await expect(
      application.createPost(
        { title: "Failure", contentVersion: 1, content: emptyDocument },
        { subject: "access-subject" },
      ),
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR", message: "Internal server error" });
  });
});
