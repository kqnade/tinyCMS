import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createEditorialRepository } from "../src/repository";

const emptyDocument = JSON.stringify({ type: "doc", content: [] });

describe("editorial API repository", () => {
  it("reuses an author by Access subject while creating a post atomically", async () => {
    const repository = createEditorialRepository(env.TEST_DB);
    const first = await repository.createPostWithAuthor({
      author: {
        id: "0192f5a4-7b3c-7d1e-8f20-000000000001",
        accessSubject: "access-subject-reuse",
        displayName: "First name",
        email: "first@example.test",
        createdAt: 1_700_000_020_000,
        updatedAt: 1_700_000_020_000,
      },
      post: {
        id: "0192f5a4-7b3c-7d1e-8f20-000000000002",
        slug: "author-reuse-first",
        createdAt: 1_700_000_020_001,
        updatedAt: 1_700_000_020_001,
      },
      revision: {
        id: "0192f5a4-7b3c-7d1e-8f20-000000000003",
        version: 1,
        title: "First",
        contentVersion: 1,
        contentJson: emptyDocument,
        createdAt: 1_700_000_020_002,
      },
    });

    const second = await repository.createPostWithAuthor({
      author: {
        id: "0192f5a4-7b3c-7d1e-8f20-000000000004",
        accessSubject: "access-subject-reuse",
        displayName: "Updated name",
        email: "updated@example.test",
        createdAt: 1_700_000_020_003,
        updatedAt: 1_700_000_020_003,
      },
      post: {
        id: "0192f5a4-7b3c-7d1e-8f20-000000000005",
        slug: "author-reuse-second",
        createdAt: 1_700_000_020_004,
        updatedAt: 1_700_000_020_004,
      },
      revision: {
        id: "0192f5a4-7b3c-7d1e-8f20-000000000006",
        version: 1,
        title: "Second",
        contentVersion: 1,
        contentJson: emptyDocument,
        createdAt: 1_700_000_020_005,
      },
    });

    expect(second.author.id).toBe(first.author.id);
    expect(second.author.displayName).toBe("Updated name");
    expect(second.post.createdBy).toBe(first.author.id);
    expect(second.revision.authorId).toBe(first.author.id);
    await expect(
      repository.getAuthorByAccessSubject("access-subject-reuse"),
    ).resolves.toMatchObject({
      id: first.author.id,
    });
    await expect(repository.getLatestRevisionVersion(first.post.id)).resolves.toBe(1);
    await expect(repository.getAuthor(second.author.id)).resolves.toMatchObject({
      accessSubject: "access-subject-reuse",
      email: "updated@example.test",
    });
  });

  it("lists posts and revisions by bounded descending cursors", async () => {
    const repository = createEditorialRepository(env.TEST_DB);
    for (const [suffix, timestamp] of [
      ["a", 1_700_000_021_001],
      ["b", 1_700_000_021_002],
      ["c", 1_700_000_021_003],
      ["d", 1_700_000_021_000],
    ] as const) {
      const numericSuffix = { a: "1", b: "2", c: "3", d: "4" }[suffix];
      await repository.createPostWithAuthor({
        author: {
          id: `0192f5a4-7b3c-7d1e-8f20-00000000001${numericSuffix}`,
          accessSubject: `access-subject-list-${suffix}`,
          displayName: `List ${suffix}`,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        post: {
          id: `0192f5a4-7b3c-7d1e-8f20-00000000002${numericSuffix}`,
          slug: `list-${suffix}`,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        revision: {
          id: `0192f5a4-7b3c-7d1e-8f20-00000000003${numericSuffix}`,
          version: 1,
          title: `List ${suffix}`,
          contentVersion: 1,
          contentJson: emptyDocument,
          createdAt: timestamp,
        },
      });
    }

    const firstPage = await repository.listPosts({ limit: 2 });
    expect(firstPage.map((post) => post.slug)).toEqual(["list-c", "list-b"]);
    const lastPost = firstPage.at(-1);
    if (lastPost === undefined) {
      throw new Error("Expected a first page");
    }
    const secondPage = await repository.listPosts({
      limit: 2,
      afterUpdatedAt: lastPost.updatedAt,
      afterId: lastPost.id,
    });
    expect(secondPage.map((post) => post.slug)).toEqual(["list-a", "list-d"]);

    const revisions = await repository.listRevisions({
      postId: "0192f5a4-7b3c-7d1e-8f20-000000000023",
      limit: 10,
    });
    expect(revisions.map((revision) => revision.version)).toEqual([1]);
  });
});
