import { env } from "cloudflare:workers";
import {
  ApplicationError,
  ApplicationErrorCode,
  MAX_MEDIA_BYTES,
  type MediaApplication,
} from "@tinycms/application";
import type { MediaAsset } from "@tinycms/contracts";
import type { HonoJsonWebKey } from "hono/utils/jwt/jws";
import { sign } from "hono/utils/jwt/jwt";
import { describe, expect, it, vi } from "vitest";
import { createAdminApp } from "../src/index";

const ACCESS_DOMAIN = "team.cloudflareaccess.com";
const ACCESS_AUDIENCE = "media-test-audience";
const ACCESS_ISSUER = `https://${ACCESS_DOMAIN}`;
const ADMIN_BINDINGS = {
  ADMIN_HOST: "localhost",
  ACCESS_TEAM_DOMAIN: ACCESS_DOMAIN,
  ACCESS_AUD: ACCESS_AUDIENCE,
};
const MEDIA_ID = "0192f5a4-7b3c-7d1e-8f20-123456789abc";
const ASSET: MediaAsset = {
  id: MEDIA_ID,
  filename: "photo.jpg",
  mediaType: "image/jpeg",
  byteSize: 4,
  width: 800,
  height: 600,
  altText: "alt",
  contentHash: "hash",
  state: "ready",
  version: 1,
  variants: [],
  createdBy: "0192f5a4-7b3c-7d1e-8f20-123456789abd",
  createdAt: "2023-11-14T22:13:20.000Z" as const,
  updatedAt: "2023-11-14T22:13:20.000Z" as const,
};
const ONE_PIXEL_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  ),
  (character) => character.charCodeAt(0),
);

async function accessAssertion() {
  const keyPair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const privateKey = {
    ...(await crypto.subtle.exportKey("jwk", keyPair.privateKey)),
    alg: "RS256",
    kid: "media-test-key",
  } as HonoJsonWebKey;
  const publicKey = {
    ...(await crypto.subtle.exportKey("jwk", keyPair.publicKey)),
    alg: "RS256",
    kid: "media-test-key",
    use: "sig",
  } as HonoJsonWebKey;
  return {
    assertion: await sign(
      {
        sub: "media-test-subject",
        iss: ACCESS_ISSUER,
        aud: ACCESS_AUDIENCE,
        exp: Math.floor(Date.now() / 1000) + 300,
      },
      privateKey,
      "RS256",
    ),
    publicKey,
  };
}

function mediaApplication(overrides: Partial<MediaApplication> = {}): MediaApplication {
  return {
    createMedia: vi.fn(async () => ASSET),
    getMedia: vi.fn(async () => ASSET),
    listMedia: vi.fn(async () => ({ items: [ASSET], nextCursor: null })),
    updateMediaAlt: vi.fn(async () => ASSET),
    trashMedia: vi.fn(async (): Promise<MediaAsset> => ({ ...ASSET, state: "trash", version: 2 })),
    getMediaOriginal: vi.fn(async () => ({
      key: `media/originals/${MEDIA_ID}/hash`,
      filename: ASSET.filename,
      mediaType: ASSET.mediaType,
    })),
    ...overrides,
  };
}

async function authenticatedApp(application: MediaApplication) {
  const access = await accessAssertion();
  return {
    access,
    app: createAdminApp({
      mediaApplication: application,
      fetch: async () => new Response(JSON.stringify({ keys: [access.publicKey] })),
    }),
  };
}

function mutationHeaders(assertion: string, contentType = "application/json") {
  return {
    "Cf-Access-Jwt-Assertion": assertion,
    ...(contentType === "multipart/form-data" ? {} : { "Content-Type": contentType }),
    Origin: "https://localhost",
    "X-TinyCMS-Request": "1",
  };
}

async function serializeMultipart(form: FormData): Promise<{
  body: ArrayBuffer;
  headers: { "Content-Length": string; "Content-Type": string };
}> {
  const request = new Request("https://localhost", { method: "POST", body: form });
  const body = await request.clone().arrayBuffer();
  const contentType = request.headers.get("Content-Type");
  if (contentType === null) {
    throw new Error("Multipart content type was not generated");
  }
  return {
    body,
    headers: {
      "Content-Length": String(body.byteLength),
      "Content-Type": contentType,
    },
  };
}

async function multipartRequest(
  url: string,
  form: FormData,
  headers: HeadersInit,
): Promise<Request> {
  const request = new Request(url, { method: "POST", headers, body: form });
  const bodyLength = (await request.clone().arrayBuffer()).byteLength;
  request.headers.set("Content-Length", String(bodyLength));
  return request;
}

describe("admin media adapter", () => {
  it("provides isolated local R2 and Images bindings for media adapters", async () => {
    const key = `media-test/${crypto.randomUUID()}`;
    try {
      await env.MEDIA_ORIGINALS.put(key, ONE_PIXEL_PNG, {
        httpMetadata: { contentType: "image/png", cacheControl: "private, no-store" },
      });
      const object = await env.MEDIA_ORIGINALS.get(key);
      expect(object).not.toBeNull();
      expect(object?.httpMetadata?.contentType).toBe("image/png");
      const info = await env.IMAGES.info(new Blob([ONE_PIXEL_PNG]).stream());
      expect(info).toMatchObject({ format: "image/png", width: 1, height: 1 });
    } finally {
      await env.MEDIA_ORIGINALS.delete(key);
    }
  });

  it("accepts multipart only on the media upload route and passes one file plus altText", async () => {
    const access = await accessAssertion();
    const application = mediaApplication();
    const app = createAdminApp({
      mediaApplication: application,
      fetch: async () => new Response(JSON.stringify({ keys: [access.publicKey] })),
    });
    const body = new FormData();
    body.append(
      "file",
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "photo.jpg", { type: "image/jpeg" }),
    );
    body.append("altText", "A photo");
    const request = await multipartRequest("https://localhost/api/v1/admin/media", body, {
      "Cf-Access-Jwt-Assertion": access.assertion,
      Origin: "https://localhost",
      "X-TinyCMS-Request": "1",
    });

    const response = await app.fetch(request, ADMIN_BINDINGS);

    expect(response.status).toBe(201);
    expect(application.createMedia).toHaveBeenCalledWith(
      {
        filename: "photo.jpg",
        mediaType: "image/jpeg",
        bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
        altText: "A photo",
      },
      { subject: "media-test-subject" },
    );

    const nonMediaRequest = await multipartRequest("https://localhost/api/v1/admin/posts", body, {
      "Cf-Access-Jwt-Assertion": access.assertion,
      Origin: "https://localhost",
      "X-TinyCMS-Request": "1",
    });
    const nonMediaMultipart = await app.fetch(nonMediaRequest, ADMIN_BINDINGS);
    expect(nonMediaMultipart.status).toBe(400);
  });

  it("rejects a media upload without Content-Length before reading its body", async () => {
    const access = await accessAssertion();
    const application = mediaApplication();
    const app = createAdminApp({
      mediaApplication: application,
      fetch: async () => new Response(JSON.stringify({ keys: [access.publicKey] })),
    });
    const request = new Request("https://localhost/api/v1/admin/media", {
      method: "POST",
      headers: {
        "Cf-Access-Jwt-Assertion": access.assertion,
        "Content-Type": "multipart/form-data; boundary=boundary",
        Origin: "https://localhost",
        "X-TinyCMS-Request": "1",
      },
      body: "not-read",
    });
    const formData = vi.spyOn(request, "formData");

    const response = await app.fetch(request, ADMIN_BINDINGS);

    expect(response.status).toBe(400);
    expect(formData).not.toHaveBeenCalled();
    expect(request.bodyUsed).toBe(false);
    expect(application.createMedia).not.toHaveBeenCalled();
  });

  it("rejects malformed or negative Content-Length before reading its body", async () => {
    const access = await accessAssertion();
    const application = mediaApplication();
    const app = createAdminApp({
      mediaApplication: application,
      fetch: async () => new Response(JSON.stringify({ keys: [access.publicKey] })),
    });

    for (const contentLength of ["1e3", "1.0", "-1"]) {
      const request = new Request("https://localhost/api/v1/admin/media", {
        method: "POST",
        headers: {
          "Cf-Access-Jwt-Assertion": access.assertion,
          "Content-Type": "multipart/form-data; boundary=boundary",
          "Content-Length": contentLength,
          Origin: "https://localhost",
          "X-TinyCMS-Request": "1",
        },
        body: "not-read",
      });
      const formData = vi.spyOn(request, "formData");

      const response = await app.fetch(request, ADMIN_BINDINGS);

      expect(response.status, contentLength).toBe(400);
      expect(formData, contentLength).not.toHaveBeenCalled();
      expect(request.bodyUsed, contentLength).toBe(false);
    }
    expect(application.createMedia).not.toHaveBeenCalled();
  });

  it("rejects an over-bound Content-Length before reading its body", async () => {
    const access = await accessAssertion();
    const application = mediaApplication();
    const app = createAdminApp({
      mediaApplication: application,
      fetch: async () => new Response(JSON.stringify({ keys: [access.publicKey] })),
    });
    const request = new Request("https://localhost/api/v1/admin/media", {
      method: "POST",
      headers: {
        "Cf-Access-Jwt-Assertion": access.assertion,
        "Content-Type": "multipart/form-data; boundary=boundary",
        "Content-Length": String(MAX_MEDIA_BYTES + 64 * 1024 + 1),
        Origin: "https://localhost",
        "X-TinyCMS-Request": "1",
      },
      body: "not-read",
    });
    const formData = vi.spyOn(request, "formData");

    const response = await app.fetch(request, ADMIN_BINDINGS);

    expect(response.status).toBe(400);
    expect(formData).not.toHaveBeenCalled();
    expect(request.bodyUsed).toBe(false);
    expect(application.createMedia).not.toHaveBeenCalled();
  });

  it("streams a private original with an exact ETag and supports conditional 304", async () => {
    const access = await accessAssertion();
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const object = {
      httpEtag: '"original-etag"',
      httpMetadata: { contentType: "image/jpeg" },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    };
    const originals = {
      get: vi.fn(async (_key: string, options?: { onlyIf?: Headers }) => {
        if (options?.onlyIf?.get("If-None-Match") === object.httpEtag) return object;
        return object;
      }),
    };
    const app = createAdminApp({
      mediaApplication: mediaApplication({
        getMediaOriginal: vi.fn(async () => ({
          key: `media/originals/${MEDIA_ID}/hash`,
          filename: '写真"\r\nX-Evil: 1.jpg',
          mediaType: "image/jpeg",
        })),
      }),
      fetch: async () => new Response(JSON.stringify({ keys: [access.publicKey] })),
    });
    const bindings = { ...ADMIN_BINDINGS, MEDIA_ORIGINALS: originals };

    const response = await app.request(
      `https://localhost/api/v1/admin/media/${MEDIA_ID}/original`,
      { headers: { "Cf-Access-Jwt-Assertion": access.assertion } },
      bindings,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response.headers.get("ETag")).toBe('"original-etag"');
    const disposition = response.headers.get("Content-Disposition");
    expect(disposition).toContain("filename=");
    expect(disposition).toContain("filename*=UTF-8''");
    expect(disposition).not.toContain("\r");
    expect(disposition).not.toContain("\n");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);

    const conditional = await app.request(
      `https://localhost/api/v1/admin/media/${MEDIA_ID}/original`,
      {
        headers: {
          "Cf-Access-Jwt-Assertion": access.assertion,
          "If-None-Match": '"original-etag"',
        },
      },
      bindings,
    );
    expect(conditional.status).toBe(304);
    expect((await conditional.arrayBuffer()).byteLength).toBe(0);
  });

  it("routes list, item, alt update, and trash operations through the media application", async () => {
    const application = mediaApplication();
    const { access, app } = await authenticatedApp(application);

    const list = await app.request(
      "https://localhost/api/v1/admin/media?limit=2&cursor=opaque",
      { headers: { "Cf-Access-Jwt-Assertion": access.assertion } },
      ADMIN_BINDINGS,
    );
    expect(list.status).toBe(200);
    expect(application.listMedia).toHaveBeenCalledWith({ limit: 2, cursor: "opaque" });

    const item = await app.request(
      `https://localhost/api/v1/admin/media/${MEDIA_ID}`,
      { headers: { "Cf-Access-Jwt-Assertion": access.assertion } },
      ADMIN_BINDINGS,
    );
    expect(item.status).toBe(200);
    expect(application.getMedia).toHaveBeenCalledWith(MEDIA_ID);

    const patchResponse = await app.request(
      `https://localhost/api/v1/admin/media/${MEDIA_ID}`,
      {
        method: "PATCH",
        headers: mutationHeaders(access.assertion),
        body: JSON.stringify({ expectedVersion: 1, altText: "updated" }),
      },
      ADMIN_BINDINGS,
    );
    expect(patchResponse.status).toBe(200);
    expect(application.updateMediaAlt).toHaveBeenCalledWith(MEDIA_ID, {
      expectedVersion: 1,
      altText: "updated",
    });

    const deleteResponse = await app.request(
      `https://localhost/api/v1/admin/media/${MEDIA_ID}`,
      {
        method: "DELETE",
        headers: mutationHeaders(access.assertion),
        body: JSON.stringify({ expectedVersion: 2 }),
      },
      ADMIN_BINDINGS,
    );
    expect(deleteResponse.status).toBe(200);
    expect(application.trashMedia).toHaveBeenCalledWith(MEDIA_ID, { expectedVersion: 2 });
  });

  it("returns a stable conflict for stale optimistic media updates", async () => {
    const application = mediaApplication({
      updateMediaAlt: vi.fn(async () => {
        throw new ApplicationError(ApplicationErrorCode.CONFLICT, "database detail", {
          secret: "must not escape",
        });
      }),
    });
    const { access, app } = await authenticatedApp(application);
    const response = await app.request(
      `https://localhost/api/v1/admin/media/${MEDIA_ID}`,
      {
        method: "PATCH",
        headers: mutationHeaders(access.assertion),
        body: JSON.stringify({ expectedVersion: 1, altText: "stale" }),
      },
      ADMIN_BINDINGS,
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({ error: { code: "CONFLICT", message: "database detail" } });
    expect(body).toMatchObject({ error: { details: { secret: "must not escape" } } });
  });

  it("rejects duplicate or unexpected multipart fields before invoking the application", async () => {
    const application = mediaApplication();
    const { access, app } = await authenticatedApp(application);
    const cases = [
      (_form: FormData) => {},
      (form: FormData) => {
        form.append("file", new File(["two"], "two.jpg", { type: "image/jpeg" }));
        form.append("file", new File(["three"], "three.jpg", { type: "image/jpeg" }));
      },
      (form: FormData) => {
        form.append("file", new File(["one"], "one.jpg", { type: "image/jpeg" }));
        form.append("unexpected", "field");
      },
    ];

    for (const build of cases) {
      const form = new FormData();
      build(form);
      const multipart = await serializeMultipart(form);
      const response = await app.request(
        "https://localhost/api/v1/admin/media",
        {
          method: "POST",
          headers: {
            ...mutationHeaders(access.assertion, "multipart/form-data"),
            ...multipart.headers,
          },
          body: multipart.body,
        },
        ADMIN_BINDINGS,
      );
      expect(response.status).toBe(400);
    }
    expect(application.createMedia).not.toHaveBeenCalled();
  });

  it("keeps browser write defenses for multipart media mutations", async () => {
    const application = mediaApplication();
    const { access, app } = await authenticatedApp(application);
    const cases = [
      { Origin: "https://evil.example.test", "X-TinyCMS-Request": "1" },
      { Origin: "https://localhost", "X-TinyCMS-Request": "0" },
      { Origin: "https://localhost" },
    ];

    for (const boundary of cases) {
      const form = new FormData();
      form.append("file", new File(["one"], "one.jpg", { type: "image/jpeg" }));
      const multipart = await serializeMultipart(form);
      const response = await app.request(
        "https://localhost/api/v1/admin/media",
        {
          method: "POST",
          headers: {
            "Cf-Access-Jwt-Assertion": access.assertion,
            ...multipart.headers,
            ...boundary,
          },
          body: multipart.body,
        },
        ADMIN_BINDINGS,
      );
      expect(response.status).toBe(400);
    }
    expect(application.createMedia).not.toHaveBeenCalled();
  });

  it("does not expose media provider failures and logs only a stable category with requestId", async () => {
    const application = mediaApplication({
      createMedia: vi.fn(async () => {
        throw new ApplicationError(ApplicationErrorCode.MEDIA_WRITE_FAILED, "provider detail", {
          objectKey: "secret-key",
          filename: "secret.jpg",
        });
      }),
    });
    const { access, app } = await authenticatedApp(application);
    const form = new FormData();
    form.append("file", new File(["one"], "one.jpg", { type: "image/jpeg" }));
    const multipart = await serializeMultipart(form);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await app.request(
        "https://localhost/api/v1/admin/media",
        {
          method: "POST",
          headers: {
            ...mutationHeaders(access.assertion, "multipart/form-data"),
            ...multipart.headers,
          },
          body: multipart.body,
        },
        ADMIN_BINDINGS,
      );
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toMatchObject({
        error: { code: "MEDIA_WRITE_FAILED", message: "Media write failed" },
      });
      expect(JSON.stringify(body)).not.toContain("provider detail");
      expect(JSON.stringify(body)).not.toContain("secret-key");
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({ errorCategory: "MEDIA_WRITE_FAILED" }),
      );
      const logged = log.mock.calls.map((call) => JSON.stringify(call)).join("\n");
      expect(logged).not.toContain("secret-key");
      expect(logged).not.toContain("secret.jpg");
    } finally {
      log.mockRestore();
    }
  });

  it("returns the same stable 404 for a missing original", async () => {
    const application = mediaApplication({
      getMediaOriginal: vi.fn(async () => {
        throw new ApplicationError(ApplicationErrorCode.NOT_FOUND, "Resource not found");
      }),
    });
    const { access, app } = await authenticatedApp(application);
    const response = await app.request(
      `https://localhost/api/v1/admin/media/${MEDIA_ID}/original`,
      { headers: { "Cf-Access-Jwt-Assertion": access.assertion } },
      { ...ADMIN_BINDINGS, MEDIA_ORIGINALS: { get: vi.fn() } },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: "NOT_FOUND", message: "Resource not found" },
    });

    const missingObjectApp = createAdminApp({
      mediaApplication: mediaApplication(),
      fetch: async () => new Response(JSON.stringify({ keys: [access.publicKey] })),
    });
    const missingObject = await missingObjectApp.request(
      `https://localhost/api/v1/admin/media/${MEDIA_ID}/original`,
      { headers: { "Cf-Access-Jwt-Assertion": access.assertion } },
      { ...ADMIN_BINDINGS, MEDIA_ORIGINALS: { get: vi.fn(async () => null) } },
    );
    expect(missingObject.status).toBe(404);
    expect(await missingObject.json()).toMatchObject({
      error: { code: "NOT_FOUND", message: "Resource not found" },
    });
  });

  it("runs the default media adapters against isolated D1, R2, and Images bindings", async () => {
    const access = await accessAssertion();
    const app = createAdminApp({
      fetch: async () => new Response(JSON.stringify({ keys: [access.publicKey] })),
    });
    const form = new FormData();
    form.append("file", new File([ONE_PIXEL_PNG], "one.png", { type: "image/png" }));
    const request = await multipartRequest("https://localhost/api/v1/admin/media", form, {
      "Cf-Access-Jwt-Assertion": access.assertion,
      Origin: "https://localhost",
      "X-TinyCMS-Request": "1",
    });
    const response = await app.fetch(request, {
      ...ADMIN_BINDINGS,
      CMS_DB: env.CMS_DB,
      MEDIA_ORIGINALS: env.MEDIA_ORIGINALS,
      MEDIA_DERIVATIVES: env.MEDIA_DERIVATIVES,
      IMAGES: env.IMAGES,
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      data: MediaAsset;
    };
    expect(body.data).toMatchObject({
      filename: "one.png",
      mediaType: "image/png",
      width: 1,
      height: 1,
      state: "ready",
    });
    expect(body.data.variants.map(({ name }) => name)).toEqual(["w1.avif", "w1.webp"]);
    const original = await env.MEDIA_ORIGINALS.get(
      `media/originals/${body.data.id}/${body.data.contentHash}`,
    );
    expect(original?.httpMetadata).toMatchObject({
      contentType: "image/png",
      cacheControl: "private, no-store",
    });
    for (const variant of body.data.variants) {
      const derivative = await env.MEDIA_DERIVATIVES.get(
        `media/derivatives/${body.data.id}/${variant.name}`,
      );
      expect(derivative?.httpMetadata).toMatchObject({
        contentType: `image/${variant.format}`,
        cacheControl: "public, max-age=31536000, immutable",
      });
    }
  });
});
