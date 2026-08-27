import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const authorId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3f101";
const mediaId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3f102";

describe("media D1 migration", () => {
  it("defaults media versions and enforces media variant ownership", async () => {
    await env.TEST_DB.prepare(
      "INSERT INTO authors (id, access_subject, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(authorId, "subject-media-migration", "Ada", 1_700_000_000_000, 1_700_000_000_000)
      .run();

    await env.TEST_DB.prepare(
      "INSERT INTO media (id, r2_key, filename, media_type, byte_size, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        mediaId,
        "media/originals/f101/original",
        "photo.jpg",
        "image/jpeg",
        12,
        authorId,
        1_700_000_000_000,
        1_700_000_000_000,
      )
      .run();

    await expect(
      env.TEST_DB.prepare("SELECT version, state FROM media WHERE id = ?")
        .bind(mediaId)
        .first<{ version: number; state: string }>(),
    ).resolves.toEqual({ version: 1, state: "pending" });

    await expect(
      env.TEST_DB.prepare("UPDATE media SET version = ? WHERE id = ?").bind(0, mediaId).run(),
    ).rejects.toThrow();

    await env.TEST_DB.prepare(
      "INSERT INTO media_variants (media_id, name, format, r2_key, byte_size, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        mediaId,
        "thumbnail",
        "webp",
        "media/derivatives/f102/thumbnail",
        8,
        120,
        80,
        1_700_000_000_001,
      )
      .run();

    await expect(
      env.TEST_DB.prepare(
        "INSERT INTO media_variants (media_id, name, format, r2_key, byte_size, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(
          "018f0e5d-6a25-7b01-8f4a-7d62a5d3f199",
          "thumbnail",
          "avif",
          "media/derivatives/f199/thumbnail",
          8,
          120,
          80,
          1_700_000_000_001,
        )
        .run(),
    ).rejects.toThrow();

    await expect(
      env.TEST_DB.prepare(
        "INSERT INTO media_variants (media_id, name, format, r2_key, byte_size, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(
          mediaId,
          "zero-width",
          "webp",
          "media/derivatives/f104/zero-width",
          8,
          0,
          80,
          1_700_000_000_001,
        )
        .run(),
    ).rejects.toThrow();

    await expect(
      env.TEST_DB.prepare(
        "INSERT INTO media_variants (media_id, name, format, r2_key, byte_size, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(
          mediaId,
          "thumbnail",
          "webp",
          "media/derivatives/f103/thumbnail",
          8,
          120,
          80,
          1_700_000_000_001,
        )
        .run(),
    ).rejects.toThrow();

    await expect(
      env.TEST_DB.prepare(
        "INSERT INTO media_variants (media_id, name, format, r2_key, byte_size, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(
          mediaId,
          "zero-height",
          "webp",
          "media/derivatives/f105/zero-height",
          8,
          120,
          0,
          1_700_000_000_001,
        )
        .run(),
    ).rejects.toThrow();
  });
});
