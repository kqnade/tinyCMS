import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { authors, postRevisions, posts, schema } from "./schema";

export type Author = typeof authors.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type PostRevision = typeof postRevisions.$inferSelect;

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

  const getPostAggregate = async (id: string): Promise<PostAggregate> => {
    const post = await getPost(id);
    let revisions: PostRevision[];
    try {
      revisions = await db
        .select()
        .from(postRevisions)
        .where(eq(postRevisions.postId, post.id))
        .orderBy(asc(postRevisions.version));
    } catch (error) {
      throw new RepositoryError(
        RepositoryErrorCode.READ_FAILED,
        "Failed to read post revisions",
        error,
      );
    }
    return { post, revisions };
  };

  const createAuthorPostRevision = async (
    input: CreateAuthorPostRevisionInput,
  ): Promise<CreatedAuthorPostRevision> => {
    const { author, post, revision } = input;
    try {
      await database.batch([
        database
          .prepare(
            "INSERT INTO authors (id, access_subject, display_name, email, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
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
            "INSERT INTO posts (id, slug, status, active_published_revision_id, scheduled_at, canonical_url, noindex, created_by, created_at, updated_at) VALUES (?, ?, 'draft', NULL, ?, ?, ?, ?, ?, ?)",
          )
          .bind(
            post.id,
            post.slug,
            post.scheduledAt ?? null,
            post.canonicalUrl ?? null,
            post.noindex ?? 0,
            author.id,
            post.createdAt,
            post.updatedAt,
          ),
        database
          .prepare(
            "INSERT INTO post_revisions (id, post_id, version, title, content_version, content_json, excerpt, metadata_json, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(
            revision.id,
            post.id,
            revision.version,
            revision.title,
            revision.contentVersion,
            revision.contentJson,
            revision.excerpt ?? null,
            revision.metadataJson ?? "{}",
            author.id,
            revision.createdAt,
          ),
      ]);
    } catch (cause) {
      throw new RepositoryError(
        RepositoryErrorCode.WRITE_FAILED,
        "Failed to create author, post, and revision",
        cause,
      );
    }

    return {
      author: await getAuthor(author.id),
      post: await getPost(post.id),
      revision: await getRevision(revision.id),
    };
  };

  return {
    createAuthorPostRevision,
    getAuthor,
    getPost,
    getPostBySlug,
    getRevision,
    getPostAggregate,
  };
}
