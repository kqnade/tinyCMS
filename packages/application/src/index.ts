import {
  EDITOR_CONTENT_VERSION,
  type CreatePostRequest,
  type CursorPage,
  type JsonObject,
  type PostDto,
  type PostListItemDto,
  type PostListQuery,
  type PostRevisionDto,
  type PostRevisionListItemDto,
  type PostRevisionListQuery,
  type SavePostDraftRequest,
  type CheckpointPostRevisionRequest,
  type RestorePostRevisionRequest,
  parseUuidV7,
} from "@tinycms/contracts";
import {
  type Author,
  type CreateAuthorInput,
  type CreatePostWithAuthorInput,
  type CreatedAuthorPostRevision,
  type CheckpointDraftInput,
  RepositoryError,
  RepositoryErrorCode,
  type Post,
  type PostDraft,
  type PostRevision,
  type RestoreDraftInput,
  type SaveDraftInput,
} from "@tinycms/database";
import { type ContentDocument, validateContentDocument } from "@tinycms/content";

export const ApplicationErrorCode = {
  INVALID_REQUEST: "INVALID_REQUEST",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ApplicationErrorCodeValue =
  (typeof ApplicationErrorCode)[keyof typeof ApplicationErrorCode];

export class ApplicationError extends Error {
  readonly code: ApplicationErrorCodeValue;
  readonly details?: unknown;

  constructor(code: ApplicationErrorCodeValue, message: string, details?: unknown) {
    super(message);
    this.name = "ApplicationError";
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

export type AccessIdentity = {
  readonly subject: string;
  readonly email?: string;
  readonly displayName?: string;
  readonly avatarUrl?: string;
};

export interface EditorialRepositoryPort {
  createPostWithAuthor(input: CreatePostWithAuthorInput): Promise<CreatedAuthorPostRevision>;
  upsertAuthorByAccessSubject(input: CreateAuthorInput): Promise<Author>;
  saveDraft(input: SaveDraftInput): Promise<PostDraft>;
  checkpointDraft(input: CheckpointDraftInput): Promise<PostRevision>;
  restoreDraft(input: RestoreDraftInput): Promise<{ draft: PostDraft; revision: PostRevision }>;
  getPost(id: string): Promise<Post>;
  getDraft(postId: string): Promise<PostDraft>;
  getLatestRevisionVersion(postId: string): Promise<number | null>;
  listPosts(input: { limit: number; afterUpdatedAt?: number; afterId?: string }): Promise<Post[]>;
  listRevisions(input: {
    postId: string;
    limit: number;
    afterVersion?: number;
  }): Promise<PostRevision[]>;
}

export type EditorialApplicationDependencies = {
  readonly repository: EditorialRepositoryPort;
  readonly now?: () => number;
  readonly uuidv7?: () => string;
};

export type EditorialApplication = {
  createPost(request: CreatePostRequest, identity: AccessIdentity): Promise<PostDto>;
  getPost(postId: string): Promise<PostDto>;
  listPosts(query: PostListQuery): Promise<CursorPage<PostListItemDto>>;
  saveDraft(
    postId: string,
    request: SavePostDraftRequest,
    identity: AccessIdentity,
  ): Promise<PostDto>;
  checkpointRevision(
    postId: string,
    request: CheckpointPostRevisionRequest,
    identity: AccessIdentity,
  ): Promise<{ post: PostDto; revision: PostRevisionDto }>;
  listRevisions(
    postId: string,
    query: PostRevisionListQuery,
  ): Promise<CursorPage<PostRevisionListItemDto>>;
  restoreRevision(
    postId: string,
    revisionId: string,
    request: RestorePostRevisionRequest,
    identity: AccessIdentity,
  ): Promise<{ post: PostDto; revision: PostRevisionDto }>;
};

const DEFAULT_DOCUMENT: ContentDocument = { type: "doc", content: [] };
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;
const CURSOR_VERSION = 1;

type PostCursor = {
  readonly kind: "posts";
  readonly version: typeof CURSOR_VERSION;
  readonly updatedAt: number;
  readonly id: string;
};

type RevisionCursor = {
  readonly kind: "revisions";
  readonly version: typeof CURSOR_VERSION;
  readonly revisionVersion: number;
};

function defaultNow(): number {
  return Date.now();
}

function defaultUuidv7(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let timestamp = BigInt(Date.now());
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function applicationErrorFromRepository(error: unknown): ApplicationError {
  if (error instanceof RepositoryError) {
    switch (error.code) {
      case RepositoryErrorCode.NOT_FOUND:
        return new ApplicationError(ApplicationErrorCode.NOT_FOUND, "Resource not found");
      case RepositoryErrorCode.CONFLICT:
        return new ApplicationError(ApplicationErrorCode.CONFLICT, "Resource conflict");
      case RepositoryErrorCode.READ_FAILED:
      case RepositoryErrorCode.WRITE_FAILED:
        return new ApplicationError(ApplicationErrorCode.INTERNAL_ERROR, "Internal server error");
    }
  }
  return new ApplicationError(ApplicationErrorCode.INTERNAL_ERROR, "Internal server error");
}

function withRepositoryErrors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return Promise.resolve(operation()).catch((error: unknown) => {
      if (error instanceof ApplicationError) {
        throw error;
      }
      throw applicationErrorFromRepository(error);
    });
  } catch (error) {
    return Promise.reject(
      error instanceof ApplicationError ? error : applicationErrorFromRepository(error),
    );
  }
}

function normalizeContent(
  contentVersion: unknown,
  content: unknown,
): {
  readonly contentVersion: typeof EDITOR_CONTENT_VERSION;
  readonly content: ContentDocument;
  readonly contentJson: string;
} {
  const result = validateContentDocument(contentVersion, content);
  if (!result.ok) {
    throw new ApplicationError(
      ApplicationErrorCode.INVALID_REQUEST,
      "Invalid editor content",
      result.error.issues.map((issue) => ({ code: issue.code, path: issue.path })),
    );
  }
  return {
    contentVersion: EDITOR_CONTENT_VERSION,
    content: result.value,
    contentJson: JSON.stringify(result.value),
  };
}

function parseStoredJson(value: string, resource: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new ApplicationError(
      ApplicationErrorCode.INTERNAL_ERROR,
      `Stored ${resource} is invalid`,
    );
  }
}

function parseStoredMetadata(value: string): JsonObject {
  const parsed = parseStoredJson(value, "metadata");
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ApplicationError(ApplicationErrorCode.INTERNAL_ERROR, "Stored metadata is invalid");
  }
  return parsed as JsonObject;
}

function storedContent(version: number, value: string): ContentDocument {
  const content = parseStoredJson(value, "content");
  const result = validateContentDocument(version, content);
  if (!result.ok) {
    throw new ApplicationError(ApplicationErrorCode.INTERNAL_ERROR, "Stored content is invalid");
  }
  return result.value;
}

function toUtcTimestamp(epochMilliseconds: number): `${string}Z` {
  return new Date(epochMilliseconds).toISOString() as `${string}Z`;
}

function identityDisplayName(identity: AccessIdentity): string {
  return identity.displayName?.trim() || identity.email?.trim() || identity.subject;
}

function authorInput(identity: AccessIdentity, id: string, timestamp: number): CreateAuthorInput {
  return {
    id,
    accessSubject: identity.subject,
    displayName: identityDisplayName(identity),
    ...(identity.email === undefined ? {} : { email: identity.email }),
    ...(identity.avatarUrl === undefined ? {} : { avatarUrl: identity.avatarUrl }),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function slugFromTitle(title: string, postId: string): string {
  const fallback = `post-${postId}`;
  const containsNonAscii = [...title].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && codePoint > 0x7f;
  });
  if (title.trim() === "" || containsNonAscii) {
    return fallback;
  }
  const slug = title
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 128)
    .replace(/-+$/, "");
  return slug || fallback;
}

function mapRevision(revision: PostRevision): PostRevisionDto {
  return {
    id: revision.id,
    postId: revision.postId,
    revisionVersion: revision.version,
    title: revision.title,
    excerpt: revision.excerpt,
    authorId: revision.authorId,
    createdAt: toUtcTimestamp(revision.createdAt),
    contentVersion: revision.contentVersion as typeof EDITOR_CONTENT_VERSION,
    content: storedContent(revision.contentVersion, revision.contentJson),
    metadata: parseStoredMetadata(revision.metadataJson),
  };
}

function mapPost(post: Post, draft: PostDraft, currentRevisionVersion: number | null): PostDto {
  return {
    id: post.id,
    slug: post.slug,
    lifecycle: post.status as PostDto["lifecycle"],
    title: draft.title,
    excerpt: draft.excerpt,
    draftVersion: draft.version,
    currentRevisionVersion,
    createdByAuthorId: post.createdBy,
    updatedByAuthorId: draft.authorId,
    createdAt: toUtcTimestamp(post.createdAt),
    updatedAt: toUtcTimestamp(post.updatedAt),
    contentVersion: draft.contentVersion as typeof EDITOR_CONTENT_VERSION,
    content: storedContent(draft.contentVersion, draft.contentJson),
    metadata: parseStoredMetadata(draft.metadataJson),
  };
}

function mapPostListItem(
  post: Post,
  draft: PostDraft,
  currentRevisionVersion: number | null,
): PostListItemDto {
  const mapped = mapPost(post, draft, currentRevisionVersion);
  return {
    id: mapped.id,
    slug: mapped.slug,
    lifecycle: mapped.lifecycle,
    title: mapped.title,
    excerpt: mapped.excerpt,
    draftVersion: mapped.draftVersion,
    currentRevisionVersion: mapped.currentRevisionVersion,
    createdByAuthorId: mapped.createdByAuthorId,
    updatedByAuthorId: mapped.updatedByAuthorId,
    createdAt: mapped.createdAt,
    updatedAt: mapped.updatedAt,
  };
}

function encodeCursor(value: PostCursor | RevisionCursor): string {
  return btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decodeCursor(input: string, kind: "posts" | "revisions"): PostCursor | RevisionCursor {
  try {
    const normalized = input.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const parsed: unknown = JSON.parse(atob(padded));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      !Object.hasOwn(parsed, "kind") ||
      !Object.hasOwn(parsed, "version")
    ) {
      throw new Error("invalid cursor");
    }
    const record = parsed as Record<string, unknown>;
    if (record.kind !== kind || record.version !== CURSOR_VERSION) {
      throw new Error("invalid cursor");
    }
    if (kind === "posts") {
      if (
        typeof record.updatedAt !== "number" ||
        !Number.isSafeInteger(record.updatedAt) ||
        record.updatedAt < 0 ||
        typeof record.id !== "string" ||
        !parseUuidV7(record.id).ok
      ) {
        throw new Error("invalid cursor");
      }
      return record as unknown as PostCursor;
    }
    if (
      typeof record.revisionVersion !== "number" ||
      !Number.isSafeInteger(record.revisionVersion) ||
      record.revisionVersion < 1
    ) {
      throw new Error("invalid cursor");
    }
    return record as unknown as RevisionCursor;
  } catch {
    throw new ApplicationError(ApplicationErrorCode.INVALID_REQUEST, "Invalid cursor");
  }
}

function pageLimit(input: number | undefined): number {
  const value = input ?? DEFAULT_LIST_LIMIT;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_LIST_LIMIT) {
    throw new ApplicationError(ApplicationErrorCode.INVALID_REQUEST, "Invalid list limit");
  }
  return value;
}

export function createEditorialApplication(
  dependencies: EditorialApplicationDependencies,
): EditorialApplication {
  const now = dependencies.now ?? defaultNow;
  const uuidv7 = dependencies.uuidv7 ?? defaultUuidv7;
  const repository = dependencies.repository;

  const readPost = (postId: string): Promise<PostDto> =>
    withRepositoryErrors(async () => {
      const post = await repository.getPost(postId);
      const draft = await repository.getDraft(postId);
      const currentRevisionVersion = await repository.getLatestRevisionVersion(postId);
      return mapPost(post, draft, currentRevisionVersion);
    });

  const ensureAuthor = (identity: AccessIdentity, timestamp: number): Promise<Author> =>
    withRepositoryErrors(() =>
      repository.upsertAuthorByAccessSubject(authorInput(identity, uuidv7(), timestamp)),
    );

  const createPost = async (
    request: CreatePostRequest,
    identity: AccessIdentity,
  ): Promise<PostDto> => {
    const postId = uuidv7();
    const revisionId = uuidv7();
    const timestamp = now();
    const title = request.title ?? "";
    const normalized = normalizeContent(
      request.contentVersion ?? EDITOR_CONTENT_VERSION,
      request.content ?? DEFAULT_DOCUMENT,
    );
    const input: CreatePostWithAuthorInput = {
      author: authorInput(identity, uuidv7(), timestamp),
      post: {
        id: postId,
        slug: request.slug ?? slugFromTitle(title, postId),
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      revision: {
        id: revisionId,
        version: 1,
        title,
        contentVersion: normalized.contentVersion,
        contentJson: normalized.contentJson,
        metadataJson: "{}",
        createdAt: timestamp,
      },
    };
    return withRepositoryErrors(async () => {
      const created = await repository.createPostWithAuthor(input);
      return mapPost(
        created.post,
        {
          postId: created.post.id,
          version: 1,
          title: created.revision.title,
          contentVersion: created.revision.contentVersion,
          contentJson: created.revision.contentJson,
          excerpt: created.revision.excerpt,
          metadataJson: created.revision.metadataJson,
          authorId: created.author.id,
          updatedAt: created.revision.createdAt,
        },
        created.revision.version,
      );
    });
  };

  const saveDraft = async (
    postId: string,
    request: SavePostDraftRequest,
    identity: AccessIdentity,
  ): Promise<PostDto> => {
    const normalized = normalizeContent(request.contentVersion, request.content);
    const timestamp = now();
    const author = await ensureAuthor(identity, timestamp);
    return withRepositoryErrors(async () => {
      const currentDraft = await repository.getDraft(postId);
      const saved = await repository.saveDraft({
        postId,
        expectedDraftVersion: request.expectedDraftVersion,
        authorId: author.id,
        title: request.title,
        contentVersion: normalized.contentVersion,
        contentJson: normalized.contentJson,
        ...(request.excerpt === undefined
          ? { excerpt: currentDraft.excerpt }
          : { excerpt: request.excerpt }),
        metadataJson:
          request.metadata === undefined
            ? currentDraft.metadataJson
            : JSON.stringify(request.metadata),
        updatedAt: timestamp,
      });
      const post = await repository.getPost(postId);
      const currentRevisionVersion = await repository.getLatestRevisionVersion(postId);
      return mapPost(post, saved, currentRevisionVersion);
    });
  };

  const checkpointRevision = async (
    postId: string,
    request: CheckpointPostRevisionRequest,
    identity: AccessIdentity,
  ): Promise<{ post: PostDto; revision: PostRevisionDto }> => {
    const timestamp = now();
    const author = await ensureAuthor(identity, timestamp);
    const revision = await withRepositoryErrors(() =>
      repository.checkpointDraft({
        postId,
        expectedDraftVersion: request.expectedDraftVersion,
        expectedRevisionVersion: request.expectedRevisionVersion,
        revisionId: uuidv7(),
        authorId: author.id,
        createdAt: timestamp,
      }),
    );
    return { post: await readPost(postId), revision: mapRevision(revision) };
  };

  const restoreRevision = async (
    postId: string,
    revisionId: string,
    request: RestorePostRevisionRequest,
    identity: AccessIdentity,
  ): Promise<{ post: PostDto; revision: PostRevisionDto }> => {
    const timestamp = now();
    const author = await ensureAuthor(identity, timestamp);
    const result = await withRepositoryErrors(() =>
      repository.restoreDraft({
        postId,
        sourceRevisionId: revisionId,
        expectedDraftVersion: request.expectedDraftVersion,
        expectedRevisionVersion: request.expectedRevisionVersion,
        revisionId: uuidv7(),
        authorId: author.id,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    return { post: await readPost(postId), revision: mapRevision(result.revision) };
  };

  const listPosts = async (query: PostListQuery): Promise<CursorPage<PostListItemDto>> => {
    const limit = pageLimit(query.limit);
    const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor, "posts");
    const rows = await withRepositoryErrors(() =>
      repository.listPosts({
        limit: limit + 1,
        ...(cursor?.kind === "posts"
          ? { afterUpdatedAt: cursor.updatedAt, afterId: cursor.id }
          : {}),
      }),
    );
    const hasNext = rows.length > limit;
    const pageRows = hasNext ? rows.slice(0, limit) : rows;
    const items = await Promise.all(
      pageRows.map(async (post) => {
        const [draft, currentRevisionVersion] = await withRepositoryErrors(() =>
          Promise.all([repository.getDraft(post.id), repository.getLatestRevisionVersion(post.id)]),
        );
        return mapPostListItem(post, draft, currentRevisionVersion);
      }),
    );
    const last = pageRows.at(-1);
    return {
      items,
      nextCursor:
        hasNext && last !== undefined
          ? encodeCursor({
              kind: "posts",
              version: CURSOR_VERSION,
              updatedAt: last.updatedAt,
              id: last.id,
            })
          : null,
    };
  };

  const listRevisions = async (
    postId: string,
    query: PostRevisionListQuery,
  ): Promise<CursorPage<PostRevisionListItemDto>> => {
    const limit = pageLimit(query.limit);
    const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor, "revisions");
    await withRepositoryErrors(() => repository.getPost(postId));
    const rows = await withRepositoryErrors(() =>
      repository.listRevisions({
        postId,
        limit: limit + 1,
        ...(cursor?.kind === "revisions" ? { afterVersion: cursor.revisionVersion } : {}),
      }),
    );
    const hasNext = rows.length > limit;
    const pageRows = hasNext ? rows.slice(0, limit) : rows;
    return {
      items: pageRows.map((revision) => ({
        id: revision.id,
        postId: revision.postId,
        revisionVersion: revision.version,
        title: revision.title,
        excerpt: revision.excerpt,
        authorId: revision.authorId,
        createdAt: toUtcTimestamp(revision.createdAt),
      })),
      nextCursor:
        hasNext && pageRows.at(-1) !== undefined
          ? encodeCursor({
              kind: "revisions",
              version: CURSOR_VERSION,
              revisionVersion: pageRows.at(-1)?.version as number,
            })
          : null,
    };
  };

  return {
    createPost,
    getPost: readPost,
    listPosts,
    saveDraft,
    checkpointRevision,
    listRevisions,
    restoreRevision,
  };
}
