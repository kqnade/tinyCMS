import {
  ADMIN_POST_DRAFT_ROUTE,
  ADMIN_POST_REVISION_RESTORE_ROUTE,
  ADMIN_POST_REVISIONS_ROUTE,
  ADMIN_POST_ROUTE,
  ADMIN_POSTS_ROUTE,
  type CheckpointPostRevisionRequest,
  type CreatePostRequest,
  type CursorPage,
  ErrorCode,
  type ErrorCodeValue,
  type PostDto,
  type PostListItemDto,
  type PostListQuery,
  type PostRevisionListItemDto,
  type PostRevisionListQuery,
  type PostRevisionWriteResultDto,
  type RestorePostRevisionRequest,
  type SavePostDraftRequest,
  WRITE_BOUNDARY_HEADER,
  WRITE_BOUNDARY_VALUE,
} from "@tinycms/contracts";

export type EditorialApi = {
  listPosts: (query?: PostListQuery) => Promise<CursorPage<PostListItemDto>>;
  createPost: (request?: CreatePostRequest) => Promise<PostDto>;
  getPost: (postId: string) => Promise<PostDto>;
  saveDraft: (postId: string, request: SavePostDraftRequest) => Promise<PostDto>;
  listRevisions: (
    postId: string,
    query?: PostRevisionListQuery,
  ) => Promise<CursorPage<PostRevisionListItemDto>>;
  checkpointRevision: (
    postId: string,
    request: CheckpointPostRevisionRequest,
  ) => Promise<PostRevisionWriteResultDto>;
  restoreRevision: (
    postId: string,
    revisionId: string,
    request: RestorePostRevisionRequest,
  ) => Promise<PostRevisionWriteResultDto>;
};

export type EditorialApiErrorKind = "conflict" | "error";

export class EditorialApiError extends Error {
  readonly code?: ErrorCodeValue;
  readonly kind: EditorialApiErrorKind;
  readonly status: number;

  constructor(status: number, code?: ErrorCodeValue) {
    super("Editorial API request failed");
    this.name = "EditorialApiError";
    this.kind = status === 409 && code === ErrorCode.CONFLICT ? "conflict" : "error";
    this.status = status;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export type EditorialApiOptions = {
  readonly fetcher?: typeof fetch;
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeErrorCode(value: unknown): ErrorCodeValue | undefined {
  if (
    value === ErrorCode.INVALID_REQUEST ||
    value === ErrorCode.AUTH_REQUIRED ||
    value === ErrorCode.AUTH_INVALID ||
    value === ErrorCode.NOT_FOUND ||
    value === ErrorCode.CONFLICT ||
    value === ErrorCode.INTERNAL_ERROR
  ) {
    return value;
  }
  return undefined;
}

function encodePathPart(value: string): string {
  return encodeURIComponent(value);
}

function withQuery(path: string, query?: PostListQuery | PostRevisionListQuery): string {
  if (query === undefined) return path;
  const params = new URLSearchParams();
  if (query.cursor !== undefined) params.set("cursor", query.cursor);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  const encoded = params.toString();
  return encoded.length === 0 ? path : `${path}?${encoded}`;
}

function requestBody(request: object): string {
  return JSON.stringify(request);
}

export function createEditorialApi(options: EditorialApiOptions = {}): EditorialApi {
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);

  const request = async <T>(
    path: string,
    init: RequestInit = {},
    expectsJson = false,
  ): Promise<T> => {
    const headers = new Headers(init.headers);
    if (expectsJson) {
      headers.set("Content-Type", "application/json");
      headers.set(WRITE_BOUNDARY_HEADER, WRITE_BOUNDARY_VALUE);
    }

    let response: Response;
    try {
      response = await fetcher(path, { ...init, headers });
    } catch {
      throw new EditorialApiError(0);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new EditorialApiError(response.status);
    }

    if (!response.ok) {
      const error = isRecord(payload) && isRecord(payload.error) ? payload.error : undefined;
      throw new EditorialApiError(response.status, safeErrorCode(error?.code));
    }

    if (!isRecord(payload) || !("data" in payload)) {
      throw new EditorialApiError(response.status);
    }
    return payload.data as T;
  };

  return {
    listPosts: (query) => request<CursorPage<PostListItemDto>>(withQuery(ADMIN_POSTS_ROUTE, query)),
    createPost: (body = {}) =>
      request<PostDto>(ADMIN_POSTS_ROUTE, { body: requestBody(body), method: "POST" }, true),
    getPost: (postId) =>
      request<PostDto>(`${ADMIN_POST_ROUTE.replace(":postId", encodePathPart(postId))}`),
    saveDraft: (postId, body) =>
      request<PostDto>(
        ADMIN_POST_DRAFT_ROUTE.replace(":postId", encodePathPart(postId)),
        { body: requestBody(body), method: "PUT" },
        true,
      ),
    listRevisions: (postId, query) =>
      request<CursorPage<PostRevisionListItemDto>>(
        withQuery(ADMIN_POST_REVISIONS_ROUTE.replace(":postId", encodePathPart(postId)), query),
      ),
    checkpointRevision: (postId, body) =>
      request<PostRevisionWriteResultDto>(
        ADMIN_POST_REVISIONS_ROUTE.replace(":postId", encodePathPart(postId)),
        { body: requestBody(body), method: "POST" },
        true,
      ),
    restoreRevision: (postId, revisionId, body) =>
      request<PostRevisionWriteResultDto>(
        ADMIN_POST_REVISION_RESTORE_ROUTE.replace(":postId", encodePathPart(postId)).replace(
          ":revisionId",
          encodePathPart(revisionId),
        ),
        { body: requestBody(body), method: "POST" },
        true,
      ),
  };
}

export function isEditorialConflict(error: unknown): error is EditorialApiError {
  return error instanceof EditorialApiError && error.kind === "conflict";
}
