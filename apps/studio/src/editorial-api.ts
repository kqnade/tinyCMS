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

export const ADMIN_MEDIA_ROUTE = "/api/v1/admin/media" as const;
export const ADMIN_MEDIA_ITEM_ROUTE = `${ADMIN_MEDIA_ROUTE}/:mediaId` as const;
export const ADMIN_MEDIA_ORIGINAL_ROUTE = `${ADMIN_MEDIA_ITEM_ROUTE}/original` as const;

export type MediaAssetState = "pending" | "ready" | "failed" | "trash";

export type MediaVariantFormat = "avif" | "webp";

export type MediaVariant = {
  name: string;
  width: number;
  height: number;
  format: MediaVariantFormat;
  byteSize: number;
  url: string;
};

export type MediaAsset = {
  id: string;
  filename: string;
  mediaType: string;
  byteSize: number;
  width: number;
  height: number;
  altText: string;
  contentHash: string;
  state: MediaAssetState;
  version: number;
  variants: MediaVariant[];
  createdBy: string;
  createdAt: `${string}Z`;
  updatedAt: `${string}Z`;
};

export type MediaListQuery = {
  cursor?: string;
  limit?: number;
};

export type MediaRouteParams = {
  mediaId: string;
};

export type UpdateMediaRequest = {
  expectedVersion: number;
  altText: string;
};

export type DeleteMediaRequest = {
  expectedVersion: number;
};

export type MediaResponse = { data: MediaAsset; meta: { requestId: string } };

export type MediaListResponse = {
  data: CursorPage<MediaAsset>;
  meta: { requestId: string };
};

export type MediaApi = {
  listMedia: (query?: MediaListQuery) => Promise<CursorPage<MediaAsset>>;
  getMedia: (mediaId: string) => Promise<MediaAsset>;
  getMediaOriginalUrl: (mediaId: string) => string;
  uploadMedia: (file: File, altText?: string) => Promise<MediaAsset>;
  updateMedia: (mediaId: string, request: UpdateMediaRequest) => Promise<MediaAsset>;
  deleteMedia: (mediaId: string, request: DeleteMediaRequest) => Promise<MediaAsset>;
};

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
} & MediaApi;

export type EditorialApiErrorKind = "conflict" | "error";

export class EditorialApiError extends Error {
  readonly code: ErrorCodeValue | undefined;
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

function withQuery(
  path: string,
  query?: PostListQuery | PostRevisionListQuery | MediaListQuery,
): string {
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

const MEDIA_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
const MEDIA_UPLOAD_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function assertUploadableMedia(file: File): void {
  if (file === undefined || file === null) {
    throw new TypeError("Media file is required");
  }
  if (!MEDIA_UPLOAD_TYPES.has(file.type)) {
    throw new TypeError("Unsupported media type");
  }
  if (file.size > MEDIA_UPLOAD_MAX_BYTES) {
    throw new TypeError("Media file exceeds 20 MiB");
  }
}

function mediaOriginalUrl(mediaId: string): string {
  return ADMIN_MEDIA_ORIGINAL_ROUTE.replace(":mediaId", encodePathPart(mediaId));
}

export function createEditorialApi(options: EditorialApiOptions = {}): EditorialApi {
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);

  type RequestBodyMode = "json" | "multipart";

  const request = async <T>(
    path: string,
    init: RequestInit = {},
    bodyMode?: RequestBodyMode,
  ): Promise<T> => {
    const headers = new Headers(init.headers);
    if (bodyMode === "json") {
      headers.set("Content-Type", "application/json");
      headers.set(WRITE_BOUNDARY_HEADER, WRITE_BOUNDARY_VALUE);
    } else if (bodyMode === "multipart") {
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
      request<PostDto>(ADMIN_POSTS_ROUTE, { body: requestBody(body), method: "POST" }, "json"),
    getPost: (postId) =>
      request<PostDto>(`${ADMIN_POST_ROUTE.replace(":postId", encodePathPart(postId))}`),
    saveDraft: (postId, body) =>
      request<PostDto>(
        ADMIN_POST_DRAFT_ROUTE.replace(":postId", encodePathPart(postId)),
        { body: requestBody(body), method: "PUT" },
        "json",
      ),
    listRevisions: (postId, query) =>
      request<CursorPage<PostRevisionListItemDto>>(
        withQuery(ADMIN_POST_REVISIONS_ROUTE.replace(":postId", encodePathPart(postId)), query),
      ),
    checkpointRevision: (postId, body) =>
      request<PostRevisionWriteResultDto>(
        ADMIN_POST_REVISIONS_ROUTE.replace(":postId", encodePathPart(postId)),
        { body: requestBody(body), method: "POST" },
        "json",
      ),
    restoreRevision: (postId, revisionId, body) =>
      request<PostRevisionWriteResultDto>(
        ADMIN_POST_REVISION_RESTORE_ROUTE.replace(":postId", encodePathPart(postId)).replace(
          ":revisionId",
          encodePathPart(revisionId),
        ),
        { body: requestBody(body), method: "POST" },
        "json",
      ),
    listMedia: (query) => request<CursorPage<MediaAsset>>(withQuery(ADMIN_MEDIA_ROUTE, query)),
    getMedia: (mediaId) =>
      request<MediaAsset>(ADMIN_MEDIA_ITEM_ROUTE.replace(":mediaId", encodePathPart(mediaId))),
    getMediaOriginalUrl: mediaOriginalUrl,
    uploadMedia: async (file, altText) => {
      assertUploadableMedia(file);
      const form = new FormData();
      form.append("file", file);
      if (altText !== undefined) form.append("altText", altText);
      return request<MediaAsset>(ADMIN_MEDIA_ROUTE, { body: form, method: "POST" }, "multipart");
    },
    updateMedia: (mediaId, body) =>
      request<MediaAsset>(
        ADMIN_MEDIA_ITEM_ROUTE.replace(":mediaId", encodePathPart(mediaId)),
        { body: requestBody(body), method: "PATCH" },
        "json",
      ),
    deleteMedia: (mediaId, body) =>
      request<MediaAsset>(
        ADMIN_MEDIA_ITEM_ROUTE.replace(":mediaId", encodePathPart(mediaId)),
        { body: requestBody(body), method: "DELETE" },
        "json",
      ),
  };
}

export const getMediaOriginalUrl = mediaOriginalUrl;

export function isEditorialConflict(error: unknown): error is EditorialApiError {
  return error instanceof EditorialApiError && error.kind === "conflict";
}
