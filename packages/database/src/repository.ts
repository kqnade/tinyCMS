import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { authors, postRevisions, posts, schema, type searchChunks } from "./schema";

export const MAX_SEARCH_QUERY_LENGTH = 256;

export type Author = typeof authors.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type PostRevision = typeof postRevisions.$inferSelect;
export type SearchChunk = typeof searchChunks.$inferSelect;

export const RepositoryErrorCode = {
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

export interface PostAggregate {
  post: Post;
  revisions: PostRevision[];
}

export interface EditorialRepository {
  createAuthorPostRevision(
    input: CreateAuthorPostRevisionInput,
  ): Promise<CreatedAuthorPostRevision>;
  getAuthor(id: string): Promise<Author>;
  getPost(id: string): Promise<Post>;
  getPostBySlug(slug: string): Promise<Post>;
  getRevision(id: string): Promise<PostRevision>;
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
      const [createdAuthors, createdPosts, createdRevisions] = await db.batch([
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
      ]);
      const createdAuthor = createdAuthors[0];
      const createdPost = createdPosts[0];
      const createdRevision = createdRevisions[0];
      if (
        createdAuthor === undefined ||
        createdPost === undefined ||
        createdRevision === undefined
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

  return {
    createAuthorPostRevision,
    getAuthor,
    getPost,
    getPostBySlug,
    getRevision,
    getPostAggregate,
    purgePost,
    searchChunks: searchChunksByQuery,
  };
}
