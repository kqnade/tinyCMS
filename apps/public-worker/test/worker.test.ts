import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("public worker", () => {
  it("reports health with a generated request ID", async () => {
    const response = await exports.default.fetch("https://public.example.test/healthz");
    const requestId = response.headers.get("X-Request-Id");

    expect(response.status).toBe(200);
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(await response.json()).toEqual({
      data: { status: "ok" },
      meta: { requestId },
    });
  });

  it("does not expose an admin route", async () => {
    const response = await exports.default.fetch("https://public.example.test/admin");
    const requestId = response.headers.get("X-Request-Id");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Not found",
        requestId,
      },
    });
  });
});
