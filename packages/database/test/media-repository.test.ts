import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  type CreateMediaWithAuthorInput,
  createMediaRepository,
  RepositoryErrorCode,
} from "../src";

const inputFor = (suffix: string, updatedAt = 1_700_000_000_000): CreateMediaWithAuthorInput => ({
  author: {
    id: `018f0e5d-6a25-7b01-8f4a-7d62a5d3${suffix}01`,
    accessSubject: `subject-media-${suffix}`,
    displayName: "Ada Lovelace",
    createdAt: updatedAt,
    updatedAt,
  },
  media: {
    id: `018f0e5d-6a25-7b01-8f4a-7d62a5d3${suffix}02`,
    r2Key: `media/originals/${suffix}/original`,
    filename: "photo.jpg",
    mediaType: "image/jpeg",
    byteSize: 12,
    width: 640,
    height: 480,
    altText: "A sample photo",
    contentHash: `hash-${suffix}`,
    createdAt: updatedAt,
    updatedAt,
  },
});

describe("media repository", () => {
  it("atomically creates a pending media asset with its author and reads its aggregate", async () => {
    const repository = createMediaRepository(env.TEST_DB);
    const input = inputFor("a1");

    const created = await repository.createMediaWithAuthor(input);

    expect(created.author).toMatchObject({
      id: input.author.id,
      accessSubject: input.author.accessSubject,
      displayName: input.author.displayName,
    });
    expect(created.media).toMatchObject({
      id: input.media.id,
      r2Key: input.media.r2Key,
      filename: input.media.filename,
      mediaType: input.media.mediaType,
      byteSize: input.media.byteSize,
      width: input.media.width,
      height: input.media.height,
      altText: input.media.altText,
      contentHash: input.media.contentHash,
      state: "pending",
      version: 1,
      createdBy: input.author.id,
    });

    await expect(repository.getMediaAggregate(input.media.id)).resolves.toEqual({
      media: created.media,
      variants: [],
    });
  });

  it("reports a missing media aggregate with a stable not-found error", async () => {
    const repository = createMediaRepository(env.TEST_DB);

    await expect(
      repository.getMediaAggregate("018f0e5d-6a25-7b01-8f4a-7d62a5d4"),
    ).rejects.toMatchObject({ code: RepositoryErrorCode.NOT_FOUND });
  });

  it("records derivatives atomically and returns variants in stable order", async () => {
    const repository = createMediaRepository(env.TEST_DB);
    const input = inputFor("a2", 1_700_000_000_010);
    await repository.createMediaWithAuthor(input);

    const aggregate = await repository.finalizeMedia({
      mediaId: input.media.id,
      expectedVersion: 1,
      updatedAt: 1_700_000_000_011,
      variants: [
        {
          name: "small",
          format: "avif",
          r2Key: "media/derivatives/a2/small.avif",
          byteSize: 6,
          width: 320,
          height: 240,
          createdAt: 1_700_000_000_011,
        },
        {
          name: "large",
          format: "webp",
          r2Key: "media/derivatives/a2/large.webp",
          byteSize: 10,
          width: 960,
          height: 720,
          createdAt: 1_700_000_000_011,
        },
      ],
    });

    expect(aggregate.media).toMatchObject({ state: "ready", version: 2 });
    expect(aggregate.variants.map(({ name, format, r2Key }) => ({ name, format, r2Key }))).toEqual([
      { name: "large", format: "webp", r2Key: "media/derivatives/a2/large.webp" },
      { name: "small", format: "avif", r2Key: "media/derivatives/a2/small.avif" },
    ]);
    await expect(repository.getMediaAggregate(input.media.id)).resolves.toEqual(aggregate);
  });

  it("rolls back a new author when the pending media insert fails", async () => {
    const repository = createMediaRepository(env.TEST_DB);
    const existing = inputFor("a4", 1_700_000_000_030);
    await repository.createMediaWithAuthor(existing);
    const input = inputFor("a3", 1_700_000_000_020);
    input.media.r2Key = existing.media.r2Key;

    await expect(repository.createMediaWithAuthor(input)).rejects.toMatchObject({
      code: RepositoryErrorCode.WRITE_FAILED,
    });
    await expect(repository.getMediaAggregate(input.media.id)).rejects.toMatchObject({
      code: RepositoryErrorCode.NOT_FOUND,
    });
    await expect(
      env.TEST_DB.prepare("SELECT id FROM authors WHERE id = ?").bind(input.author.id).first(),
    ).resolves.toBeNull();
  });

  it("lists media in descending updated-at/id order with one lookahead row", async () => {
    const repository = createMediaRepository(env.TEST_DB);
    const first = inputFor("a5", 9_700_000_000_040);
    const second = inputFor("a6", 9_700_000_000_040);
    const third = inputFor("a7", 9_700_000_000_039);
    await repository.createMediaWithAuthor(first);
    await repository.createMediaWithAuthor(second);
    await repository.createMediaWithAuthor(third);

    const firstPage = await repository.listMedia({ limit: 2 });
    expect(firstPage.map(({ id }) => id)).toEqual([
      second.media.id,
      first.media.id,
      third.media.id,
    ]);
    const cursor = firstPage[1];
    expect(cursor).toBeDefined();
    if (cursor === undefined) throw new Error("pagination cursor is missing");

    const nextPage = await repository.listMedia({
      limit: 2,
      afterUpdatedAt: cursor.updatedAt,
      afterId: cursor.id,
    });
    expect(nextPage).toHaveLength(3);
    expect(nextPage[0]?.id).toBe(third.media.id);
    expect(nextPage[0]?.updatedAt).toBe(third.media.updatedAt);
  });

  it("updates alt text and trashes media with optimistic versions", async () => {
    const repository = createMediaRepository(env.TEST_DB);
    const input = inputFor("a8", 1_700_000_000_050);
    input.media.filename = "photo'); DROP TABLE media; --.jpg";
    await repository.createMediaWithAuthor(input);

    const updated = await repository.updateMediaAlt({
      mediaId: input.media.id,
      expectedVersion: 1,
      altText: "alt'); UPDATE media SET state = 'ready'; --",
      updatedAt: 1_700_000_000_051,
    });
    expect(updated).toMatchObject({
      id: input.media.id,
      filename: input.media.filename,
      altText: "alt'); UPDATE media SET state = 'ready'; --",
      state: "pending",
      version: 2,
    });

    await expect(
      repository.updateMediaAlt({
        mediaId: input.media.id,
        expectedVersion: 1,
        altText: "stale",
        updatedAt: 1_700_000_000_052,
      }),
    ).rejects.toMatchObject({ code: RepositoryErrorCode.CONFLICT });

    const trashed = await repository.trashMedia({
      mediaId: input.media.id,
      expectedVersion: 2,
      updatedAt: 1_700_000_000_053,
    });
    expect(trashed).toMatchObject({ state: "trash", version: 3 });

    await expect(
      repository.trashMedia({
        mediaId: input.media.id,
        expectedVersion: 2,
        updatedAt: 1_700_000_000_054,
      }),
    ).rejects.toMatchObject({ code: RepositoryErrorCode.CONFLICT });

    await expect(
      repository.trashMedia({
        mediaId: input.media.id,
        expectedVersion: 3,
        updatedAt: 1_700_000_000_055,
      }),
    ).rejects.toMatchObject({ code: RepositoryErrorCode.CONFLICT });

    await expect(
      repository.updateMediaAlt({
        mediaId: input.media.id,
        expectedVersion: 3,
        altText: "must remain unchanged",
        updatedAt: 1_700_000_000_056,
      }),
    ).rejects.toMatchObject({ code: RepositoryErrorCode.CONFLICT });

    await expect(
      repository.updateMediaAlt({
        mediaId: "018f0e5d-6a25-7b01-8f4a-7d62a5d3a899",
        expectedVersion: 1,
        altText: "missing",
        updatedAt: 1_700_000_000_057,
      }),
    ).rejects.toMatchObject({ code: RepositoryErrorCode.NOT_FOUND });
  });

  it("rolls back every derivative when finalization cannot record one variant", async () => {
    const repository = createMediaRepository(env.TEST_DB);
    const input = inputFor("a9", 1_700_000_000_060);
    await repository.createMediaWithAuthor(input);

    await expect(
      repository.finalizeMedia({
        mediaId: input.media.id,
        expectedVersion: 1,
        updatedAt: 1_700_000_000_061,
        variants: [
          {
            name: "small",
            format: "webp",
            r2Key: "media/derivatives/a9/small.webp",
            byteSize: 6,
            width: 320,
            height: 240,
            createdAt: 1_700_000_000_061,
          },
          {
            name: "large",
            format: "jpeg",
            r2Key: "media/derivatives/a9/large.jpeg",
            byteSize: 10,
            width: 960,
            height: 720,
            createdAt: 1_700_000_000_061,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: RepositoryErrorCode.WRITE_FAILED });

    await expect(repository.getMediaAggregate(input.media.id)).resolves.toMatchObject({
      media: { state: "pending", version: 1 },
      variants: [],
    });
  });

  it("marks pending media as failed and rejects stale finalization", async () => {
    const repository = createMediaRepository(env.TEST_DB);
    const input = inputFor("aa", 1_700_000_000_070);
    await repository.createMediaWithAuthor(input);

    const failed = await repository.markMediaFailed({
      mediaId: input.media.id,
      expectedVersion: 1,
      updatedAt: 1_700_000_000_071,
    });
    expect(failed).toMatchObject({ state: "failed", version: 2 });

    await expect(
      repository.markMediaFailed({
        mediaId: input.media.id,
        expectedVersion: 1,
        updatedAt: 1_700_000_000_072,
      }),
    ).rejects.toMatchObject({ code: RepositoryErrorCode.CONFLICT });
  });
});
