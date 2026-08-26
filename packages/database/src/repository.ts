import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { authors, postDrafts, postRevisions, posts, schema, type searchChunks } from "./schema";

export const MAX_SEARCH_QUERY_LENGTH = 256;

export type Author = typeof authors.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type PostRevision = typeof postRevisions.$inferSelect;
export type PostDraft = typeof postDrafts.$inferSelect;
export type SearchChunk = typeof searchChunks.$inferSelect;

export const RepositoryErrorCode = {
  CONFLICT: "CONFLICT",
  NOT_FOUND: "NOT_FOUND",
  READ_FAILED: "READ_FAILED",
  WRITE_FAILED: "WRITE_FAILED",
} as const;

export type RepositoryErrorCodeValue =
  (typeof RepositoryErrorCode)[keyof typeof RepositoryErrorCode];

export class RepositoryError extends Error {
  readonly code: RepositoryErrorCodeValue;

  constructor(code: RepositoryErrorCodeValue, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "RepositoryError";
    this.code = code;
  }
}

export interface CreateAuthorInput {
  id: string;
  accessSubject: string;
  displayName: string;
  email?: string | null;
  avatarUrl?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreatePostInput {
  id: string;
  slug: string;
  scheduledAt?: number | null;
  canonicalUrl?: string | null;
  noindex?: 0 | 1;
  createdAt: number;
  updatedAt: number;
}

export interface CreateRevisionInput {
  id: string;
  version: number;
  title: string;
  contentVersion: number;
  contentJson: string;
  excerpt?: string | null;
  metadataJson?: string;
  createdAt: number;
}

export interface SaveDraftInput {
  postId: string;
  expectedDraftVersion: number;
  authorId: string;
  title: string;
  contentVersion: number;
  contentJson: string;
  excerpt?: string | null;
  metadataJson?: string;
  updatedAt: number;
}

export interface CheckpointDraftInput {
  postId: string;
  expectedDraftVersion: number;
  expectedRevisionVersion: number;
  revisionId: string;
  authorId: string;
  createdAt: number;
}

export interface AppendRevisionInput {
  postId: string;
  authorId: string;
  expectedVersion: number;
  revision: Omit<CreateRevisionInput, "version">;
}

export interface RestoreRevisionInput {
  postId: string;
  sourceRevisionId: string;
  expectedVersion: number;
  revisionId: string;
  authorId: string;
  createdAt: number;
}

export interface RestoreDraftInput {
  postId: string;
  sourceRevisionId: string;
  expectedDraftVersion: number;
  expectedRevisionVersion: number;
  revisionId: string;
  authorId: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateAuthorPostRevisionInput {
  author: CreateAuthorInput;
  post: CreatePostInput;
  revision: CreateRevisionInput;
}

export interface CreatedAuthorPostRevision {
  author: Author;
  post: Post;
  revision: PostRevision;
}

export interface RestoredDraft {
  draft: PostDraft;
  revision: PostRevision;
}

export interface PostAggregate {
  post: Post;
  revisions: PostRevision[];
}

export interface EditorialRepository {
  createAuthorPostRevision(
    input: CreateAuthorPostRevisionInput,
  ): Promise<CreatedAuthorPostRevision>;
  appendRevision(input: AppendRevisionInput): Promise<PostRevision>;
  restoreRevision(input: RestoreRevisionInput): Promise<PostRevision>;
  restoreDraft(input: RestoreDraftInput): Promise<RestoredDraft>;
  saveDraft(input: SaveDraftInput): Promise<PostDraft>;
  checkpointDraft(input: CheckpointDraftInput): Promise<PostRevision>;
  getAuthor(id: string): Promise<Author>;
  getPost(id: string): Promise<Post>;
  getPostBySlug(slug: string): Promise<Post>;
  getRevision(id: string): Promise<PostRevision>;
  getDraft(postId: string): Promise<PostDraft>;
  getPostAggregate(id: string): Promise<PostAggregate>;
  purgePost(id: string): Promise<void>;
  searchChunks(query: string): Promise<SearchChunk[]>;
}

const readOne = async <T>(query: PromiseLike<T[]>, resource: string): Promise<T> => {
  try {
    const rows = await query;
    const row = rows[0];
    if (row === undefined) {
      throw new RepositoryError(RepositoryErrorCode.NOT_FOUND, `${resource} was not found`);
    }
    return row;
  } catch (error) {
    if (error instanceof RepositoryError) {
      throw error;
    }
    throw new RepositoryError(RepositoryErrorCode.READ_FAILED, `Failed to read ${resource}`, error);
  }
};

export function createEditorialRepository(database: D1Database): EditorialRepository {
  const db = drizzle(database, { schema });

  const getAuthor = (id: string): Promise<Author> =>
    readOne(db.select().from(authors).where(eq(authors.id, id)).limit(1), "author");

  const getPost = (id: string): Promise<Post> =>
    readOne(db.select().from(posts).where(eq(posts.id, id)).limit(1), "post");

  const getPostBySlug = (slug: string): Promise<Post> =>
    readOne(db.select().from(posts).where(eq(posts.slug, slug)).limit(1), "post");

  const getRevision = (id: string): Promise<PostRevision> =>
    readOne(
      db.select().from(postRevisions).where(eq(postRevisions.id, id)).limit(1),
      "post revision",
    );

  const getDraft = (postId: string): Promise<PostDraft> =>
    readOne(
      db.select().from(postDrafts).where(eq(postDrafts.postId, postId)).limit(1),
      "post draft",
    );

  const saveDraft = async ({
    postId,
    expectedDraftVersion,
    authorId,
    title,
    contentVersion,
    contentJson,
    excerpt,
    metadataJson,
    updatedAt,
  }: SaveDraftInput): Promise<PostDraft> => {
    try {
      const [postResult, draftResult] = await database.batch([
        database
          .prepare(
            `UPDATE posts
             SET updated_at = ?
             WHERE id = ?
               AND EXISTS (
                 SELECT 1
                 FROM post_drafts
                 WHERE post_drafts.post_id = posts.id
                   AND post_drafts.version = ?
               )`,
          )
          .bind(updatedAt, postId, expectedDraftVersion),
        database
          .prepare(
            `UPDATE post_drafts
             SET title = ?, content_version = ?, content_json = ?, excerpt = ?,
               metadata_json = ?, author_id = ?, updated_at = ?, version = version + 1
             WHERE post_id = ? AND version = ?
             RETURNING post_id AS "postId", version, title,
               content_version AS "contentVersion", content_json AS "contentJson",
               excerpt, metadata_json AS "metadataJson", author_id AS "authorId",
               updated_at AS "updatedAt"`,
          )
          .bind(
            title,
            contentVersion,
            contentJson,
            excerpt ?? null,
            metadataJson ?? "{}",
            authorId,
            updatedAt,
            postId,
            expectedDraftVersion,
          ),
      ]);
      const savedDraft = draftResult?.results[0] as PostDraft | undefined;
      const postUpdated = postResult?.meta.changes === 1;
      const draftUpdated = draftResult?.meta.changes === 1;
      if (postUpdated && draftUpdated && savedDraft !== undefined) {
        return savedDraft;
      }
      if (postUpdated || draftUpdated || savedDraft !== undefined) {
        throw new Error("Draft save statements returned a partial result");
      }

      const draft = await database
        .prepare('SELECT post_id AS "postId" FROM post_drafts WHERE post_id = ?')
        .bind(postId)
        .first<{ postId: string }>();
      if (draft === null) {
        throw new RepositoryError(RepositoryErrorCode.NOT_FOUND, "post draft was not found");
      }
      throw new RepositoryError(
        RepositoryErrorCode.CONFLICT,
        "Draft save conflicted with a newer version",
      );
    } catch (cause) {
      if (cause instanceof RepositoryError) {
        throw cause;
      }
      throw new RepositoryError(
        RepositoryErrorCode.WRITE_FAILED,
        "Failed to save post draft",
        cause,
      );
    }
  };

  const checkpointDraft = async ({
    postId,
    expectedDraftVersion,
    expectedRevisionVersion,
    revisionId,
    authorId,
    createdAt,
  }: CheckpointDraftInput): Promise<PostRevision> => {
    try {
      const [postResult, revisionResult] = await database.batch([
        database
          .prepare(
            `UPDATE posts
             SET updated_at = ?
             WHERE id = ?
               AND EXISTS (
                 SELECT 1
                 FROM post_drafts AS draft
                 JOIN (
                   SELECT post_id, MAX(version) AS version
                   FROM post_revisions
                   WHERE post_id = ?
                   GROUP BY post_id
                 ) AS current ON current.post_id = draft.post_id
                 WHERE draft.post_id = posts.id
                   AND draft.version = ?
                   AND current.version = ?
               )`,
          )
          .bind(createdAt, postId, postId, expectedDraftVersion, expectedRevisionVersion),
        database
          .prepare(
            `INSERT INTO post_revisions (
               id, post_id, version, title, content_version, content_json,
               excerpt, metadata_json, author_id, created_at
             )
             SELECT ?, draft.post_id, current.version + 1, draft.title,
               draft.content_version, draft.content_json, draft.excerpt,
               draft.metadata_json, ?, ?
             FROM post_drafts AS draft
             JOIN (
               SELECT post_id, MAX(version) AS version
               FROM post_revisions
               WHERE post_id = ?
               GROUP BY post_id
             ) AS current ON current.post_id = draft.post_id
             WHERE draft.post_id = ?
               AND draft.version = ?
               AND current.version = ?
             RETURNING id, post_id AS "postId", version, title,
               content_version AS "contentVersion", content_json AS "contentJson",
               excerpt, metadata_json AS "metadataJson", author_id AS "authorId",
               created_at AS "createdAt"`,
          )
          .bind(
            revisionId,
            authorId,
            createdAt,
            postId,
            postId,
            expectedDraftVersion,
            expectedRevisionVersion,
          ),
      ]);
      const checkpoint = revisionResult?.results[0] as PostRevision | undefined;
      const postUpdated = postResult?.meta.changes === 1;
      const revisionInserted = revisionResult?.meta.changes === 1;
      if (postUpdated && revisionInserted && checkpoint !== undefined) {
        return checkpoint;
      }
      if (postUpdated || revisionInserted || checkpoint !== undefined) {
        throw new Error("Draft checkpoint statements returned a partial result");
      }

      const draft = await database
        .prepare('SELECT post_id AS "postId" FROM post_drafts WHERE post_id = ?')
        .bind(postId)
        .first<{ postId: string }>();
      if (draft === null) {
        throw new RepositoryError(RepositoryErrorCode.NOT_FOUND, "post draft was not found");
      }
      throw new RepositoryError(
        RepositoryErrorCode.CONFLICT,
        "Draft checkpoint conflicted with a newer version",
      );
    } catch (cause) {
      if (cause instanceof RepositoryError) {
        throw cause;
      }
      throw new RepositoryError(
        RepositoryErrorCode.WRITE_FAILED,
        "Failed to checkpoint post draft",
        cause,
      );
    }
  };

  const searchChunksByQuery = async (query: string): Promise<SearchChunk[]> => {
    const normalized = query.trim();
    if (normalized === "") {
      return [];
    }
    if ([...normalized].length > MAX_SEARCH_QUERY_LENGTH) {
      throw new RepositoryError(
        RepositoryErrorCode.READ_FAILED,
        `Search query exceeds ${MAX_SEARCH_QUERY_LENGTH} characters`,
      );
    }

    try {
      if ([...normalized].length >= 3) {
        const matchQuery = `"${normalized.replaceAll('"', '""')}"`;
        const result = await database
          .prepare(
            'SELECT search_chunks.id, search_chunks.post_id AS "postId", search_chunks.revision_id AS "revisionId", search_chunks.chunk_index AS "chunkIndex", search_chunks.title, search_chunks.heading, search_chunks.body, search_chunks.tags, search_chunks.created_at AS "createdAt" FROM search_chunks JOIN search_chunks_fts ON search_chunks_fts.rowid = search_chunks.rowid WHERE search_chunks_fts MATCH ? ORDER BY search_chunks_fts.rank LIMIT 20',
          )
          .bind(matchQuery)
          .all<SearchChunk>();
        return result.results;
      }

      const likeQuery = normalized
        .replaceAll("\\", "\\\\")
        .replaceAll("%", "\\%")
        .replaceAll("_", "\\_");
      const result = await database
        .prepare(
          `SELECT id, post_id AS "postId", revision_id AS "revisionId", chunk_index AS "chunkIndex", title, heading, body, tags, created_at AS "createdAt" FROM search_chunks WHERE title LIKE '%' || ? || '%' ESCAPE '\\' OR heading LIKE '%' || ? || '%' ESCAPE '\\' OR body LIKE '%' || ? || '%' ESCAPE '\\' OR tags LIKE '%' || ? || '%' ESCAPE '\\' ORDER BY rowid LIMIT 20`,
        )
        .bind(likeQuery, likeQuery, likeQuery, likeQuery)
        .all<SearchChunk>();
      return result.results;
    } catch (cause) {
      throw new RepositoryError(RepositoryErrorCode.READ_FAILED, "Failed to search chunks", cause);
    }
  };

  const getPostAggregate = async (id: string): Promise<PostAggregate> => {
    try {
      const [postRows, revisions] = await db.batch([
        db.select().from(posts).where(eq(posts.id, id)).limit(1),
        db
          .select()
          .from(postRevisions)
          .where(eq(postRevisions.postId, id))
          .orderBy(asc(postRevisions.version)),
      ]);
      const post = postRows[0];
      if (post === undefined) {
        throw new RepositoryError(RepositoryErrorCode.NOT_FOUND, "post was not found");
      }
      return { post, revisions };
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError(
        RepositoryErrorCode.READ_FAILED,
        "Failed to read post revisions",
        error,
      );
    }
  };

  const purgePost = async (id: string): Promise<void> => {
    try {
      const results = await database.batch([
        database
          .prepare("UPDATE posts SET active_published_revision_id = NULL WHERE id = ?")
          .bind(id),
        database.prepare("DELETE FROM publication_jobs WHERE post_id = ?").bind(id),
        database.prepare("DELETE FROM posts WHERE id = ?").bind(id),
      ]);
      if (results[2]?.meta.changes === 0) {
        throw new RepositoryError(RepositoryErrorCode.NOT_FOUND, "post was not found");
      }
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError(RepositoryErrorCode.WRITE_FAILED, "Failed to purge post", error);
    }
  };

  const createAuthorPostRevision = async (
    input: CreateAuthorPostRevisionInput,
  ): Promise<CreatedAuthorPostRevision> => {
    const { author, post, revision } = input;
    try {
      const [createdAuthors, createdPosts, createdRevisions, createdDrafts] = await db.batch([
        db
          .insert(authors)
          .values({
            id: author.id,
            accessSubject: author.accessSubject,
            displayName: author.displayName,
            email: author.email ?? null,
            avatarUrl: author.avatarUrl ?? null,
            createdAt: author.createdAt,
            updatedAt: author.updatedAt,
          })
          .returning(),
        db
          .insert(posts)
          .values({
            id: post.id,
            slug: post.slug,
            status: "draft",
            activePublishedRevisionId: null,
            scheduledAt: post.scheduledAt ?? null,
            canonicalUrl: post.canonicalUrl ?? null,
            noindex: post.noindex ?? 0,
            createdBy: author.id,
            createdAt: post.createdAt,
            updatedAt: post.updatedAt,
          })
          .returning(),
        db
          .insert(postRevisions)
          .values({
            id: revision.id,
            postId: post.id,
            version: revision.version,
            title: revision.title,
            contentVersion: revision.contentVersion,
            contentJson: revision.contentJson,
            excerpt: revision.excerpt ?? null,
            metadataJson: revision.metadataJson ?? "{}",
            authorId: author.id,
            createdAt: revision.createdAt,
          })
          .returning(),
        db
          .insert(postDrafts)
          .values({
            postId: post.id,
            version: 1,
            title: revision.title,
            contentVersion: revision.contentVersion,
            contentJson: revision.contentJson,
            excerpt: revision.excerpt ?? null,
            metadataJson: revision.metadataJson ?? "{}",
            authorId: author.id,
            updatedAt: revision.createdAt,
          })
          .returning(),
      ]);
      const createdAuthor = createdAuthors[0];
      const createdPost = createdPosts[0];
      const createdRevision = createdRevisions[0];
      if (
        createdAuthor === undefined ||
        createdPost === undefined ||
        createdRevision === undefined ||
        createdDrafts[0] === undefined
      ) {
        throw new Error("Create statements returned no rows");
      }
      return {
        author: createdAuthor,
        post: createdPost,
        revision: createdRevision,
      };
    } catch (cause) {
      throw new RepositoryError(
        RepositoryErrorCode.WRITE_FAILED,
        "Failed to create author, post, and revision",
        cause,
      );
    }
  };

  const appendRevision = async ({
    postId,
    authorId,
    expectedVersion,
    revision,
  }: AppendRevisionInput): Promise<PostRevision> => {
    try {
      const result = await database
        .prepare(
          `INSERT INTO post_revisions (
             id, post_id, version, title, content_version, content_json,
             excerpt, metadata_json, author_id, created_at
           )
           SELECT ?, ?, MAX(version) + 1, ?, ?, ?, ?, ?, ?, ?
           FROM post_revisions
           WHERE post_id = ?
           HAVING MAX(version) = ?
           RETURNING id, post_id AS "postId", version, title,
             content_version AS "contentVersion", content_json AS "contentJson",
             excerpt, metadata_json AS "metadataJson", author_id AS "authorId",
             created_at AS "createdAt"`,
        )
        .bind(
          revision.id,
          postId,
          revision.title,
          revision.contentVersion,
          revision.contentJson,
          revision.excerpt ?? null,
          revision.metadataJson ?? "{}",
          authorId,
          revision.createdAt,
          postId,
          expectedVersion,
        )
        .all<PostRevision>();
      const appendedRevision = result.results[0];
      if (appendedRevision === undefined) {
        const post = await database
          .prepare("SELECT id FROM posts WHERE id = ?")
          .bind(postId)
          .first<{ id: string }>();
        if (post === null) {
          throw new RepositoryError(RepositoryErrorCode.NOT_FOUND, "post was not found");
        }
        throw new RepositoryError(
          RepositoryErrorCode.CONFLICT,
          "Revision append conflicted with a newer version",
        );
      }
      return appendedRevision;
    } catch (cause) {
      if (cause instanceof RepositoryError) {
        throw cause;
      }
      throw new RepositoryError(
        RepositoryErrorCode.WRITE_FAILED,
        "Failed to append post revision",
        cause,
      );
    }
  };

  const restoreRevision = async ({
    postId,
    sourceRevisionId,
    expectedVersion,
    revisionId,
    authorId,
    createdAt,
  }: RestoreRevisionInput): Promise<PostRevision> => {
    try {
      const result = await database
        .prepare(
          `INSERT INTO post_revisions (
             id, post_id, version, title, content_version, content_json,
             excerpt, metadata_json, author_id, created_at
           )
           SELECT ?, source.post_id, current.version + 1, source.title,
             source.content_version, source.content_json, source.excerpt,
             source.metadata_json, ?, ?
           FROM post_revisions AS source
           JOIN (
             SELECT post_id, MAX(version) AS version
             FROM post_revisions
             WHERE post_id = ?
             GROUP BY post_id
           ) AS current ON current.post_id = source.post_id
           WHERE source.id = ?
             AND source.post_id = ?
             AND current.version = ?
           RETURNING id, post_id AS "postId", version, title,
             content_version AS "contentVersion", content_json AS "contentJson",
             excerpt, metadata_json AS "metadataJson", author_id AS "authorId",
             created_at AS "createdAt"`,
        )
        .bind(revisionId, authorId, createdAt, postId, sourceRevisionId, postId, expectedVersion)
        .all<PostRevision>();
      const restoredRevision = result.results[0];
      if (restoredRevision !== undefined) {
        return restoredRevision;
      }

      const post = await database
        .prepare("SELECT id FROM posts WHERE id = ?")
        .bind(postId)
        .first<{ id: string }>();
      if (post === null) {
        throw new RepositoryError(RepositoryErrorCode.NOT_FOUND, "post was not found");
      }

      const source = await database
        .prepare("SELECT id FROM post_revisions WHERE id = ? AND post_id = ?")
        .bind(sourceRevisionId, postId)
        .first<{ id: string }>();
      if (source === null) {
        throw new RepositoryError(RepositoryErrorCode.NOT_FOUND, "post revision was not found");
      }

      throw new RepositoryError(
        RepositoryErrorCode.CONFLICT,
        "Revision restore conflicted with a newer version",
      );
    } catch (cause) {
      if (cause instanceof RepositoryError) {
        throw cause;
      }
      throw new RepositoryError(
        RepositoryErrorCode.WRITE_FAILED,
        "Failed to restore post revision",
        cause,
      );
    }
  };

  const restoreDraft = async ({
    postId,
    sourceRevisionId,
    expectedDraftVersion,
    expectedRevisionVersion,
    revisionId,
    authorId,
    createdAt,
    updatedAt,
  }: RestoreDraftInput): Promise<RestoredDraft> => {
    try {
      const [postResult, revisionResult, draftResult] = await database.batch([
        database
          .prepare(
            `UPDATE posts
             SET updated_at = ?
             WHERE id = ?
               AND EXISTS (
                 SELECT 1
                 FROM post_revisions AS source
                 JOIN post_drafts AS draft ON draft.post_id = source.post_id
                 JOIN (
                   SELECT post_id, MAX(version) AS version
                   FROM post_revisions
                   WHERE post_id = ?
                   GROUP BY post_id
                 ) AS current ON current.post_id = source.post_id
                 WHERE source.post_id = posts.id
                   AND source.id = ?
                   AND source.post_id = ?
                   AND draft.version = ?
                   AND current.version = ?
               )`,
          )
          .bind(
            updatedAt,
            postId,
            postId,
            sourceRevisionId,
            postId,
            expectedDraftVersion,
            expectedRevisionVersion,
          ),
        database
          .prepare(
            `INSERT INTO post_revisions (
               id, post_id, version, title, content_version, content_json,
               excerpt, metadata_json, author_id, created_at
             )
             SELECT ?, source.post_id, current.version + 1, source.title,
               source.content_version, source.content_json, source.excerpt,
               source.metadata_json, ?, ?
             FROM post_revisions AS source
             JOIN posts AS post ON post.id = source.post_id
             JOIN post_drafts AS draft ON draft.post_id = source.post_id
             JOIN (
               SELECT post_id, MAX(version) AS version
               FROM post_revisions
               WHERE post_id = ?
               GROUP BY post_id
             ) AS current ON current.post_id = source.post_id
             WHERE post.id = ?
               AND source.id = ?
               AND source.post_id = ?
               AND draft.version = ?
               AND current.version = ?
             RETURNING id, post_id AS "postId", version, title,
               content_version AS "contentVersion", content_json AS "contentJson",
               excerpt, metadata_json AS "metadataJson", author_id AS "authorId",
               created_at AS "createdAt"`,
          )
          .bind(
            revisionId,
            authorId,
            createdAt,
            postId,
            postId,
            sourceRevisionId,
            postId,
            expectedDraftVersion,
            expectedRevisionVersion,
          ),
        database
          .prepare(
            `UPDATE post_drafts
             SET title = revision.title,
               content_version = revision.content_version,
               content_json = revision.content_json,
               excerpt = revision.excerpt,
               metadata_json = revision.metadata_json,
               author_id = ?,
               updated_at = ?,
               version = post_drafts.version + 1
             FROM post_revisions AS revision
             WHERE post_drafts.post_id = ?
               AND post_drafts.version = ?
               AND revision.id = ?
               AND revision.post_id = ?
             RETURNING post_drafts.post_id AS "postId", post_drafts.version,
               post_drafts.title,
               post_drafts.content_version AS "contentVersion",
               post_drafts.content_json AS "contentJson",
               post_drafts.excerpt,
               post_drafts.metadata_json AS "metadataJson",
               post_drafts.author_id AS "authorId",
               post_drafts.updated_at AS "updatedAt"`,
          )
          .bind(authorId, updatedAt, postId, expectedDraftVersion, revisionId, postId),
      ]);
      const postUpdated = postResult?.meta.changes === 1;
      const restoredRevision = revisionResult?.results[0] as PostRevision | undefined;
      const restoredDraft = draftResult?.results[0] as PostDraft | undefined;
      const revisionInserted = revisionResult?.meta.changes === 1;
      const draftUpdated = draftResult?.meta.changes === 1;
      if (
        postUpdated &&
        revisionInserted &&
        restoredRevision !== undefined &&
        draftUpdated &&
        restoredDraft !== undefined
      ) {
        return { draft: restoredDraft, revision: restoredRevision };
      }
      if (
        postUpdated ||
        revisionInserted ||
        restoredRevision !== undefined ||
        draftUpdated ||
        restoredDraft !== undefined
      ) {
        throw new Error("Restore statements returned a partial result");
      }

      const post = await database
        .prepare("SELECT id FROM posts WHERE id = ?")
        .bind(postId)
        .first<{ id: string }>();
      if (post === null) {
        throw new RepositoryError(RepositoryErrorCode.NOT_FOUND, "post was not found");
      }

      const draft = await database
        .prepare("SELECT post_id FROM post_drafts WHERE post_id = ?")
        .bind(postId)
        .first<{ post_id: string }>();
      if (draft === null) {
        throw new RepositoryError(RepositoryErrorCode.NOT_FOUND, "post draft was not found");
      }

      const source = await database
        .prepare("SELECT id FROM post_revisions WHERE id = ? AND post_id = ?")
        .bind(sourceRevisionId, postId)
        .first<{ id: string }>();
      if (source === null) {
        throw new RepositoryError(RepositoryErrorCode.NOT_FOUND, "post revision was not found");
      }

      throw new RepositoryError(
        RepositoryErrorCode.CONFLICT,
        "Draft restore conflicted with a newer version",
      );
    } catch (cause) {
      if (cause instanceof RepositoryError) {
        throw cause;
      }
      throw new RepositoryError(
        RepositoryErrorCode.WRITE_FAILED,
        "Failed to restore post draft",
        cause,
      );
    }
  };

  return {
    createAuthorPostRevision,
    appendRevision,
    restoreRevision,
    restoreDraft,
    saveDraft,
    checkpointDraft,
    getAuthor,
    getPost,
    getPostBySlug,
    getRevision,
    getDraft,
    getPostAggregate,
    purgePost,
    searchChunks: searchChunksByQuery,
  };
}
