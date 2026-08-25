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

function expectSafeResponseHeaders(response: Response, cacheControl: string) {
  expect(response.headers.get("Cache-Control")).toBe(cacheControl);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    expect(response.headers.get(name)).toBe(value);
  }
}

describe("public worker", () => {
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

  it("returns a generic correlated error for a thrown handler and logs the original error", async () => {
    const originalError = new Error("database secret");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const testApp = createPublicApp((configuredApp) => {
      configuredApp.get("/test-error", () => {
        throw originalError;
      });
    });

    try {
      const response = await testApp.fetch(new Request("https://public.example.test/test-error"));
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
      expect(JSON.stringify(body)).not.toContain("database secret");
      expect(errorSpy).toHaveBeenCalledWith("Unhandled request error", {
        requestId,
        error: originalError,
      });
    } finally {
      errorSpy.mockRestore();
    }
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
});
