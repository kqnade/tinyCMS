import type { Author, CreateAuthorInput, RepositoryErrorCodeValue } from "./repository";
import { RepositoryError, RepositoryErrorCode } from "./repository";
import type { media, mediaVariants } from "./schema";

export type Media = typeof media.$inferSelect;
export type MediaVariant = typeof mediaVariants.$inferSelect;

export interface MediaAggregate {
  media: Media;
  variants: MediaVariant[];
}

export interface CreateMediaInput {
  id: string;
  r2Key: string;
  filename: string;
  mediaType: string;
  byteSize: number;
  width: number;
  height: number;
  altText: string;
  contentHash: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateMediaWithAuthorInput {
  author: CreateAuthorInput;
  media: CreateMediaInput;
}

export interface CreatedMediaWithAuthor {
  author: Author;
  media: Media;
}

export interface CreateMediaVariantInput {
  name: string;
  format: string;
  r2Key: string;
  byteSize: number;
  width: number;
  height: number;
  createdAt: number;
}

export interface MediaListInput {
  limit: number;
  afterUpdatedAt?: number;
  afterId?: string;
}

export interface FinalizeMediaInput {
  mediaId: string;
  variants: CreateMediaVariantInput[];
  updatedAt: number;
  expectedVersion: number;
}

export interface MarkMediaFailedInput {
  mediaId: string;
  updatedAt: number;
  expectedVersion: number;
}

export interface UpdateMediaAltInput {
  mediaId: string;
  altText: string;
  expectedVersion: number;
  updatedAt: number;
}

export interface TrashMediaInput {
  mediaId: string;
  expectedVersion: number;
  updatedAt: number;
}

export interface MediaRepository {
  createMediaWithAuthor(input: CreateMediaWithAuthorInput): Promise<CreatedMediaWithAuthor>;
  getMediaAggregate(id: string): Promise<MediaAggregate>;
  listMedia(input: MediaListInput): Promise<Media[]>;
  finalizeMedia(input: FinalizeMediaInput): Promise<MediaAggregate>;
  markMediaFailed(input: MarkMediaFailedInput): Promise<Media>;
  updateMediaAlt(input: UpdateMediaAltInput): Promise<Media>;
  trashMedia(input: TrashMediaInput): Promise<Media>;
}

const authorColumns = `
  id, access_subject AS "accessSubject", display_name AS "displayName",
  email, avatar_url AS "avatarUrl", created_at AS "createdAt",
  updated_at AS "updatedAt"`;

const mediaColumns = `
  id, r2_key AS "r2Key", filename, media_type AS "mediaType", byte_size AS "byteSize",
  width, height, alt_text AS "altText", content_hash AS "contentHash", state,
  created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt", version`;

const mediaVariantColumns = `
  media_id AS "mediaId", name, format, r2_key AS "r2Key", byte_size AS "byteSize",
  width, height, created_at AS "createdAt"`;

const asRepositoryError = (
  code: RepositoryErrorCodeValue,
  message: string,
  cause?: unknown,
): RepositoryError => new RepositoryError(code, message, cause);

const missingMedia = (): RepositoryError =>
  asRepositoryError(RepositoryErrorCode.NOT_FOUND, "media was not found");

const compareVariants = (left: MediaVariant, right: MediaVariant): number => {
  if (left.name !== right.name) {
    return left.name < right.name ? -1 : 1;
  }
  if (left.format !== right.format) {
    return left.format < right.format ? -1 : 1;
  }
  return 0;
};

export function createMediaRepository(database: D1Database): MediaRepository {
  const readMediaState = async (
    mediaId: string,
  ): Promise<{ state: string; version: number } | null> => {
    const row = await database
      .prepare("SELECT state, version FROM media WHERE id = ? LIMIT 1")
      .bind(mediaId)
      .first<{ state: string; version: number }>();
    return row;
  };

  const conflictOrMissing = async (mediaId: string, message: string): Promise<never> => {
    const current = await readMediaState(mediaId);
    if (current === null) {
      throw missingMedia();
    }
    throw asRepositoryError(RepositoryErrorCode.CONFLICT, message);
  };

  const createMediaWithAuthor = async (
    input: CreateMediaWithAuthorInput,
  ): Promise<CreatedMediaWithAuthor> => {
    const { author, media: mediaInput } = input;
    try {
      const [authorResult, mediaResult] = await database.batch([
        database
          .prepare(
            `INSERT INTO authors (
               id, access_subject, display_name, email, avatar_url, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(access_subject) DO UPDATE SET
               display_name = excluded.display_name,
               email = COALESCE(excluded.email, authors.email),
               avatar_url = COALESCE(excluded.avatar_url, authors.avatar_url),
               updated_at = excluded.updated_at
             RETURNING ${authorColumns}`,
          )
          .bind(
            author.id,
            author.accessSubject,
            author.displayName,
            author.email ?? null,
            author.avatarUrl ?? null,
            author.createdAt,
            author.updatedAt,
          ),
        database
          .prepare(
            `INSERT INTO media (
               id, r2_key, filename, media_type, byte_size, width, height, alt_text,
               content_hash, state, created_by, created_at, updated_at
             )
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', id, ?, ?
             FROM authors
             WHERE access_subject = ?
             RETURNING ${mediaColumns}`,
          )
          .bind(
            mediaInput.id,
            mediaInput.r2Key,
            mediaInput.filename,
            mediaInput.mediaType,
            mediaInput.byteSize,
            mediaInput.width,
            mediaInput.height,
            mediaInput.altText,
            mediaInput.contentHash,
            mediaInput.createdAt,
            mediaInput.updatedAt,
            author.accessSubject,
          ),
      ]);
      const authorRow = authorResult?.results[0] as Author | undefined;
      const mediaRow = mediaResult?.results[0] as Media | undefined;
      if (authorRow !== undefined && mediaRow !== undefined) {
        return { author: authorRow, media: mediaRow };
      }
      throw new Error("Media creation statements returned a partial result");
    } catch (cause) {
      throw asRepositoryError(RepositoryErrorCode.WRITE_FAILED, "Failed to create media", cause);
    }
  };

  const getMediaAggregate = async (id: string): Promise<MediaAggregate> => {
    try {
      const [mediaResult, variantsResult] = await database.batch([
        database.prepare(`SELECT ${mediaColumns} FROM media WHERE id = ? LIMIT 1`).bind(id),
        database
          .prepare(
            `SELECT ${mediaVariantColumns}
             FROM media_variants
             WHERE media_id = ?
             ORDER BY name ASC, format ASC`,
          )
          .bind(id),
      ]);
      const mediaRow = mediaResult?.results[0] as Media | undefined;
      if (mediaRow === undefined) {
        throw missingMedia();
      }
      return {
        media: mediaRow,
        variants: (variantsResult?.results ?? []) as MediaVariant[],
      };
    } catch (cause) {
      if (cause instanceof RepositoryError) {
        throw cause;
      }
      throw asRepositoryError(RepositoryErrorCode.READ_FAILED, "Failed to read media", cause);
    }
  };

  const listMedia = async ({
    limit,
    afterUpdatedAt,
    afterId,
  }: MediaListInput): Promise<Media[]> => {
    try {
      const pageSize = Math.max(0, Math.floor(limit)) + 1;
      const result =
        afterUpdatedAt !== undefined && afterId !== undefined
          ? await database
              .prepare(
                `SELECT ${mediaColumns}
                 FROM media
                 WHERE updated_at < ? OR (updated_at = ? AND id < ?)
                 ORDER BY updated_at DESC, id DESC
                 LIMIT ?`,
              )
              .bind(afterUpdatedAt, afterUpdatedAt, afterId, pageSize)
              .all<Media>()
          : await database
              .prepare(
                `SELECT ${mediaColumns}
                 FROM media
                 ORDER BY updated_at DESC, id DESC
                 LIMIT ?`,
              )
              .bind(pageSize)
              .all<Media>();
      return result.results;
    } catch (cause) {
      throw asRepositoryError(RepositoryErrorCode.READ_FAILED, "Failed to list media", cause);
    }
  };

  const finalizeMedia = async (input: FinalizeMediaInput): Promise<MediaAggregate> => {
    const variantStatements = input.variants.map((variant) => {
      return database
        .prepare(
          `INSERT INTO media_variants (
             media_id, name, format, r2_key, byte_size, width, height, created_at
           )
           SELECT ?, ?, ?, ?, ?, ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM media
             WHERE id = ? AND state = 'pending' AND version = ?
           )
           RETURNING ${mediaVariantColumns}`,
        )
        .bind(
          input.mediaId,
          variant.name,
          variant.format,
          variant.r2Key,
          variant.byteSize,
          variant.width,
          variant.height,
          variant.createdAt,
          input.mediaId,
          input.expectedVersion,
        );
    });

    try {
      const results = await database.batch([
        ...variantStatements,
        database
          .prepare(
            `UPDATE media
             SET state = 'ready', updated_at = ?, version = version + 1
             WHERE id = ? AND state = 'pending' AND version = ?
             RETURNING ${mediaColumns}`,
          )
          .bind(input.updatedAt, input.mediaId, input.expectedVersion),
      ]);
      const mediaResult = results[results.length - 1];
      const mediaRow = mediaResult?.results[0] as Media | undefined;
      if (mediaRow === undefined) {
        return await conflictOrMissing(
          input.mediaId,
          "Media finalization conflicted with a newer version",
        );
      }
      const variants = results
        .slice(0, -1)
        .flatMap((result) => result?.results ?? []) as MediaVariant[];
      variants.sort(compareVariants);
      return { media: mediaRow, variants };
    } catch (cause) {
      if (cause instanceof RepositoryError) {
        throw cause;
      }
      throw asRepositoryError(RepositoryErrorCode.WRITE_FAILED, "Failed to finalize media", cause);
    }
  };

  const markMediaFailed = async (input: MarkMediaFailedInput): Promise<Media> => {
    try {
      const result = await database
        .prepare(
          `UPDATE media
           SET state = 'failed', updated_at = ?, version = version + 1
           WHERE id = ? AND state = 'pending' AND version = ?
           RETURNING ${mediaColumns}`,
        )
        .bind(input.updatedAt, input.mediaId, input.expectedVersion)
        .all<Media>();
      const row = result.results[0];
      if (row !== undefined) {
        return row;
      }
      return await conflictOrMissing(input.mediaId, "Media failure marking conflicted");
    } catch (cause) {
      if (cause instanceof RepositoryError) {
        throw cause;
      }
      throw asRepositoryError(
        RepositoryErrorCode.WRITE_FAILED,
        "Failed to mark media as failed",
        cause,
      );
    }
  };

  const updateMediaAlt = async (input: UpdateMediaAltInput): Promise<Media> => {
    try {
      const result = await database
        .prepare(
          `UPDATE media
           SET alt_text = ?, updated_at = ?, version = version + 1
           WHERE id = ? AND version = ? AND state IN ('ready', 'failed')
           RETURNING ${mediaColumns}`,
        )
        .bind(input.altText, input.updatedAt, input.mediaId, input.expectedVersion)
        .all<Media>();
      const row = result.results[0];
      if (row !== undefined) {
        return row;
      }
      return await conflictOrMissing(
        input.mediaId,
        "Media alt text update conflicted with a newer version",
      );
    } catch (cause) {
      if (cause instanceof RepositoryError) {
        throw cause;
      }
      throw asRepositoryError(
        RepositoryErrorCode.WRITE_FAILED,
        "Failed to update media alt text",
        cause,
      );
    }
  };

  const trashMedia = async (input: TrashMediaInput): Promise<Media> => {
    try {
      const result = await database
        .prepare(
          `UPDATE media
           SET state = 'trash', updated_at = ?, version = version + 1
           WHERE id = ? AND version = ? AND state IN ('ready', 'failed')
           RETURNING ${mediaColumns}`,
        )
        .bind(input.updatedAt, input.mediaId, input.expectedVersion)
        .all<Media>();
      const row = result.results[0];
      if (row !== undefined) {
        return row;
      }
      return await conflictOrMissing(
        input.mediaId,
        "Media trash transition conflicted with a newer version",
      );
    } catch (cause) {
      if (cause instanceof RepositoryError) {
        throw cause;
      }
      throw asRepositoryError(RepositoryErrorCode.WRITE_FAILED, "Failed to trash media", cause);
    }
  };

  return {
    createMediaWithAuthor,
    getMediaAggregate,
    listMedia,
    finalizeMedia,
    markMediaFailed,
    updateMediaAlt,
    trashMedia,
  };
}
