import { describe, expect, it } from "vitest";
import { ApplicationErrorCode } from "../src/errors";
import {
  MAX_MEDIA_ALT_TEXT_LENGTH,
  MAX_MEDIA_BYTES,
  MAX_MEDIA_FILENAME_LENGTH,
  verifyMediaUpload,
} from "../src/media-validation";

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

function png(): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1,
    0, 0, 0, 1, 8, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0, 0, 0, 0,
  ]);
}

function webp(): Uint8Array {
  return new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
}

const inspection =
  (format: string, bytes: Uint8Array, width = 800, height = 600) =>
  async () => ({ format, fileSize: bytes.byteLength, width, height });

describe("media upload validation", () => {
  it("verifies JPEG metadata, hashes the bytes, and plans non-enlarging derivatives", async () => {
    const result = await verifyMediaUpload(
      {
        filename: "photo.jpg",
        mediaType: "image/jpeg",
        bytes: jpeg,
        altText: "A photo",
      },
      async () => ({ format: "image/jpeg", fileSize: jpeg.byteLength, width: 1000, height: 500 }),
    );

    expect(result).toEqual({
      filename: "photo.jpg",
      mediaType: "image/jpeg",
      bytes: jpeg,
      byteSize: 4,
      width: 1000,
      height: 500,
      altText: "A photo",
      contentHash: "32461d5bd1773012acef0ba15636752949bd7c2ce50f9172159d9f56cf0dd9af",
      derivativeSizes: [
        { width: 480, height: 240 },
        { width: 960, height: 480 },
      ],
    });
  });

  it("accepts structurally inspected PNG and WebP containers", async () => {
    for (const [mediaType, bytes] of [
      ["image/png", png()],
      ["image/webp", webp()],
    ] as const) {
      const result = await verifyMediaUpload(
        { filename: "image", mediaType, bytes },
        inspection(mediaType, bytes),
      );
      expect(result).toMatchObject({ mediaType, width: 800, height: 600, altText: "" });
    }
  });

  it("rejects unsupported, mismatched, truncated, and trailing-byte containers before inspection", async () => {
    const cases = [
      { mediaType: "image/gif", bytes: new Uint8Array([0x47, 0x49, 0x46, 0x38]) },
      { mediaType: "image/svg+xml", bytes: new TextEncoder().encode("<svg/>") },
      { mediaType: "image/jpeg", bytes: png() },
      { mediaType: "image/jpeg", bytes: new Uint8Array([0xff, 0xd8, 0xff]) },
      { mediaType: "image/jpeg", bytes: new Uint8Array([...jpeg, 0x3c, 0x73, 0x76, 0x67]) },
      { mediaType: "image/png", bytes: png().slice(0, -12) },
      { mediaType: "image/webp", bytes: new Uint8Array([...webp(), 0]) },
    ];
    for (const input of cases) {
      let inspected = false;
      await expect(
        verifyMediaUpload({ filename: "bad", ...input }, async () => {
          inspected = true;
          return { format: input.mediaType, fileSize: input.bytes.byteLength, width: 1, height: 1 };
        }),
      ).rejects.toMatchObject({ code: ApplicationErrorCode.INVALID_REQUEST });
      expect(inspected).toBe(false);
    }
  });

  it("bounds bytes, filename, and alt text by bytes and Unicode code points", async () => {
    const valid = { mediaType: "image/jpeg", bytes: jpeg };
    await expect(
      verifyMediaUpload(
        { ...valid, filename: `${"🙂".repeat(MAX_MEDIA_FILENAME_LENGTH)}x` },
        inspection("image/jpeg", jpeg),
      ),
    ).rejects.toMatchObject({ code: ApplicationErrorCode.INVALID_REQUEST });
    await expect(
      verifyMediaUpload(
        { ...valid, filename: "x", altText: `${"🙂".repeat(MAX_MEDIA_ALT_TEXT_LENGTH)}x` },
        inspection("image/jpeg", jpeg),
      ),
    ).rejects.toMatchObject({ code: ApplicationErrorCode.INVALID_REQUEST });
    await expect(
      verifyMediaUpload(
        { filename: "x", mediaType: "image/jpeg", bytes: new Uint8Array(MAX_MEDIA_BYTES + 1) },
        inspection("image/jpeg", jpeg),
      ),
    ).rejects.toMatchObject({ code: ApplicationErrorCode.INVALID_REQUEST });
    await expect(
      verifyMediaUpload(
        { filename: "x", mediaType: "image/jpeg", bytes: new Uint8Array() },
        inspection("image/jpeg", jpeg),
      ),
    ).rejects.toMatchObject({ code: ApplicationErrorCode.INVALID_REQUEST });
  });

  it("rejects inspector failures, mismatches, and invalid dimensions generically", async () => {
    const invalidInspections = [
      { format: "image/png", fileSize: 4, width: 1, height: 1 },
      { format: "image/jpeg", fileSize: 3, width: 1, height: 1 },
      { format: "image/jpeg", fileSize: 4, width: 0, height: 1 },
      { format: "image/jpeg", fileSize: 4, width: 1, height: 12_001 },
    ];
    for (const result of invalidInspections) {
      await expect(
        verifyMediaUpload(
          { filename: "x", mediaType: "image/jpeg", bytes: jpeg },
          async () => result,
        ),
      ).rejects.toMatchObject({ code: ApplicationErrorCode.INVALID_REQUEST });
    }
    await expect(
      verifyMediaUpload({ filename: "x", mediaType: "image/jpeg", bytes: jpeg }, async () => {
        throw new Error("provider detail");
      }),
    ).rejects.toEqual(expect.objectContaining({ code: ApplicationErrorCode.INVALID_REQUEST }));
  });

  it("generates the original width when the image is narrower than 480", async () => {
    const result = await verifyMediaUpload(
      { filename: "small.jpg", mediaType: "image/jpeg", bytes: jpeg },
      inspection("image/jpeg", jpeg, 320, 181),
    );
    expect(result.derivativeSizes).toEqual([{ width: 320, height: 181 }]);
  });
});
