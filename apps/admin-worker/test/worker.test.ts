import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../src/index";

describe("admin worker", () => {
  it("reports health on the configured host", async () => {
    const response = await exports.default.fetch("https://localhost/healthz");
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

  it("hides every route on a different host", async () => {
    const response = await exports.default.fetch("https://admin.example.test/healthz");
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

  it("ignores a forwarded host when checking the request URL", async () => {
    const response = await exports.default.fetch("https://localhost/healthz", {
      headers: { "X-Forwarded-Host": "admin.example.test" },
    });

    expect(response.status).toBe(200);
  });

  it("fails closed when the admin host is empty", async () => {
    const response = await app.request("https://localhost/healthz", undefined, {
      ADMIN_HOST: "",
    });

    expect(response.status).toBe(404);
  });
});
