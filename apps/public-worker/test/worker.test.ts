import { exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { createPublicApp } from "../src";

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
  "Content-Security-Policy":
    "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
} as const;

function expectSafeResponseHeaders(response: Response, cacheControl: string | null) {
  expect(response.headers.get("Cache-Control")).toBe(cacheControl);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    expect(response.headers.get(name)).toBe(value);
  }
}

function serializeLogArguments(argumentsList: unknown[]) {
  return JSON.stringify(argumentsList, (_, value) => {
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
        cause: value.cause,
      };
    }
    return value;
  });
}

async function expectGenericErrorResponse(response: Response) {
  const requestId = response.headers.get("X-Request-Id");
  const body = await response.json();

  expect(response.status).toBe(500);
  expectSafeResponseHeaders(response, "no-store");
  expect(body).toEqual({
    error: {
      code: "INTERNAL_ERROR",
      message: "Internal server error",
      requestId,
    },
  });

  return { body, requestId };
}

describe("public worker", () => {
  it("serves the active published HTML artifact with cache validators", async () => {
    const readPublishedEntry = vi.fn(async () => ({
      post: {
        slug: "published-entry",
        canonicalUrl: "https://notes.example.test/published-entry",
        noindex: 0 as const,
      },
      artifact: {
        body: "<article><h1>Published entry</h1></article>",
        etag: '"published-html-etag"',
      },
    }));
    const testApp = createPublicApp(undefined, { readPublishedEntry } as never);

    const response = await testApp.fetch(
      new Request("https://public.example.test/entry/published-entry"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=60, stale-while-revalidate=300",
    );
    expect(response.headers.get("ETag")).toBe('"published-html-etag"');
    expect(response.headers.get("Vary")).toBe("Accept");
    expect(response.headers.get("Link")).toBe(
      '<https://notes.example.test/published-entry>; rel="canonical"',
    );
    expect(await response.text()).toBe("<article><h1>Published entry</h1></article>");
    expect(readPublishedEntry).toHaveBeenCalledWith("published-entry", "html");
  });

  it.each([
    ["explicit Markdown path", "/entry/published-entry.md", {}],
    ["Markdown Accept header", "/entry/published-entry", { Accept: "text/markdown" }],
  ])("serves Markdown through the %s", async (_label, path, headers) => {
    const readPublishedEntry = vi.fn(async () => ({
      post: {
        slug: "published-entry",
        canonicalUrl: null,
        noindex: 1 as const,
      },
      artifact: { body: "# Published entry\n", etag: '"published-markdown-etag"' },
    }));
    const testApp = createPublicApp(undefined, { readPublishedEntry } as never);

    const response = await testApp.fetch(
      new Request(`https://public.example.test${path}`, { headers }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(await response.text()).toBe("# Published entry\n");
    expect(readPublishedEntry).toHaveBeenCalledWith("published-entry", "markdown");
  });

  it("serves a ready public media derivative", async () => {
    const readPublicMedia = vi.fn(async () => ({
      body: new Uint8Array([1, 2, 3]),
      etag: '"media-etag"',
      format: "webp" as const,
    }));
    const testApp = createPublicApp(undefined, {
      readPublishedEntry: vi.fn(),
      readPublicMedia,
    } as never);
    const mediaId = "018f0e5d-6a25-7b01-8f4a-7d62a5d3e410";

    const response = await testApp.fetch(
      new Request(`https://public.example.test/media/${mediaId}`, {
        headers: { Accept: "image/webp" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/webp");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("ETag")).toBe('"media-etag"');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(readPublicMedia).toHaveBeenCalledWith(mediaId, "webp");
  });

  it("reports health with a generated request ID", async () => {
    const response = await exports.default.fetch("https://public.example.test/healthz");
    const requestId = response.headers.get("X-Request-Id");

    expect(response.status).toBe(200);
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expectSafeResponseHeaders(response, "no-store");
    expect(await response.json()).toEqual({
      data: { status: "ok" },
      meta: { requestId },
    });
  });

  it("does not expose an admin route", async () => {
    const response = await exports.default.fetch("https://public.example.test/admin");
    const requestId = response.headers.get("X-Request-Id");

    expect(response.status).toBe(404);
    expectSafeResponseHeaders(response, "no-store");
    expect(await response.json()).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Not found",
        requestId,
      },
    });
  });

  it("returns a safe miss response for unsupported methods", async () => {
    const response = await exports.default.fetch("https://public.example.test/healthz", {
      method: "POST",
    });
    const requestId = response.headers.get("X-Request-Id");

    expect(response.status).toBe(404);
    expectSafeResponseHeaders(response, "no-store");
    expect(await response.json()).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Not found",
        requestId,
      },
    });
  });

  it("returns a generic correlated error and logs only safe metadata", async () => {
    const testSecret = "database secret";
    const errorCause = new Error("connection secret");
    const originalError = new Error(testSecret, { cause: errorCause });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const testApp = createPublicApp((configuredApp) => {
      configuredApp.get("/test-error", () => {
        throw originalError;
      });
    });

    try {
      const response = await testApp.fetch(new Request("https://public.example.test/test-error"));
      const { body, requestId } = await expectGenericErrorResponse(response);
      expect(JSON.stringify(body)).not.toContain("database secret");
      const serializedLogArguments = serializeLogArguments(errorSpy.mock.calls);
      expect(serializedLogArguments).not.toContain(originalError.message);
      expect(serializedLogArguments).not.toContain(originalError.stack);
      expect(serializedLogArguments).not.toContain(errorCause.message);
      expect(serializedLogArguments).not.toContain(testSecret);
      expect(serializedLogArguments).not.toMatch(/"(?:message|stack|cause)":/);
      expect(errorSpy).toHaveBeenCalledWith("Unhandled request error", {
        requestId,
        errorCategory: "Error",
      });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("normalizes synchronously thrown non-Error values", async () => {
    const testSecret = "synchronous secret";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const testApp = createPublicApp((configuredApp) => {
      configuredApp.get("/test-non-error", () => {
        throw testSecret;
      });
    });

    try {
      const response = await testApp.fetch(
        new Request("https://public.example.test/test-non-error"),
      );
      const { requestId } = await expectGenericErrorResponse(response);
      expect(serializeLogArguments(errorSpy.mock.calls)).not.toContain(testSecret);
      expect(errorSpy).toHaveBeenCalledWith("Unhandled request error", {
        requestId,
        errorCategory: "Unknown",
      });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("normalizes asynchronously thrown non-Error values", async () => {
    const testSecret = "asynchronous secret";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const testApp = createPublicApp((configuredApp) => {
      configuredApp.get("/test-async-non-error", async () => {
        await Promise.resolve();
        throw { detail: testSecret };
      });
    });

    try {
      const response = await testApp.fetch(
        new Request("https://public.example.test/test-async-non-error"),
      );
      const { requestId } = await expectGenericErrorResponse(response);
      expect(serializeLogArguments(errorSpy.mock.calls)).not.toContain(testSecret);
      expect(errorSpy).toHaveBeenCalledWith("Unhandled request error", {
        requestId,
        errorCategory: "Unknown",
      });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("marks route-produced client errors as no-store", async () => {
    const testApp = createPublicApp((configuredApp) => {
      configuredApp.get("/bad-request", (context) => {
        return context.json({ error: "Bad request" }, 400);
      });
    });

    const response = await testApp.fetch(new Request("https://public.example.test/bad-request"));

    expect(response.status).toBe(400);
    expectSafeResponseHeaders(response, "no-store");
  });

  it("overrides cacheable policies on route-produced server errors", async () => {
    const testApp = createPublicApp((configuredApp) => {
      configuredApp.get("/unavailable", (context) => {
        context.header("Cache-Control", "public, max-age=60");
        return context.json({ error: "Unavailable" }, 503);
      });
    });

    const response = await testApp.fetch(new Request("https://public.example.test/unavailable"));

    expect(response.status).toBe(503);
    expectSafeResponseHeaders(response, "no-store");
  });

  it("preserves route-specific cache headers on other successful responses", async () => {
    const testApp = createPublicApp((configuredApp) => {
      configuredApp.get("/article", (context) => {
        context.header("Cache-Control", "public, max-age=60");
        return context.text("article");
      });
    });

    const response = await testApp.fetch(new Request("https://public.example.test/article"));

    expect(response.status).toBe(200);
    expectSafeResponseHeaders(response, "public, max-age=60");
    expect(await response.text()).toBe("article");
  });

  it("preserves route-specific security policies", async () => {
    const routeCsp =
      "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data:";
    const testApp = createPublicApp((configuredApp) => {
      configuredApp.get("/article-policy", (context) => {
        context.header("Content-Security-Policy", routeCsp);
        context.header("Referrer-Policy", "no-referrer");
        return context.text("article");
      });
    });

    const response = await testApp.fetch(new Request("https://public.example.test/article-policy"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Security-Policy")).toBe(routeCsp);
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Permissions-Policy")).toBe(
      "camera=(), geolocation=(), microphone=()",
    );
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
  });

  it("applies boundary headers to immutable route responses", async () => {
    const redirectLocation = "https://public.example.test/article";
    const redirectResponse = Response.redirect(redirectLocation, 302);
    expect(() => redirectResponse.headers.set("X-Test", "immutable")).toThrow(TypeError);
    const testApp = createPublicApp((configuredApp) => {
      configuredApp.get("/redirect", () => redirectResponse);
    });

    const response = await testApp.fetch(new Request("https://public.example.test/redirect"));

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(redirectLocation);
    expect(response.headers.get("X-Request-Id")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expectSafeResponseHeaders(response, null);
  });
});
