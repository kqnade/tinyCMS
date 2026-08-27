import { describe, expect, it } from "vitest";
import {
  ADMIN_MEDIA_ITEM_ROUTE,
  ADMIN_MEDIA_ORIGINAL_ROUTE,
  ADMIN_MEDIA_ROUTE,
  MAX_ALT_TEXT_LENGTH,
  type MediaAsset,
  type MediaListQuery,
  type MediaListResponse,
  type MediaResponse,
  type MediaRouteParams,
  type MediaVariant,
  parseDeleteMediaRequest,
  parseMediaListQuery,
  parseMediaRouteParams,
  parseUpdateMediaRequest,
} from "../src/index";

const mediaId = "0192f5a4-7b3c-7d1e-8f20-123456789abc";

describe("media asset contracts", () => {
  it("serializes the fixed asset wire shape and variant records", () => {
    const variant: MediaVariant = {
      name: "w480.avif",
      width: 480,
      height: 320,
      format: "avif",
      byteSize: 12_345,
      url: `/media/${mediaId}/w480.avif`,
    };
    const asset: MediaAsset = {
      id: mediaId,
      filename: "hero.jpg",
      mediaType: "image/jpeg",
      byteSize: 98_765,
      width: 1_200,
      height: 800,
      altText: "A hero image",
      contentHash: "a".repeat(64),
      state: "ready",
      version: 1,
      variants: [variant],
      createdBy: "0192f5a4-7b3c-7d1e-8f20-123456789abd",
      createdAt: "2026-08-26T00:00:00.000Z",
      updatedAt: "2026-08-26T01:00:00.000Z",
    };

    const response: MediaResponse = {
      data: asset,
      meta: { requestId: "media-read" },
    };
    const listResponse: MediaListResponse = {
      data: { items: [asset], nextCursor: "next-media" },
      meta: { requestId: "media-list" },
    };
    const query: MediaListQuery = { cursor: "next-media", limit: 25 };
    const routeParams: MediaRouteParams = { mediaId };

    expect(JSON.stringify(asset)).toBe(
      `{"id":"${mediaId}","filename":"hero.jpg","mediaType":"image/jpeg","byteSize":98765,"width":1200,"height":800,"altText":"A hero image","contentHash":"${"a".repeat(64)}","state":"ready","version":1,"variants":[{"name":"w480.avif","width":480,"height":320,"format":"avif","byteSize":12345,"url":"/media/${mediaId}/w480.avif"}],"createdBy":"0192f5a4-7b3c-7d1e-8f20-123456789abd","createdAt":"2026-08-26T00:00:00.000Z","updatedAt":"2026-08-26T01:00:00.000Z"}`,
    );
    expect({ response, listResponse, query, routeParams }).toMatchObject({
      response: { data: asset },
      listResponse: { data: { items: [asset], nextCursor: "next-media" } },
      query,
      routeParams,
    });
  });

  it("exports collection, item, and original admin route templates", () => {
    expect({
      collection: ADMIN_MEDIA_ROUTE,
      item: ADMIN_MEDIA_ITEM_ROUTE,
      original: ADMIN_MEDIA_ORIGINAL_ROUTE,
    }).toEqual({
      collection: "/api/v1/admin/media",
      item: "/api/v1/admin/media/:mediaId",
      original: "/api/v1/admin/media/:mediaId/original",
    });
  });

  it("parses the media item route parameter with the shared UUIDv7 contract", () => {
    expect(parseMediaRouteParams({ mediaId })).toEqual({
      ok: true,
      value: { mediaId },
    });
  });

  it("parses a media alt-text update with its expected version", () => {
    expect(
      parseUpdateMediaRequest({
        expectedVersion: 3,
        altText: "画像の説明 🙂",
      }),
    ).toEqual({
      ok: true,
      value: { expectedVersion: 3, altText: "画像の説明 🙂" },
    });
  });

  it("normalizes media list pagination with the shared cursor and limit rules", () => {
    expect(parseMediaListQuery({ cursor: "次へ", limit: "25" })).toEqual({
      ok: true,
      value: { cursor: "次へ", limit: 25 },
    });
  });

  it("rejects unknown PATCH keys and enforces code-point and version boundaries", () => {
    const atLimit = "🙂".repeat(MAX_ALT_TEXT_LENGTH);
    expect(
      parseUpdateMediaRequest({
        expectedVersion: Number.MAX_SAFE_INTEGER,
        altText: atLimit,
      }),
    ).toEqual({
      ok: true,
      value: { expectedVersion: Number.MAX_SAFE_INTEGER, altText: atLimit },
    });
    expect(parseUpdateMediaRequest({ expectedVersion: 1, altText: `${atLimit}🙂` })).toMatchObject({
      ok: false,
    });
    expect(parseUpdateMediaRequest({ expectedVersion: 1, altText: "ok", extra: true })).toEqual({
      ok: false,
      issues: [
        {
          path: ["extra"],
          code: "unknown_key",
          message: "Unknown property is not allowed.",
        },
      ],
    });

    for (const expectedVersion of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "1", null]) {
      expect(parseUpdateMediaRequest({ expectedVersion, altText: "ok" })).toMatchObject({
        ok: false,
      });
    }
  });

  it("parses the DELETE body with only a positive expected version", () => {
    expect(parseDeleteMediaRequest({ expectedVersion: 2 })).toEqual({
      ok: true,
      value: { expectedVersion: 2 },
    });
    expect(parseDeleteMediaRequest({ expectedVersion: 2, extra: true })).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ path: ["extra"], code: "unknown_key" }),
      ]),
    });
  });
});
