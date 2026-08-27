import { describe, expect, it, vi } from "vitest";
import {
  createEditorialApi,
  EditorialApiError,
  isEditorialConflict,
  type MediaAsset,
  type MediaAssetState,
  type MediaVariant,
} from "../src/editorial-api";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const post = {
  content: { content: [], type: "doc" },
  contentVersion: 1 as const,
  createdAt: "2026-08-26T00:00:00.000Z" as const,
  createdByAuthorId: "018f0e5d-6a25-7b01-8f4a-7d62a5d3e401",
  currentRevisionVersion: 1,
  draftVersion: 1,
  excerpt: null,
  id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3e402",
  lifecycle: "draft" as const,
  metadata: {},
  slug: "first-post",
  title: "First post",
  updatedAt: "2026-08-26T00:00:00.000Z" as const,
  updatedByAuthorId: "018f0e5d-6a25-7b01-8f4a-7d62a5d3e401",
};

const mediaVariant: MediaVariant = {
  name: "w480.avif",
  width: 480,
  height: 320,
  format: "avif",
  byteSize: 12_345,
  url: "/media/018f0e5d-6a25-7b01-8f4a-7d62a5d3e403/w480.avif",
};

const media: MediaAsset = {
  id: "018f0e5d-6a25-7b01-8f4a-7d62a5d3e403",
  filename: "hero.jpg",
  mediaType: "image/jpeg",
  byteSize: 98_765,
  width: 1_200,
  height: 800,
  altText: "A hero image",
  contentHash: "a".repeat(64),
  state: "ready" satisfies MediaAssetState,
  version: 1,
  variants: [mediaVariant],
  createdBy: "018f0e5d-6a25-7b01-8f4a-7d62a5d3e401",
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T01:00:00.000Z",
};

function success(data: unknown): Response {
  return new Response(JSON.stringify({ data, meta: { requestId: "request-1" } }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

describe("editorial API client", () => {
  it("reads paginated media through the relative item and collection routes", async () => {
    const fetcher = vi
      .fn<Fetcher>()
      .mockResolvedValueOnce(success({ items: [media], nextCursor: "next-media" }))
      .mockResolvedValueOnce(success(media));
    const api = createEditorialApi({ fetcher });

    await expect(api.listMedia({ cursor: "after media", limit: 25 })).resolves.toEqual({
      items: [media],
      nextCursor: "next-media",
    });
    await expect(api.getMedia(media.id)).resolves.toEqual(media);

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/v1/admin/media?cursor=after+media&limit=25",
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      `/api/v1/admin/media/${media.id}`,
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
  });

  it("uploads media as multipart form data without taking over its boundary", async () => {
    const fetcher = vi.fn<Fetcher>(async () => success(media));
    const api = createEditorialApi({ fetcher });
    const file = new File(["image bytes"], "hero.jpg", { type: "image/jpeg" });

    await expect(api.uploadMedia(file, "Hero image")).resolves.toEqual(media);

    const [input, init] = fetcher.mock.calls[0] ?? [];
    expect(input).toBe("/api/v1/admin/media");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);
    const form = init?.body as FormData;
    expect(form.get("file")).toBe(file);
    expect(form.get("altText")).toBe("Hero image");
    expect(new Headers(init?.headers).get("X-TinyCMS-Request")).toBe("1");
    expect(new Headers(init?.headers).has("Content-Type")).toBe(false);
    expect(api.getMediaOriginalUrl(media.id)).toBe(`/api/v1/admin/media/${media.id}/original`);

    const secondFile = new File(["other image bytes"], "other.webp", { type: "image/webp" });
    await expect(api.uploadMedia(secondFile)).resolves.toEqual(media);
    const secondForm = fetcher.mock.calls[1]?.[1]?.body as FormData;
    expect(secondForm.has("altText")).toBe(false);
  });

  it("rejects unsupported, oversized, or missing media before making a request", async () => {
    const fetcher = vi.fn<Fetcher>(async () => success(media));
    const api = createEditorialApi({ fetcher });

    await expect(
      api.uploadMedia(new File(["gif bytes"], "hero.gif", { type: "image/gif" })),
    ).rejects.toThrow("Unsupported media type");
    await expect(
      api.uploadMedia(
        new File([new Uint8Array(20 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }),
      ),
    ).rejects.toThrow("Media file exceeds 20 MiB");
    await expect(api.uploadMedia(undefined as unknown as File)).rejects.toThrow(
      "Media file is required",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends exact JSON mutation bodies and headers for media metadata and trash", async () => {
    const fetcher = vi
      .fn<Fetcher>()
      .mockResolvedValueOnce(success({ ...media, altText: "Updated", version: 2 }))
      .mockResolvedValueOnce(success({ ...media, state: "trash", version: 3 }));
    const api = createEditorialApi({ fetcher });

    await api.updateMedia(media.id, { expectedVersion: 1, altText: "Updated" });
    await api.deleteMedia(media.id, { expectedVersion: 2 });

    const [updateInput, updateInit] = fetcher.mock.calls[0] ?? [];
    expect(updateInput).toBe(`/api/v1/admin/media/${media.id}`);
    expect(updateInit?.method).toBe("PATCH");
    expect(updateInit?.body).toBe(JSON.stringify({ expectedVersion: 1, altText: "Updated" }));
    expect(new Headers(updateInit?.headers).get("Content-Type")).toBe("application/json");
    expect(new Headers(updateInit?.headers).get("X-TinyCMS-Request")).toBe("1");

    const [deleteInput, deleteInit] = fetcher.mock.calls[1] ?? [];
    expect(deleteInput).toBe(`/api/v1/admin/media/${media.id}`);
    expect(deleteInit?.method).toBe("DELETE");
    expect(deleteInit?.body).toBe(JSON.stringify({ expectedVersion: 2 }));
    expect(new Headers(deleteInit?.headers).get("Content-Type")).toBe("application/json");
    expect(new Headers(deleteInit?.headers).get("X-TinyCMS-Request")).toBe("1");
  });

  it("parses media error envelopes and classifies only a 409 conflict as actionable", async () => {
    const conflictFetcher = vi.fn<Fetcher>(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: "CONFLICT", message: "server detail", requestId: "media-conflict" },
          }),
          { status: 409 },
        ),
    );
    const conflict = createEditorialApi({ fetcher: conflictFetcher });

    await expect(
      conflict.updateMedia(media.id, { expectedVersion: 1, altText: "Updated" }),
    ).rejects.toSatisfy((error: unknown) => {
      return (
        isEditorialConflict(error) &&
        error.status === 409 &&
        error.code === "CONFLICT" &&
        error.message === "Editorial API request failed"
      );
    });

    const invalidFetcher = vi.fn<Fetcher>(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: "NOT_FOUND", message: "not found", requestId: "media-missing" },
          }),
          { status: 409 },
        ),
    );
    const invalid = createEditorialApi({ fetcher: invalidFetcher });
    await expect(invalid.getMedia(media.id)).rejects.toSatisfy((error: unknown) => {
      return error instanceof EditorialApiError && error.kind === "error" && error.status === 409;
    });
  });

  it("reads the bounded post list through the relative same-origin route", async () => {
    const fetcher = vi.fn<Fetcher>(async () => success({ items: [post], nextCursor: null }));
    const api = createEditorialApi({ fetcher });

    await expect(api.listPosts({ limit: 20 })).resolves.toEqual({
      items: [post],
      nextCursor: null,
    });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/admin/posts?limit=20",
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
    const request = fetcher.mock.calls[0]?.[1];
    expect(new Headers(request?.headers).has("Content-Type")).toBe(false);
    expect(new Headers(request?.headers).has("X-TinyCMS-Request")).toBe(false);
  });

  it("sends the write boundary headers and exact JSON body for draft saves", async () => {
    const fetcher = vi.fn<Fetcher>(async () => success(post));
    const api = createEditorialApi({ fetcher });
    const body = {
      content: post.content,
      contentVersion: 1 as const,
      expectedDraftVersion: 1,
      title: "Edited",
    };

    await api.saveDraft(post.id, body);

    const [input, init] = fetcher.mock.calls[0] ?? [];
    expect(input).toBe(`/api/v1/admin/posts/${post.id}/draft`);
    expect(init?.method).toBe("PUT");
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
    expect(new Headers(init?.headers).get("X-TinyCMS-Request")).toBe("1");
    expect(init?.body).toBe(JSON.stringify(body));
  });

  it("classifies only a 409 CONFLICT envelope as an actionable conflict", async () => {
    const conflictFetcher = vi.fn<Fetcher>(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: "CONFLICT", message: "server detail", requestId: "request-2" },
          }),
          { status: 409 },
        ),
    );
    const conflict = createEditorialApi({ fetcher: conflictFetcher });

    await expect(
      conflict.saveDraft(post.id, {
        content: post.content,
        contentVersion: 1,
        expectedDraftVersion: 1,
        title: "Edited",
      }),
    ).rejects.toSatisfy((error: unknown) => {
      return (
        isEditorialConflict(error) &&
        error.status === 409 &&
        error.message === "Editorial API request failed" &&
        !error.message.includes("server detail")
      );
    });

    const otherFetcher = vi.fn<Fetcher>(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: "INTERNAL_ERROR", message: "secret detail", requestId: "request-3" },
          }),
          { status: 500 },
        ),
    );
    const other = createEditorialApi({ fetcher: otherFetcher });
    await expect(other.getPost(post.id)).rejects.toSatisfy((error: unknown) => {
      return error instanceof EditorialApiError && error.kind === "error" && error.status === 500;
    });
  });
});
