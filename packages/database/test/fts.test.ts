import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  createEditorialRepository,
  MAX_SEARCH_QUERY_LENGTH,
  RepositoryErrorCode,
} from "../src/repository";

const authorId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3f101";
const postId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3f102";
const revisionId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3f103";
const chunkId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3f104";

const insertSearchParent = async (authorId: string, postId: string, revisionId: string) => {
  await env.TEST_DB.prepare(
    "INSERT INTO authors (id, access_subject, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(authorId, `subject-${postId}`, "Search Author", 1_700_000_000_100, 1_700_000_000_100)
    .run();
  await env.TEST_DB.prepare(
    "INSERT INTO posts (id, slug, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(postId, `search-${postId}`, authorId, 1_700_000_000_100, 1_700_000_000_100)
    .run();
  await env.TEST_DB.prepare(
    "INSERT INTO post_revisions (id, post_id, version, title, content_version, content_json, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(revisionId, postId, 1, "Search fixture", 1, '{"type":"doc"}', authorId, 1_700_000_000_100)
    .run();
};

const insertSearchChunk = async ({
  id,
  postId,
  revisionId,
  index,
  title,
  heading = "Search fixture",
  body = "",
  tags = "",
}: {
  id: string;
  postId: string;
  revisionId: string;
  index: number;
  title: string;
  heading?: string;
  body?: string;
  tags?: string;
}) => {
  await env.TEST_DB.prepare(
    "INSERT INTO search_chunks (id, post_id, revision_id, chunk_index, title, heading, body, tags, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, postId, revisionId, index, title, heading, body, tags, 1_700_000_000_100 + index)
    .run();
};

describe("search chunk FTS synchronization", () => {
  it("indexes, updates, and removes representative search chunks", async () => {
    await env.TEST_DB.prepare(
      "INSERT INTO authors (id, access_subject, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(authorId, "subject-fts", "Ada", 1_700_000_000_000, 1_700_000_000_000)
      .run();
    await env.TEST_DB.prepare(
      "INSERT INTO posts (id, slug, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(postId, "fts-post", authorId, 1_700_000_000_000, 1_700_000_000_000)
      .run();
    await env.TEST_DB.prepare(
      "INSERT INTO post_revisions (id, post_id, version, title, content_version, content_json, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(revisionId, postId, 1, "FTS", 1, '{"type":"doc"}', authorId, 1_700_000_000_000)
      .run();
    await env.TEST_DB.prepare(
      "INSERT INTO search_chunks (id, post_id, revision_id, chunk_index, title, heading, body, tags, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        chunkId,
        postId,
        revisionId,
        0,
        "Cloudflare",
        "Workers",
        "Cloudflare edge publishing",
        "edge",
        1_700_000_000_000,
      )
      .run();

    const inserted = await env.TEST_DB.prepare(
      "SELECT id FROM search_chunks_fts WHERE search_chunks_fts MATCH ?",
    )
      .bind("Cloudflare")
      .all<{ id: string }>();
    expect(inserted.results.map(({ id }) => id)).toEqual([chunkId]);

    await env.TEST_DB.prepare("UPDATE search_chunks SET body = ?, title = ? WHERE id = ?")
      .bind("SQLite migration testing", "SQLite", chunkId)
      .run();
    const oldTerm = await env.TEST_DB.prepare(
      "SELECT id FROM search_chunks_fts WHERE search_chunks_fts MATCH ?",
    )
      .bind("Cloudflare")
      .all<{ id: string }>();
    const newTerm = await env.TEST_DB.prepare(
      "SELECT id FROM search_chunks_fts WHERE search_chunks_fts MATCH ?",
    )
      .bind("SQLite")
      .all<{ id: string }>();
    expect(oldTerm.results).toHaveLength(0);
    expect(newTerm.results.map(({ id }) => id)).toEqual([chunkId]);

    await env.TEST_DB.prepare("DELETE FROM search_chunks WHERE id = ?").bind(chunkId).run();
    const deleted = await env.TEST_DB.prepare(
      "SELECT id FROM search_chunks_fts WHERE search_chunks_fts MATCH ?",
    )
      .bind("SQLite")
      .all<{ id: string }>();
    expect(deleted.results).toHaveLength(0);
  });

  it("searches Japanese, technical, and identifier terms", async () => {
    const authorId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3f201";
    const postId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3f202";
    const revisionId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3f203";
    const chunkId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3f204";

    await env.TEST_DB.prepare(
      "INSERT INTO authors (id, access_subject, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(authorId, "subject-fts-mixed", "Ada", 1_700_000_000_010, 1_700_000_000_010)
      .run();
    await env.TEST_DB.prepare(
      "INSERT INTO posts (id, slug, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(postId, "fts-mixed", authorId, 1_700_000_000_010, 1_700_000_000_010)
      .run();
    await env.TEST_DB.prepare(
      "INSERT INTO post_revisions (id, post_id, version, title, content_version, content_json, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        revisionId,
        postId,
        1,
        "Mixed language",
        1,
        '{"type":"doc"}',
        authorId,
        1_700_000_000_010,
      )
      .run();
    await env.TEST_DB.prepare(
      "INSERT INTO search_chunks (id, post_id, revision_id, chunk_index, title, heading, body, tags, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        chunkId,
        postId,
        revisionId,
        0,
        "日本語の記事",
        "東京の案内",
        "Cloudflare Workers with D1Database",
        "technical",
        1_700_000_000_010,
      )
      .run();

    const repository = createEditorialRepository(env.TEST_DB);
    const expectedChunk = {
      id: chunkId,
      postId,
      revisionId,
      chunkIndex: 0,
      title: "日本語の記事",
      heading: "東京の案内",
      body: "Cloudflare Workers with D1Database",
      tags: "technical",
      createdAt: 1_700_000_000_010,
    };
    await expect(repository.searchChunks("日本語")).resolves.toEqual([expectedChunk]);
    await expect(repository.searchChunks("東京")).resolves.toEqual([expectedChunk]);
    await expect(repository.searchChunks("D1Database")).resolves.toMatchObject([{ id: chunkId }]);
  });

  it("orders FTS matches by relevance instead of insertion order", async () => {
    const authorId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3f301";
    const postId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3f302";
    const revisionId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3f303";
    const earlierChunkId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3f304";
    const moreRelevantChunkId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3f305";

    await insertSearchParent(authorId, postId, revisionId);
    await insertSearchChunk({
      id: earlierChunkId,
      postId,
      revisionId,
      index: 0,
      title: "Borealis",
    });
    await insertSearchChunk({
      id: moreRelevantChunkId,
      postId,
      revisionId,
      index: 1,
      title: "Borealis Borealis Borealis",
      body: "Borealis Borealis",
    });

    const repository = createEditorialRepository(env.TEST_DB);
    await expect(repository.searchChunks("Borealis")).resolves.toMatchObject([
      { id: moreRelevantChunkId },
      { id: earlierChunkId },
    ]);
  });

  it("limits trigram search results to twenty rows", async () => {
    const authorId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3f401";
    const postId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3f402";
    const revisionId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3f403";

    await insertSearchParent(authorId, postId, revisionId);
    await Promise.all(
      Array.from({ length: 25 }, (_, index) => {
        const suffix = (0x404 + index).toString(16).padStart(4, "0");
        return insertSearchChunk({
          id: `018f0e5d-6a25-7b01-8f4a-7d62a5d3${suffix}`,
          postId,
          revisionId,
          index,
          title: "Aurora",
        });
      }),
    );

    const repository = createEditorialRepository(env.TEST_DB);
    await expect(repository.searchChunks("Aurora")).resolves.toHaveLength(20);
  });

  it("limits short-query fallback results to twenty rows in row order", async () => {
    const authorId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3f501";
    const postId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3f502";
    const revisionId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3f503";
    const matchingChunkIds: string[] = [];

    await insertSearchParent(authorId, postId, revisionId);
    for (let index = 0; index < 25; index += 1) {
      const suffix = (0x504 + index).toString(16).padStart(4, "0");
      const id = `018f0e5d-6a25-7b01-8f4a-7d62a5d3${suffix}`;
      matchingChunkIds.push(id);
      await insertSearchChunk({
        id,
        postId,
        revisionId,
        index,
        title: "Qx",
      });
    }

    const repository = createEditorialRepository(env.TEST_DB);
    const results = await repository.searchChunks("Qx");
    expect(results).toHaveLength(20);
    expect(results.map(({ id }) => id)).toEqual(matchingChunkIds.slice(0, 20));
  });

  it("accepts the maximum query length and rejects longer queries", async () => {
    const repository = createEditorialRepository(env.TEST_DB);
    const maximumQuery = "unlikely-query-term-".repeat(20).slice(0, MAX_SEARCH_QUERY_LENGTH);

    await expect(repository.searchChunks(maximumQuery)).resolves.toEqual([]);
    await expect(repository.searchChunks(`${maximumQuery}x`)).rejects.toMatchObject({
      code: RepositoryErrorCode.READ_FAILED,
    });
  });
});
