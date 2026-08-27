import type {
  CursorPage,
  DeleteMediaRequest,
  MediaAsset,
  MediaListQuery,
  MediaVariant as MediaVariantDto,
  UpdateMediaRequest,
} from "@tinycms/contracts";
import {
  type Author,
  type CreateMediaVariantInput,
  type CreateMediaWithAuthorInput,
  type Media,
  type MediaAggregate,
  type MediaRepository,
  type MediaVariant,
  RepositoryError,
  RepositoryErrorCode,
} from "@tinycms/database";
import { ApplicationError, ApplicationErrorCode } from "./errors";
import {
  type MediaStructuralInspector,
  type MediaUploadInput,
  verifyMediaUpload,
} from "./media-validation";

export type MediaObjectWriteOptions = {
  readonly contentType: string;
  readonly cacheControl: string;
};

export type MediaObjectStorePort = {
  readonly put: (key: string, bytes: Uint8Array, options: MediaObjectWriteOptions) => Promise<void>;
  readonly delete: (key: string) => Promise<void>;
};

export type MediaPrivateOriginalStorePort = MediaObjectStorePort;
export type MediaPublicDerivativeStorePort = MediaObjectStorePort;

export type MediaTransformInput = {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly format: "avif" | "webp";
  readonly withoutEnlargement: true;
};

export type MediaDerivativeTransformerPort = (input: MediaTransformInput) => Promise<Uint8Array>;

export type MediaOriginalDescriptor = {
  readonly key: string;
  readonly filename: string;
  readonly mediaType: string;
};

export type MediaApplicationDependencies = {
  readonly repository: MediaRepository;
  readonly inspector: MediaStructuralInspector;
  readonly originalStore: MediaPrivateOriginalStorePort;
  readonly transformer: MediaDerivativeTransformerPort;
  readonly derivativeStore: MediaPublicDerivativeStorePort;
  readonly now?: () => number;
  readonly uuidv7?: () => string;
};

export type MediaAccessIdentity = {
  readonly subject: string;
  readonly email?: string;
  readonly displayName?: string;
  readonly avatarUrl?: string;
};

export type MediaApplication = {
  createMedia(request: MediaUploadInput, identity: MediaAccessIdentity): Promise<MediaAsset>;
  getMedia(mediaId: string): Promise<MediaAsset>;
  listMedia(query: MediaListQuery): Promise<CursorPage<MediaAsset>>;
  updateMediaAlt(mediaId: string, request: UpdateMediaRequest): Promise<MediaAsset>;
  trashMedia(mediaId: string, request: DeleteMediaRequest): Promise<MediaAsset>;
  getMediaOriginal(mediaId: string): Promise<MediaOriginalDescriptor>;
};

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;
const CURSOR_VERSION = 1;
const ORIGINAL_CACHE_CONTROL = "private, no-store";
const DERIVATIVE_CACHE_CONTROL = "public, max-age=31536000, immutable";

type MediaCursor = {
  readonly kind: "media";
  readonly version: typeof CURSOR_VERSION;
  readonly updatedAt: number;
  readonly id: string;
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
      if (error instanceof ApplicationError) throw error;
      throw applicationErrorFromRepository(error);
    });
  } catch (error) {
    return Promise.reject(
      error instanceof ApplicationError ? error : applicationErrorFromRepository(error),
    );
  }
}

function mediaWriteFailed(): ApplicationError {
  return new ApplicationError(ApplicationErrorCode.MEDIA_WRITE_FAILED, "Media write failed");
}

function invalidStoredMedia(): ApplicationError {
  return new ApplicationError(
    ApplicationErrorCode.INTERNAL_ERROR,
    "Stored media metadata is invalid",
  );
}

function toUtcTimestamp(value: unknown): `${string}Z` {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw invalidStoredMedia();
  try {
    return new Date(value as number).toISOString() as `${string}Z`;
  } catch {
    throw invalidStoredMedia();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown): string {
  if (typeof value !== "string") throw invalidStoredMedia();
  return value;
}

function requiredNonNegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw invalidStoredMedia();
  return value as number;
}

function requiredPositiveInteger(value: unknown): number {
  const result = requiredNonNegativeInteger(value);
  if (result < 1) throw invalidStoredMedia();
  return result;
}

function mediaState(value: unknown): MediaAsset["state"] {
  if (value === "pending" || value === "ready" || value === "failed" || value === "trash") {
    return value;
  }
  throw invalidStoredMedia();
}

function mediaFormat(value: unknown): MediaVariantDto["format"] {
  if (value === "avif" || value === "webp") return value;
  throw invalidStoredMedia();
}

function mediaVariantDto(mediaId: string, variant: MediaVariant): MediaVariantDto {
  if (!isRecord(variant)) throw invalidStoredMedia();
  const name = requiredString(variant.name);
  const width = requiredPositiveInteger(variant.width);
  const height = requiredPositiveInteger(variant.height);
  const format = mediaFormat(variant.format);
  const byteSize = requiredNonNegativeInteger(variant.byteSize);
  requiredString(variant.r2Key);
  toUtcTimestamp(variant.createdAt);
  if (variant.mediaId !== undefined && variant.mediaId !== mediaId) throw invalidStoredMedia();
  return { name, width, height, format, byteSize, url: `/media/${mediaId}/${name}` };
}

function mediaAsset(aggregate: MediaAggregate): MediaAsset {
  const media = aggregate.media as unknown as Record<string, unknown>;
  if (!isRecord(media)) throw invalidStoredMedia();
  const id = requiredString(media.id);
  const filename = requiredString(media.filename);
  const mediaType = requiredString(media.mediaType);
  const byteSize = requiredNonNegativeInteger(media.byteSize);
  const width = requiredPositiveInteger(media.width);
  const height = requiredPositiveInteger(media.height);
  const altText = requiredString(media.altText);
  const contentHash = requiredString(media.contentHash);
  const state = mediaState(media.state);
  const version = requiredPositiveInteger(media.version);
  const createdBy = requiredString(media.createdBy);
  const createdAt = toUtcTimestamp(media.createdAt);
  const updatedAt = toUtcTimestamp(media.updatedAt);
  if (!Array.isArray(aggregate.variants)) throw invalidStoredMedia();
  const variants = aggregate.variants
    .map((variant) => mediaVariantDto(id, variant))
    .sort((left, right) =>
      left.name === right.name
        ? left.format.localeCompare(right.format)
        : left.name.localeCompare(right.name),
    );
  return {
    id,
    filename,
    mediaType,
    byteSize,
    width,
    height,
    altText,
    contentHash,
    state,
    version,
    variants,
    createdBy,
    createdAt,
    updatedAt,
  };
}

function encodeCursor(value: MediaCursor): string {
  return btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decodeCursor(input: string): MediaCursor {
  try {
    const normalized = input.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const parsed: unknown = JSON.parse(atob(padded));
    if (!isRecord(parsed)) throw new Error("invalid cursor");
    if (
      parsed.kind !== "media" ||
      parsed.version !== CURSOR_VERSION ||
      !Number.isSafeInteger(parsed.updatedAt) ||
      (parsed.updatedAt as number) < 0 ||
      typeof parsed.id !== "string" ||
      parsed.id.length === 0
    ) {
      throw new Error("invalid cursor");
    }
    return parsed as unknown as MediaCursor;
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

function authorInput(identity: MediaAccessIdentity, id: string, timestamp: number) {
  const displayName = identity.displayName?.trim() || identity.email?.trim() || identity.subject;
  return {
    id,
    accessSubject: identity.subject,
    displayName,
    ...(identity.email === undefined ? {} : { email: identity.email }),
    ...(identity.avatarUrl === undefined ? {} : { avatarUrl: identity.avatarUrl }),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

async function putObject(
  store: MediaObjectStorePort,
  key: string,
  bytes: Uint8Array,
  options: MediaObjectWriteOptions,
): Promise<void> {
  await store.put(key, bytes, options);
}

async function deleteObject(store: MediaObjectStorePort, key: string): Promise<void> {
  await store.delete(key);
}

async function transformDerivative(
  transformer: MediaDerivativeTransformerPort,
  input: MediaTransformInput,
): Promise<Uint8Array> {
  return transformer(input);
}

function derivativeName(width: number, format: "avif" | "webp"): string {
  return `w${width}.${format}`;
}

function derivativeKey(mediaId: string, name: string): string {
  return `media/derivatives/${mediaId}/${name}`;
}

export function createMediaApplication(
  dependencies: MediaApplicationDependencies,
): MediaApplication {
  const now = dependencies.now ?? defaultNow;
  const uuidv7 = dependencies.uuidv7 ?? defaultUuidv7;
  const repository = dependencies.repository;

  const createMedia = async (
    request: MediaUploadInput,
    identity: MediaAccessIdentity,
  ): Promise<MediaAsset> => {
    const verified = await verifyMediaUpload(request, dependencies.inspector);
    const mediaId = uuidv7();
    const timestamp = now();
    const originalKey = `media/originals/${mediaId}/${verified.contentHash}`;
    const createdKeys: string[] = [];

    let created: { author: Author; media: Media };
    try {
      const input: CreateMediaWithAuthorInput = {
        author: authorInput(identity, uuidv7(), timestamp),
        media: {
          id: mediaId,
          r2Key: originalKey,
          filename: verified.filename,
          mediaType: verified.mediaType,
          byteSize: verified.byteSize,
          width: verified.width,
          height: verified.height,
          altText: verified.altText,
          contentHash: verified.contentHash,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      };
      created = await repository.createMediaWithAuthor(input);
    } catch {
      throw mediaWriteFailed();
    }

    const originalStore = dependencies.originalStore;
    const derivativeStore = dependencies.derivativeStore;
    const transformer = dependencies.transformer;
    const variants: CreateMediaVariantInput[] = [];

    try {
      createdKeys.push(originalKey);
      await putObject(originalStore, originalKey, verified.bytes, {
        contentType: verified.mediaType,
        cacheControl: ORIGINAL_CACHE_CONTROL,
      });

      for (const size of verified.derivativeSizes) {
        for (const format of ["avif", "webp"] as const) {
          const name = derivativeName(size.width, format);
          const key = derivativeKey(mediaId, name);
          const bytes = await transformDerivative(transformer, {
            bytes: verified.bytes,
            width: size.width,
            height: size.height,
            format,
            withoutEnlargement: true,
          });
          createdKeys.push(key);
          await putObject(derivativeStore, key, bytes, {
            contentType: `image/${format}`,
            cacheControl: DERIVATIVE_CACHE_CONTROL,
          });
          variants.push({
            name,
            format,
            r2Key: key,
            byteSize: bytes.byteLength,
            width: size.width,
            height: size.height,
            createdAt: timestamp,
          });
        }
      }

      const finalized = await repository.finalizeMedia({
        mediaId,
        variants,
        updatedAt: timestamp,
        expectedVersion: created.media.version,
      });
      return mediaAsset(finalized);
    } catch {
      await Promise.all(
        createdKeys.map(async (key) => {
          try {
            await deleteObject(
              key.startsWith("media/originals/") ? originalStore : derivativeStore,
              key,
            );
          } catch {
            // Cleanup is best effort.
          }
        }),
      );
      try {
        await repository.markMediaFailed({
          mediaId,
          updatedAt: timestamp,
          expectedVersion: created.media.version,
        });
      } catch {
        // Preserve the original media-write error.
      }
      throw mediaWriteFailed();
    }
  };

  const getMedia = (mediaId: string): Promise<MediaAsset> =>
    withRepositoryErrors(async () => mediaAsset(await repository.getMediaAggregate(mediaId)));

  const listMedia = async (query: MediaListQuery): Promise<CursorPage<MediaAsset>> => {
    const limit = pageLimit(query.limit);
    const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    const rows = await withRepositoryErrors(() =>
      repository.listMedia({
        limit,
        ...(cursor === undefined ? {} : { afterUpdatedAt: cursor.updatedAt, afterId: cursor.id }),
      }),
    );
    const hasNext = rows.length > limit;
    const pageRows = hasNext ? rows.slice(0, limit) : rows;
    const items = await Promise.all(
      pageRows.map((row) =>
        withRepositoryErrors(() => repository.getMediaAggregate(row.id)).then(mediaAsset),
      ),
    );
    const last = pageRows.at(-1);
    return {
      items,
      nextCursor:
        hasNext && last !== undefined
          ? encodeCursor({
              kind: "media",
              version: CURSOR_VERSION,
              updatedAt: last.updatedAt,
              id: last.id,
            })
          : null,
    };
  };

  const updateMediaAlt = async (
    mediaId: string,
    request: UpdateMediaRequest,
  ): Promise<MediaAsset> => {
    const updated = await withRepositoryErrors(() =>
      repository.updateMediaAlt({
        mediaId,
        altText: request.altText,
        expectedVersion: request.expectedVersion,
        updatedAt: now(),
      }),
    );
    return withRepositoryErrors(() => repository.getMediaAggregate(updated.id)).then(mediaAsset);
  };

  const trashMedia = async (mediaId: string, request: DeleteMediaRequest): Promise<MediaAsset> => {
    const updated = await withRepositoryErrors(() =>
      repository.trashMedia({
        mediaId,
        expectedVersion: request.expectedVersion,
        updatedAt: now(),
      }),
    );
    return withRepositoryErrors(() => repository.getMediaAggregate(updated.id)).then(mediaAsset);
  };

  const getMediaOriginal = (mediaId: string): Promise<MediaOriginalDescriptor> =>
    withRepositoryErrors(async () => {
      const aggregate = await repository.getMediaAggregate(mediaId);
      const media = aggregate.media as unknown as Record<string, unknown>;
      if (!isRecord(media)) throw invalidStoredMedia();
      const state = mediaState(media.state);
      if (state !== "ready") {
        throw new ApplicationError(ApplicationErrorCode.NOT_FOUND, "Resource not found");
      }
      return {
        key: requiredString(media.r2Key),
        filename: requiredString(media.filename),
        mediaType: requiredString(media.mediaType),
      };
    });

  return {
    createMedia,
    getMedia,
    listMedia,
    updateMediaAlt,
    trashMedia,
    getMediaOriginal,
  };
}
