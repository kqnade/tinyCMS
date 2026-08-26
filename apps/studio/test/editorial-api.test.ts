import { describe, expect, it, vi } from "vitest";
import { createEditorialApi, EditorialApiError, isEditorialConflict } from "../src/editorial-api";

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

function success(data: unknown): Response {
  return new Response(JSON.stringify({ data, meta: { requestId: "request-1" } }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

describe("editorial API client", () => {
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
