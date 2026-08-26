import type { SuccessResponse } from "./http";

export const EDITOR_CONTENT_VERSION = 1 as const;

type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export type JsonObject = {
  [key: string]: JsonValue;
};

export type UuidV7 = string;

export type UtcTimestamp = `${string}Z`;

export type PostLifecycle =
  | "draft"
  | "scheduled"
  | "publishing"
  | "published"
  | "archived"
  | "failed"
  | "trash";

export type PostDto = {
  id: UuidV7;
  slug: string;
  lifecycle: PostLifecycle;
  title: string;
  excerpt: string | null;
  draftVersion: number;
  currentRevisionVersion: number | null;
  createdByAuthorId: UuidV7;
  updatedByAuthorId: UuidV7;
  createdAt: UtcTimestamp;
  updatedAt: UtcTimestamp;
  contentVersion: typeof EDITOR_CONTENT_VERSION;
  content: unknown;
  metadata: JsonObject;
};

export type PostListItemDto = {
  id: UuidV7;
  slug: string;
  lifecycle: PostLifecycle;
  title: string;
  excerpt: string | null;
  draftVersion: number;
  currentRevisionVersion: number | null;
  createdByAuthorId: UuidV7;
  updatedByAuthorId: UuidV7;
  createdAt: UtcTimestamp;
  updatedAt: UtcTimestamp;
};

export type PostRevisionListItemDto = {
  id: UuidV7;
  postId: UuidV7;
  revisionVersion: number;
  title: string;
  excerpt: string | null;
  authorId: UuidV7;
  createdAt: UtcTimestamp;
};

export type PostRevisionDto = PostRevisionListItemDto & {
  contentVersion: typeof EDITOR_CONTENT_VERSION;
  content: unknown;
  metadata: JsonObject;
};

export type PostRevisionRouteParams = {
  postId: UuidV7;
  revisionId: UuidV7;
};

export type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
};

export type PostListQuery = {
  cursor?: string;
  limit?: number;
};

export type PostRevisionListQuery = PostListQuery;

export type PostRouteParams = {
  postId: UuidV7;
};

export type CreatePostRequest = {
  slug?: string;
  title?: string;
  contentVersion?: typeof EDITOR_CONTENT_VERSION;
  content?: unknown;
};

export type SavePostDraftRequest = {
  expectedDraftVersion: number;
  title: string;
  excerpt?: string | null;
  contentVersion: typeof EDITOR_CONTENT_VERSION;
  content: unknown;
  metadata?: JsonObject;
};

export type CheckpointPostRevisionRequest = {
  expectedDraftVersion: number;
  expectedRevisionVersion: number;
};

export type RestorePostRevisionRequest = {
  expectedDraftVersion: number;
  expectedRevisionVersion: number;
};

export type PostRevisionWriteResultDto = {
  post: PostDto;
  revision: PostRevisionDto;
};

export type PostListResponse = SuccessResponse<CursorPage<PostListItemDto>>;

export type CreatePostResponse = SuccessResponse<PostDto>;

export type ReadPostResponse = SuccessResponse<PostDto>;

export type SavePostDraftResponse = SuccessResponse<PostDto>;

export type CheckpointPostRevisionResponse = SuccessResponse<PostRevisionWriteResultDto>;

export type PostRevisionListResponse = SuccessResponse<CursorPage<PostRevisionListItemDto>>;

export type RestorePostRevisionResponse = SuccessResponse<PostRevisionWriteResultDto>;
