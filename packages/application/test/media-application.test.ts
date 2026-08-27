import type { MediaAggregate, MediaRepository } from "@tinycms/database";
import { RepositoryError, RepositoryErrorCode } from "@tinycms/database";
import { describe, expect, it } from "vitest";
import { createMediaApplication } from "../src";

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

function aggregateFor(id: string, updatedAt: number, state: "ready" | "pending" = "ready") {
  return {
    media: {
      id,
      r2Key: `media/originals/${id}/hash`,
      filename: `${id}.jpg`,
      mediaType: "image/jpeg",
      byteSize: 4,
      width: 800,
      height: 600,
      altText: "alt",
      contentHash: "hash",
      state,
      createdBy: "0192f5a4-7b3c-7d1e-8f20-123456789abd",
      createdAt: 1_700_000_000_000,
      updatedAt,
      version: 1,
    },
    variants: [
      {
        mediaId: id,
        name: "w480.webp",
        format: "webp",
        r2Key: `media/derivatives/${id}/w480.webp`,
        byteSize: 2,
        width: 480,
        height: 360,
        createdAt: updatedAt,
      },
    ],
  } as unknown as MediaAggregate;
}

describe("media application", () => {
  it("validates and hashes the upload before invoking any write collaborator", async () => {
    const events: string[] = [];
    const application = createMediaApplication({
      repository: {
        createMediaWithAuthor: async () => {
          events.push("repository");
          throw new Error("unexpected write");
        },
      } as never,
      inspector: async () => {
        events.push("inspector");
        throw new Error("invalid image");
      },
      originalStore: {
        put: async () => {
          events.push("original-put");
        },
        delete: async () => {
          events.push("original-delete");
        },
      },
      transformer: async () => {
        events.push("transform");
        return new Uint8Array([1]);
      },
      derivativeStore: {
        put: async () => {
          events.push("derivative-put");
        },
        delete: async () => {
          events.push("derivative-delete");
        },
      },
    });

    await expect(
      application.createMedia(
        { filename: "photo.jpg", mediaType: "image/jpeg", bytes: jpeg },
        { subject: "access-subject" },
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(events).toEqual(["inspector"]);
  });

  it("writes immutable originals and every non-enlarging AVIF/WebP variant before finalizing", async () => {
    const mediaId = "0192f5a4-7b3c-7d1e-8f20-123456789abc";
    const authorId = "0192f5a4-7b3c-7d1e-8f20-123456789abd";
    const events: string[] = [];
    const originalPuts: Array<{ key: string; bytes: Uint8Array; options: unknown }> = [];
    const derivativePuts: Array<{ key: string; bytes: Uint8Array; options: unknown }> = [];
    const transforms: Array<Record<string, unknown>> = [];
    let pending: Record<string, unknown> | undefined;
    let finalized: Record<string, unknown> | undefined;
    const repository = {
      createMediaWithAuthor: async (
        input: Parameters<MediaRepository["createMediaWithAuthor"]>[0],
      ) => {
        events.push("create");
        pending = {
          ...input.media,
          state: "pending",
          version: 1,
          createdBy: input.author.id,
        };
        return {
          author: { ...input.author, email: input.author.email ?? null, avatarUrl: null },
          media: pending,
        } as never;
      },
      finalizeMedia: async (input: Parameters<MediaRepository["finalizeMedia"]>[0]) => {
        events.push("finalize");
        finalized = {
          ...(pending as Record<string, unknown>),
          state: "ready",
          version: 2,
          updatedAt: input.updatedAt,
        };
        return {
          media: finalized,
          variants: input.variants.map((variant) => ({
            ...variant,
            mediaId,
          })),
        } as never;
      },
    } as unknown as MediaRepository;
    const application = createMediaApplication({
      repository,
      inspector: async () => ({
        format: "image/jpeg",
        fileSize: jpeg.byteLength,
        width: 1200,
        height: 800,
      }),
      originalStore: {
        put: async (key, bytes, options) => {
          events.push(`original:${key}`);
          originalPuts.push({ key, bytes, options });
        },
        delete: async () => {},
      },
      transformer: async (input) => {
        events.push(`transform:${input.width}:${input.format}`);
        transforms.push(input);
        return new Uint8Array([input.format === "avif" ? 1 : 2, input.width]);
      },
      derivativeStore: {
        put: async (key, bytes, options) => {
          events.push(`derivative:${key}`);
          derivativePuts.push({ key, bytes, options });
        },
        delete: async () => {},
      },
      now: () => 1_700_000_000_000,
      uuidv7: (() => {
        const values = [mediaId, authorId];
        return () => values.shift() as string;
      })(),
    });

    const result = await application.createMedia(
      { filename: "photo.jpg", mediaType: "image/jpeg", bytes: jpeg, altText: "A photo" },
      { subject: "access-subject", displayName: "Author" },
    );

    expect(events[0]).toBe("create");
    expect(events.at(-1)).toBe("finalize");
    expect(pending).toMatchObject({
      id: mediaId,
      r2Key: `media/originals/${mediaId}/32461d5bd1773012acef0ba15636752949bd7c2ce50f9172159d9f56cf0dd9af`,
      filename: "photo.jpg",
      state: "pending",
      createdBy: authorId,
    });
    expect(originalPuts).toEqual([
      {
        key: `media/originals/${mediaId}/32461d5bd1773012acef0ba15636752949bd7c2ce50f9172159d9f56cf0dd9af`,
        bytes: jpeg,
        options: { contentType: "image/jpeg", cacheControl: "private, no-store" },
      },
    ]);
    expect(
      transforms.map(({ width, height, format, withoutEnlargement }) => ({
        width,
        height,
        format,
        withoutEnlargement,
      })),
    ).toEqual([
      { width: 480, height: 320, format: "avif", withoutEnlargement: true },
      { width: 480, height: 320, format: "webp", withoutEnlargement: true },
      { width: 960, height: 640, format: "avif", withoutEnlargement: true },
      { width: 960, height: 640, format: "webp", withoutEnlargement: true },
    ]);
    expect(derivativePuts.map(({ key, options }) => ({ key, options }))).toEqual([
      {
        key: `media/derivatives/${mediaId}/w480.avif`,
        options: { contentType: "image/avif", cacheControl: "public, max-age=31536000, immutable" },
      },
      {
        key: `media/derivatives/${mediaId}/w480.webp`,
        options: { contentType: "image/webp", cacheControl: "public, max-age=31536000, immutable" },
      },
      {
        key: `media/derivatives/${mediaId}/w960.avif`,
        options: { contentType: "image/avif", cacheControl: "public, max-age=31536000, immutable" },
      },
      {
        key: `media/derivatives/${mediaId}/w960.webp`,
        options: { contentType: "image/webp", cacheControl: "public, max-age=31536000, immutable" },
      },
    ]);
    expect(result).toEqual({
      id: mediaId,
      filename: "photo.jpg",
      mediaType: "image/jpeg",
      byteSize: 4,
      width: 1200,
      height: 800,
      altText: "A photo",
      contentHash: "32461d5bd1773012acef0ba15636752949bd7c2ce50f9172159d9f56cf0dd9af",
      state: "ready",
      version: 2,
      variants: [
        {
          name: "w480.avif",
          width: 480,
          height: 320,
          format: "avif",
          byteSize: 2,
          url: `/media/${mediaId}/w480.avif`,
        },
        {
          name: "w480.webp",
          width: 480,
          height: 320,
          format: "webp",
          byteSize: 2,
          url: `/media/${mediaId}/w480.webp`,
        },
        {
          name: "w960.avif",
          width: 960,
          height: 640,
          format: "avif",
          byteSize: 2,
          url: `/media/${mediaId}/w960.avif`,
        },
        {
          name: "w960.webp",
          width: 960,
          height: 640,
          format: "webp",
          byteSize: 2,
          url: `/media/${mediaId}/w960.webp`,
        },
      ],
      createdBy: authorId,
      createdAt: "2023-11-14T22:13:20.000Z",
      updatedAt: "2023-11-14T22:13:20.000Z",
    });
  });

  it("cleans up only request-owned objects and marks pending media failed on derivative errors", async () => {
    const mediaId = "0192f5a4-7b3c-7d1e-8f20-123456789abe";
    const authorId = "0192f5a4-7b3c-7d1e-8f20-123456789abf";
    const originalKey = `media/originals/${mediaId}/32461d5bd1773012acef0ba15636752949bd7c2ce50f9172159d9f56cf0dd9af`;
    const deletedOriginals: string[] = [];
    const deletedDerivatives: string[] = [];
    let failedInput: unknown;
    let pending: Record<string, unknown> | undefined;
    const repository = {
      createMediaWithAuthor: async (
        input: Parameters<MediaRepository["createMediaWithAuthor"]>[0],
      ) => {
        pending = {
          ...input.media,
          state: "pending",
          version: 1,
          createdBy: input.author.id,
        };
        return {
          author: { ...input.author, email: null, avatarUrl: null },
          media: pending,
        } as never;
      },
      markMediaFailed: async (input: Parameters<MediaRepository["markMediaFailed"]>[0]) => {
        failedInput = input;
        return { ...(pending as Record<string, unknown>), state: "failed", version: 2 } as never;
      },
      finalizeMedia: async () => {
        throw new Error("finalization must not run");
      },
    } as unknown as MediaRepository;
    const application = createMediaApplication({
      repository,
      inspector: async () => ({
        format: "image/jpeg",
        fileSize: jpeg.byteLength,
        width: 800,
        height: 600,
      }),
      originalStore: {
        put: async () => {},
        delete: async (key) => {
          deletedOriginals.push(key);
        },
      },
      transformer: async (input) => {
        if (input.format === "webp") throw new Error("encoder provider detail");
        return new Uint8Array([1]);
      },
      derivativeStore: {
        put: async () => {},
        delete: async (key) => {
          deletedDerivatives.push(key);
        },
      },
      now: () => 1_700_000_000_000,
      uuidv7: (() => {
        const values = [mediaId, authorId];
        return () => values.shift() as string;
      })(),
    });

    let error: unknown;
    try {
      await application.createMedia(
        { filename: "photo.jpg", mediaType: "image/jpeg", bytes: jpeg },
        { subject: "access-subject" },
      );
    } catch (reason) {
      error = reason;
    }

    expect(error).toMatchObject({ code: "MEDIA_WRITE_FAILED", message: "Media write failed" });
    expect((error as { details?: unknown }).details).toBeUndefined();
    expect((error as { cause?: unknown }).cause).toBeUndefined();
    expect(deletedOriginals).toEqual([originalKey]);
    expect(deletedDerivatives).toEqual([`media/derivatives/${mediaId}/w480.avif`]);
    expect(failedInput).toEqual({ mediaId, expectedVersion: 1, updatedAt: 1_700_000_000_000 });
  });

  it("maps ready assets, paginates selected aggregates, and hides originals until ready", async () => {
    const ids = [
      "0192f5a4-7b3c-7d1e-8f20-123456789ac1",
      "0192f5a4-7b3c-7d1e-8f20-123456789ac2",
      "0192f5a4-7b3c-7d1e-8f20-123456789ac3",
    ] as const;
    const aggregates = new Map<string, MediaAggregate>(
      ids.map((id, index) => [id, aggregateFor(id, 1_700_000_000_000 - index)]),
    );
    const listInputs: Array<Parameters<MediaRepository["listMedia"]>[0]> = [];
    const aggregateReads: string[] = [];
    const repository = {
      listMedia: async (input: Parameters<MediaRepository["listMedia"]>[0]) => {
        listInputs.push(input);
        return listInputs.length === 1
          ? ids.map((id) => aggregates.get(id)?.media)
          : [aggregates.get(ids[2])?.media];
      },
      getMediaAggregate: async (id: string) => {
        aggregateReads.push(id);
        const aggregate = aggregates.get(id);
        if (aggregate === undefined) throw new Error("missing fixture");
        return aggregate;
      },
    } as unknown as MediaRepository;
    const application = createMediaApplication({
      repository,
      inspector: async () => ({ format: "image/jpeg", fileSize: 4, width: 800, height: 600 }),
      originalStore: { put: async () => {}, delete: async () => {} },
      transformer: async () => new Uint8Array([1]),
      derivativeStore: { put: async () => {}, delete: async () => {} },
    });

    const firstPage = await application.listMedia({ limit: 2 });
    expect(firstPage.items.map(({ id }) => id)).toEqual(ids.slice(0, 2));
    expect(firstPage.items[0]?.variants[0]).toEqual({
      name: "w480.webp",
      width: 480,
      height: 360,
      format: "webp",
      byteSize: 2,
      url: `/media/${ids[0]}/w480.webp`,
    });
    expect(aggregateReads).toEqual(ids.slice(0, 2));
    expect(listInputs[0]).toEqual({ limit: 2 });
    expect(firstPage.nextCursor).toBeTypeOf("string");

    const firstCursor = firstPage.nextCursor;
    if (firstCursor === null) throw new Error("pagination cursor is missing");
    const secondPage = await application.listMedia({ limit: 2, cursor: firstCursor });
    expect(secondPage.items.map(({ id }) => id)).toEqual([ids[2]]);
    expect(listInputs[1]).toEqual({ limit: 2, afterUpdatedAt: 1_699_999_999_999, afterId: ids[1] });

    await expect(application.getMediaOriginal(ids[0])).resolves.toEqual({
      key: `media/originals/${ids[0]}/hash`,
      filename: `${ids[0]}.jpg`,
      mediaType: "image/jpeg",
    });
    aggregates.set(ids[0], aggregateFor(ids[0], 1_700_000_000_000, "pending"));
    await expect(application.getMediaOriginal(ids[0])).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("maps repository not-found and conflict errors for optimistic media mutations", async () => {
    const mediaId = "0192f5a4-7b3c-7d1e-8f20-123456789ac4";
    const aggregate = aggregateFor(mediaId, 1_700_000_000_000);
    const repository = {
      updateMediaAlt: async () => {
        throw new RepositoryError(RepositoryErrorCode.CONFLICT, "database detail");
      },
      trashMedia: async () => {
        throw new RepositoryError(RepositoryErrorCode.NOT_FOUND, "database detail");
      },
      getMediaAggregate: async () => aggregate,
    } as unknown as MediaRepository;
    const application = createMediaApplication({
      repository,
      inspector: async () => ({ format: "image/jpeg", fileSize: 4, width: 800, height: 600 }),
      originalStore: { put: async () => {}, delete: async () => {} },
      transformer: async () => new Uint8Array([1]),
      derivativeStore: { put: async () => {}, delete: async () => {} },
    });

    await expect(
      application.updateMediaAlt(mediaId, { expectedVersion: 1, altText: "next" }),
    ).rejects.toEqual(expect.objectContaining({ code: "CONFLICT", message: "Resource conflict" }));
    await expect(application.trashMedia(mediaId, { expectedVersion: 1 })).rejects.toEqual(
      expect.objectContaining({ code: "NOT_FOUND", message: "Resource not found" }),
    );
  });

  it("rejects malformed required stored media metadata without exposing storage details", async () => {
    const mediaId = "0192f5a4-7b3c-7d1e-8f20-123456789ac5";
    const malformed = aggregateFor(mediaId, 1_700_000_000_000);
    (malformed.media as unknown as { width: number | null }).width = null;
    const repository = {
      getMediaAggregate: async () => malformed,
    } as unknown as MediaRepository;
    const application = createMediaApplication({
      repository,
      inspector: async () => ({ format: "image/jpeg", fileSize: 4, width: 800, height: 600 }),
      originalStore: { put: async () => {}, delete: async () => {} },
      transformer: async () => new Uint8Array([1]),
      derivativeStore: { put: async () => {}, delete: async () => {} },
    });

    await expect(application.getMedia(mediaId)).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      message: "Stored media metadata is invalid",
    });
  });
});
