import { describe, expect, it } from "vitest";
import {
  type CheckpointPostRevisionRequest,
  type CheckpointPostRevisionResponse,
  type CreatePostRequest,
  type CreatePostResponse,
  type CursorPage,
  EDITOR_CONTENT_VERSION,
  type PostDto,
  type PostListItemDto,
  type PostListQuery,
  type PostListResponse,
  type PostRevisionDto,
  type PostRevisionListItemDto,
  type PostRevisionListResponse,
  type PostRevisionRouteParams,
  type PostRevisionWriteResultDto,
  type PostRouteParams,
  type ReadPostResponse,
  type RestorePostRevisionRequest,
  type RestorePostRevisionResponse,
  type SavePostDraftRequest,
  type SavePostDraftResponse,
} from "../src/index";

describe("editorial DTO contracts", () => {
  it("serializes a complete post DTO with structured content and metadata", () => {
    const post: PostDto = {
      id: "0192f5a4-7b3c-7d1e-8f20-123456789abc",
      slug: "hello-world",
      lifecycle: "draft",
      title: "Hello, world",
      excerpt: null,
      draftVersion: 3,
      currentRevisionVersion: null,
      createdByAuthorId: "0192f5a4-7b3c-7d1e-8f20-123456789abd",
      updatedByAuthorId: "0192f5a4-7b3c-7d1e-8f20-123456789abe",
      createdAt: "2026-08-26T00:00:00.000Z",
      updatedAt: "2026-08-26T01:00:00.000Z",
      contentVersion: EDITOR_CONTENT_VERSION,
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
      },
      metadata: { seo: { description: "A greeting" } },
    };

    expect(JSON.stringify(post)).toBe(
      '{"id":"0192f5a4-7b3c-7d1e-8f20-123456789abc","slug":"hello-world","lifecycle":"draft","title":"Hello, world","excerpt":null,"draftVersion":3,"currentRevisionVersion":null,"createdByAuthorId":"0192f5a4-7b3c-7d1e-8f20-123456789abd","updatedByAuthorId":"0192f5a4-7b3c-7d1e-8f20-123456789abe","createdAt":"2026-08-26T00:00:00.000Z","updatedAt":"2026-08-26T01:00:00.000Z","contentVersion":1,"content":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hello"}]}]},"metadata":{"seo":{"description":"A greeting"}}}',
    );
  });

  it("serializes a complete revision and accepts the editorial transport DTO shapes", () => {
    const revision: PostRevisionDto = {
      id: "0192f5a4-7b3c-7d1e-8f20-123456789abf",
      postId: "0192f5a4-7b3c-7d1e-8f20-123456789abc",
      revisionVersion: 4,
      title: "Hello, world",
      excerpt: "A greeting",
      authorId: "0192f5a4-7b3c-7d1e-8f20-123456789abe",
      createdAt: "2026-08-26T02:00:00.000Z",
      contentVersion: EDITOR_CONTENT_VERSION,
      content: { type: "doc", content: [] },
      metadata: { seo: { description: "A greeting" } },
    };
    const routeParams: PostRevisionRouteParams = {
      postId: "0192f5a4-7b3c-7d1e-8f20-123456789abc",
      revisionId: revision.id,
    };
    const createRequest: CreatePostRequest = {
      slug: "hello-world",
      title: "Hello, world",
      contentVersion: EDITOR_CONTENT_VERSION,
      content: { type: "doc", content: [] },
    };
    const saveDraftRequest: SavePostDraftRequest = {
      expectedDraftVersion: 3,
      title: "Hello, world",
      excerpt: null,
      contentVersion: EDITOR_CONTENT_VERSION,
      content: { type: "doc", content: [] },
      metadata: { seo: { description: "A greeting" } },
    };
    const checkpointRequest: CheckpointPostRevisionRequest = { expectedDraftVersion: 4 };
    const restoreRequest: RestorePostRevisionRequest = { expectedDraftVersion: 5 };

    expect(JSON.stringify(revision)).toBe(
      '{"id":"0192f5a4-7b3c-7d1e-8f20-123456789abf","postId":"0192f5a4-7b3c-7d1e-8f20-123456789abc","revisionVersion":4,"title":"Hello, world","excerpt":"A greeting","authorId":"0192f5a4-7b3c-7d1e-8f20-123456789abe","createdAt":"2026-08-26T02:00:00.000Z","contentVersion":1,"content":{"type":"doc","content":[]},"metadata":{"seo":{"description":"A greeting"}}}',
    );
    expect({
      routeParams,
      createRequest,
      saveDraftRequest,
      checkpointRequest,
      restoreRequest,
    }).toEqual({
      routeParams,
      createRequest,
      saveDraftRequest,
      checkpointRequest,
      restoreRequest,
    });
  });

  it("serializes cursor pages and a post revision write result through response aliases", () => {
    const post: PostDto = {
      id: "0192f5a4-7b3c-7d1e-8f20-123456789abc",
      slug: "hello-world",
      lifecycle: "published",
      title: "Hello, world",
      excerpt: "A greeting",
      draftVersion: 4,
      currentRevisionVersion: 4,
      createdByAuthorId: "0192f5a4-7b3c-7d1e-8f20-123456789abd",
      updatedByAuthorId: "0192f5a4-7b3c-7d1e-8f20-123456789abe",
      createdAt: "2026-08-26T00:00:00.000Z",
      updatedAt: "2026-08-26T02:00:00.000Z",
      contentVersion: EDITOR_CONTENT_VERSION,
      content: { type: "doc", content: [] },
      metadata: { seo: { description: "A greeting" } },
    };
    const revision: PostRevisionDto = {
      id: "0192f5a4-7b3c-7d1e-8f20-123456789abf",
      postId: post.id,
      revisionVersion: 4,
      title: post.title,
      excerpt: post.excerpt,
      authorId: post.updatedByAuthorId,
      createdAt: post.updatedAt,
      contentVersion: EDITOR_CONTENT_VERSION,
      content: post.content,
      metadata: post.metadata,
    };
    const listItem: PostListItemDto = {
      id: post.id,
      slug: post.slug,
      lifecycle: post.lifecycle,
      title: post.title,
      excerpt: post.excerpt,
      draftVersion: post.draftVersion,
      currentRevisionVersion: post.currentRevisionVersion,
      createdByAuthorId: post.createdByAuthorId,
      updatedByAuthorId: post.updatedByAuthorId,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
    };
    const revisionListItem: PostRevisionListItemDto = {
      id: revision.id,
      postId: revision.postId,
      revisionVersion: revision.revisionVersion,
      title: revision.title,
      excerpt: revision.excerpt,
      authorId: revision.authorId,
      createdAt: revision.createdAt,
    };
    const postPage: CursorPage<PostListItemDto> = {
      items: [listItem],
      nextCursor: "cursor-2",
    };
    const revisionPage: CursorPage<PostRevisionListItemDto> = {
      items: [revisionListItem],
      nextCursor: null,
    };
    const writeResult: PostRevisionWriteResultDto = { post, revision };
    const query: PostListQuery = { cursor: "cursor-1", limit: 10 };
    const emptyQuery: PostListQuery = {};
    const routeParams: PostRouteParams = { postId: post.id };

    const postListResponse: PostListResponse = {
      data: postPage,
      meta: { requestId: "request-list" },
    };
    const createResponse: CreatePostResponse = {
      data: post,
      meta: { requestId: "request-create" },
    };
    const readResponse: ReadPostResponse = {
      data: post,
      meta: { requestId: "request-read" },
    };
    const saveDraftResponse: SavePostDraftResponse = {
      data: post,
      meta: { requestId: "request-draft" },
    };
    const checkpointResponse: CheckpointPostRevisionResponse = {
      data: writeResult,
      meta: { requestId: "request-checkpoint" },
    };
    const revisionListResponse: PostRevisionListResponse = {
      data: revisionPage,
      meta: { requestId: "request-revisions" },
    };
    const restoreResponse: RestorePostRevisionResponse = {
      data: writeResult,
      meta: { requestId: "request-restore" },
    };

    expect(JSON.stringify(postPage)).toBe(
      '{"items":[{"id":"0192f5a4-7b3c-7d1e-8f20-123456789abc","slug":"hello-world","lifecycle":"published","title":"Hello, world","excerpt":"A greeting","draftVersion":4,"currentRevisionVersion":4,"createdByAuthorId":"0192f5a4-7b3c-7d1e-8f20-123456789abd","updatedByAuthorId":"0192f5a4-7b3c-7d1e-8f20-123456789abe","createdAt":"2026-08-26T00:00:00.000Z","updatedAt":"2026-08-26T02:00:00.000Z"}],"nextCursor":"cursor-2"}',
    );
    expect(JSON.stringify(writeResult)).toBe(
      '{"post":{"id":"0192f5a4-7b3c-7d1e-8f20-123456789abc","slug":"hello-world","lifecycle":"published","title":"Hello, world","excerpt":"A greeting","draftVersion":4,"currentRevisionVersion":4,"createdByAuthorId":"0192f5a4-7b3c-7d1e-8f20-123456789abd","updatedByAuthorId":"0192f5a4-7b3c-7d1e-8f20-123456789abe","createdAt":"2026-08-26T00:00:00.000Z","updatedAt":"2026-08-26T02:00:00.000Z","contentVersion":1,"content":{"type":"doc","content":[]},"metadata":{"seo":{"description":"A greeting"}}},"revision":{"id":"0192f5a4-7b3c-7d1e-8f20-123456789abf","postId":"0192f5a4-7b3c-7d1e-8f20-123456789abc","revisionVersion":4,"title":"Hello, world","excerpt":"A greeting","authorId":"0192f5a4-7b3c-7d1e-8f20-123456789abe","createdAt":"2026-08-26T02:00:00.000Z","contentVersion":1,"content":{"type":"doc","content":[]},"metadata":{"seo":{"description":"A greeting"}}}}',
    );
    expect({
      emptyQuery,
      query,
      routeParams,
      postListResponse,
      createResponse,
      readResponse,
      saveDraftResponse,
      checkpointResponse,
      revisionListResponse,
      restoreResponse,
    }).toMatchObject({
      emptyQuery: {},
      query: { cursor: "cursor-1", limit: 10 },
      routeParams: { postId: post.id },
      postListResponse: { data: postPage },
      createResponse: { data: post },
      readResponse: { data: post },
      saveDraftResponse: { data: post },
      checkpointResponse: { data: writeResult },
      revisionListResponse: { data: revisionPage },
      restoreResponse: { data: writeResult },
    });
  });
});
