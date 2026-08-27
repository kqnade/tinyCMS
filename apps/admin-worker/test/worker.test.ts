import { env, exports } from "cloudflare:workers";
import type { EditorialApplication } from "@tinycms/application";
import type { HonoJsonWebKey } from "hono/utils/jwt/jws";
import { sign } from "hono/utils/jwt/jwt";
import { describe, expect, it, vi } from "vitest";
import { createEditorialApi, isEditorialConflict } from "../../studio/src/editorial-api";
import { app, createAdminApp } from "../src/index";

const ACCESS_DOMAIN = "team.cloudflareaccess.com";
const ACCESS_ISSUER = `https://${ACCESS_DOMAIN}`;
const ACCESS_AUDIENCE = "test-access-audience";
const NOW = 1_700_000_000_000;
const ACCESS_BINDINGS = {
  ADMIN_HOST: "localhost",
  ACCESS_TEAM_DOMAIN: ACCESS_DOMAIN,
  ACCESS_AUD: ACCESS_AUDIENCE,
};

const DB_BINDINGS = {
  ...ACCESS_BINDINGS,
  CMS_DB: env.CMS_DB,
};

async function createSigningKey(kid: string) {
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
    kid,
  } as HonoJsonWebKey;
  const publicKey = {
    ...(await crypto.subtle.exportKey("jwk", keyPair.publicKey)),
    alg: "RS256",
    kid,
    use: "sig",
  } as HonoJsonWebKey;

  return {
    publicKey,
    sign: (payload: Parameters<typeof sign>[0]) =>
      sign({ sub: "test-access-subject", ...payload }, privateKey, "RS256"),
  };
}

async function expectAuthInvalid(response: Response) {
  const requestId = response.headers.get("X-Request-Id");

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({
    error: {
      code: "AUTH_INVALID",
      message: "Invalid authentication",
      requestId,
    },
  });
}

async function requestRejectedBeforeJwks(assertion: string) {
  let jwksFetchCount = 0;
  const application = createAdminApp({
    now: () => NOW,
    fetch: async () => {
      jwksFetchCount += 1;
      return new Response(JSON.stringify({ keys: [] }), { status: 200 });
    },
  });
  const response = await application.request(
    "https://localhost/healthz",
    { headers: { "Cf-Access-Jwt-Assertion": assertion } },
    ACCESS_BINDINGS,
  );

  return { jwksFetchCount, response };
}

describe("admin worker", () => {
  it("renders a preview through the authenticated JSON write boundary", async () => {
    const key = await createSigningKey("preview-route-key");
    const previewPost = vi.fn<EditorialApplication["previewPost"]>(async (request) => ({
      html: `<article><h1>${request.title}</h1><p>Preview</p></article>`,
    }));
    const application = createAdminApp({
      application: { previewPost } as unknown as EditorialApplication,
      now: () => NOW,
      fetch: async () => new Response(JSON.stringify({ keys: [key.publicKey] }), { status: 200 }),
    });
    const assertion = await key.sign({
      iss: ACCESS_ISSUER,
      aud: ACCESS_AUDIENCE,
      exp: NOW / 1000 + 300,
    });
    const request = {
      title: "Preview title",
      excerpt: null,
      metadata: { seo: { description: "Preview" } },
      contentVersion: 1,
      content: { type: "doc", content: [] },
    };

    const response = await application.request(
      "https://localhost/api/v1/admin/posts/0192f5a4-7b3c-7d1e-8f20-123456789abc/preview",
      {
        method: "POST",
        headers: {
          "Cf-Access-Jwt-Assertion": assertion,
          "Content-Type": "application/json",
          Origin: "https://localhost",
          "X-TinyCMS-Request": "1",
        },
        body: JSON.stringify(request),
      },
      ACCESS_BINDINGS,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { html: "<article><h1>Preview title</h1><p>Preview</p></article>" },
    });
    expect(previewPost).toHaveBeenCalledWith(request);
  });

  it("publishes a post through the authenticated JSON write boundary", async () => {
    const key = await createSigningKey("publish-route-key");
    const postId = "0192f5a4-7b3c-7d1e-8f20-123456789abc";
    const publishPost = vi.fn<EditorialApplication["publishPost"]>(
      async () =>
        ({
          publicationJobId: "0192f5a4-7b3c-7d1e-8f20-123456789abd",
          htmlPath: `posts/${postId}/revisions/0192f5a4-7b3c-7d1e-8f20-123456789abe.html`,
          markdownPath: `posts/${postId}/revisions/0192f5a4-7b3c-7d1e-8f20-123456789abe.md`,
        }) as never,
    );
    const application = createAdminApp({
      application: { publishPost } as unknown as EditorialApplication,
      now: () => NOW,
      fetch: async () => new Response(JSON.stringify({ keys: [key.publicKey] }), { status: 200 }),
    });
    const assertion = await key.sign({
      iss: ACCESS_ISSUER,
      aud: ACCESS_AUDIENCE,
      exp: NOW / 1000 + 300,
    });
    const request = {
      expectedDraftVersion: 3,
      expectedRevisionVersion: 5,
      idempotencyKey: "studio-publish-request-1",
    };

    const response = await application.request(
      `https://localhost/api/v1/admin/posts/${postId}/publish`,
      {
        method: "POST",
        headers: {
          "Cf-Access-Jwt-Assertion": assertion,
          "Content-Type": "application/json",
          Origin: "https://localhost",
          "X-TinyCMS-Request": "1",
        },
        body: JSON.stringify(request),
      },
      ACCESS_BINDINGS,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        publicationJobId: "0192f5a4-7b3c-7d1e-8f20-123456789abd",
      },
    });
    expect(publishPost).toHaveBeenCalledWith(
      postId,
      request,
      expect.objectContaining({ subject: "test-access-subject" }),
    );
  });

  it("requires an Access assertion on the configured host", async () => {
    const response = await exports.default.fetch("https://localhost/healthz");
    const requestId = response.headers.get("X-Request-Id");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: "AUTH_REQUIRED",
        message: "Authentication required",
        requestId,
      },
    });
  });

  it("rejects a malformed Access assertion", async () => {
    const { jwksFetchCount, response } = await requestRejectedBeforeJwks("not-a-jwt");

    await expectAuthInvalid(response);
    expect(jwksFetchCount).toBe(0);
  });

  it("rejects an assertion with invalid JWT parts", async () => {
    const { jwksFetchCount, response } = await requestRejectedBeforeJwks("aaa.bbb.ccc");

    await expectAuthInvalid(response);
    expect(jwksFetchCount).toBe(0);
  });

  it("rejects an assertion that is not RS256", async () => {
    const assertion = await sign(
      { exp: Math.floor(Date.now() / 1000) + 300 },
      "test-secret",
      "HS256",
    );
    const { jwksFetchCount, response } = await requestRejectedBeforeJwks(assertion);

    await expectAuthInvalid(response);
    expect(jwksFetchCount).toBe(0);
  });

  it("rejects an assertion when Access variables are not configured", async () => {
    const key = await createSigningKey("missing-config-key");
    const assertion = await key.sign({ exp: Math.floor(Date.now() / 1000) + 300 });
    const response = await exports.default.fetch("https://localhost/healthz", {
      headers: { "Cf-Access-Jwt-Assertion": assertion },
    });
    const requestId = response.headers.get("X-Request-Id");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: "AUTH_INVALID",
        message: "Invalid authentication",
        requestId,
      },
    });
  });

  it("rejects a non-Cloudflare Access team domain", async () => {
    const key = await createSigningKey("invalid-domain-key");
    const assertion = await key.sign({ exp: Math.floor(Date.now() / 1000) + 300 });
    const response = await app.request(
      "https://localhost/healthz",
      { headers: { "Cf-Access-Jwt-Assertion": assertion } },
      {
        ADMIN_HOST: "localhost",
        ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
        ACCESS_AUD: "aud",
      },
    );
    const requestId = response.headers.get("X-Request-Id");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: "AUTH_INVALID",
        message: "Invalid authentication",
        requestId,
      },
    });
  });

  it("accepts a correctly signed Access assertion", async () => {
    const key = await createSigningKey("key-1");
    const assertion = await key.sign({
      iss: ACCESS_ISSUER,
      aud: ACCESS_AUDIENCE,
      exp: NOW / 1000 + 300,
    });
    const application = createAdminApp({
      now: () => NOW,
      fetch: async (input) => {
        expect(input).toBe(`https://${ACCESS_DOMAIN}/cdn-cgi/access/certs`);
        return new Response(JSON.stringify({ keys: [key.publicKey] }), { status: 200 });
      },
    });
    const response = await application.request(
      "https://localhost/healthz",
      { headers: { "Cf-Access-Jwt-Assertion": assertion } },
      {
        ADMIN_HOST: "localhost",
        ACCESS_TEAM_DOMAIN: ACCESS_DOMAIN,
        ACCESS_AUD: ACCESS_AUDIENCE,
      },
    );
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

  it("rejects a correctly signed assertion from the wrong issuer", async () => {
    const key = await createSigningKey("issuer-key");
    const assertion = await key.sign({
      iss: "https://other.cloudflareaccess.com",
      aud: ACCESS_AUDIENCE,
      exp: NOW / 1000 + 300,
    });
    const application = createAdminApp({
      now: () => NOW,
      fetch: async () => new Response(JSON.stringify({ keys: [key.publicKey] }), { status: 200 }),
    });
    const response = await application.request(
      "https://localhost/healthz",
      { headers: { "Cf-Access-Jwt-Assertion": assertion } },
      {
        ADMIN_HOST: "localhost",
        ACCESS_TEAM_DOMAIN: ACCESS_DOMAIN,
        ACCESS_AUD: ACCESS_AUDIENCE,
      },
    );

    await expectAuthInvalid(response);
  });

  it("rejects a correctly signed assertion for the wrong audience", async () => {
    const key = await createSigningKey("audience-key");
    const assertion = await key.sign({
      iss: ACCESS_ISSUER,
      aud: "other-audience",
      exp: NOW / 1000 + 300,
    });
    const application = createAdminApp({
      now: () => NOW,
      fetch: async () => new Response(JSON.stringify({ keys: [key.publicKey] }), { status: 200 }),
    });
    const response = await application.request(
      "https://localhost/healthz",
      { headers: { "Cf-Access-Jwt-Assertion": assertion } },
      {
        ADMIN_HOST: "localhost",
        ACCESS_TEAM_DOMAIN: ACCESS_DOMAIN,
        ACCESS_AUD: ACCESS_AUDIENCE,
      },
    );

    await expectAuthInvalid(response);
  });

  it("accepts an audience array containing the configured audience", async () => {
    const key = await createSigningKey("audience-array-key");
    const assertion = await key.sign({
      iss: ACCESS_ISSUER,
      aud: ["other-audience", ACCESS_AUDIENCE],
      exp: NOW / 1000 + 300,
    });
    const application = createAdminApp({
      now: () => NOW,
      fetch: async () => new Response(JSON.stringify({ keys: [key.publicKey] }), { status: 200 }),
    });
    const response = await application.request(
      "https://localhost/healthz",
      { headers: { "Cf-Access-Jwt-Assertion": assertion } },
      {
        ADMIN_HOST: "localhost",
        ACCESS_TEAM_DOMAIN: ACCESS_DOMAIN,
        ACCESS_AUD: ACCESS_AUDIENCE,
      },
    );

    expect(response.status).toBe(200);
  });

  it("rejects an expired assertion", async () => {
    const key = await createSigningKey("expired-key");
    const assertion = await key.sign({
      iss: ACCESS_ISSUER,
      aud: ACCESS_AUDIENCE,
      exp: NOW / 1000 - 1,
    });
    const application = createAdminApp({
      now: () => NOW,
      fetch: async () => new Response(JSON.stringify({ keys: [key.publicKey] }), { status: 200 }),
    });
    const response = await application.request(
      "https://localhost/healthz",
      { headers: { "Cf-Access-Jwt-Assertion": assertion } },
      {
        ADMIN_HOST: "localhost",
        ACCESS_TEAM_DOMAIN: ACCESS_DOMAIN,
        ACCESS_AUD: ACCESS_AUDIENCE,
      },
    );

    await expectAuthInvalid(response);
  });

  it("rejects an assertion that is not yet valid", async () => {
    const key = await createSigningKey("not-before-key");
    const assertion = await key.sign({
      iss: ACCESS_ISSUER,
      aud: ACCESS_AUDIENCE,
      exp: NOW / 1000 + 300,
      nbf: NOW / 1000 + 60,
    });
    const application = createAdminApp({
      now: () => NOW,
      fetch: async () => new Response(JSON.stringify({ keys: [key.publicKey] }), { status: 200 }),
    });
    const response = await application.request(
      "https://localhost/healthz",
      { headers: { "Cf-Access-Jwt-Assertion": assertion } },
      {
        ADMIN_HOST: "localhost",
        ACCESS_TEAM_DOMAIN: ACCESS_DOMAIN,
        ACCESS_AUD: ACCESS_AUDIENCE,
      },
    );

    await expectAuthInvalid(response);
  });

  it("rejects a signed assertion without a valid expiry", async () => {
    const key = await createSigningKey("missing-exp-key");
    const assertion = await key.sign({
      iss: ACCESS_ISSUER,
      aud: ACCESS_AUDIENCE,
    });
    const application = createAdminApp({
      now: () => NOW,
      fetch: async () => new Response(JSON.stringify({ keys: [key.publicKey] }), { status: 200 }),
    });
    const response = await application.request(
      "https://localhost/healthz",
      { headers: { "Cf-Access-Jwt-Assertion": assertion } },
      {
        ADMIN_HOST: "localhost",
        ACCESS_TEAM_DOMAIN: ACCESS_DOMAIN,
        ACCESS_AUD: ACCESS_AUDIENCE,
      },
    );

    await expectAuthInvalid(response);
  });

  it("rejects a correctly shaped assertion with the wrong signature", async () => {
    const signingKey = await createSigningKey("signature-key");
    const otherKey = await createSigningKey("signature-key");
    const assertion = await signingKey.sign({
      iss: ACCESS_ISSUER,
      aud: ACCESS_AUDIENCE,
      exp: NOW / 1000 + 300,
    });
    const application = createAdminApp({
      now: () => NOW,
      fetch: async () =>
        new Response(JSON.stringify({ keys: [otherKey.publicKey] }), { status: 200 }),
    });
    const response = await application.request(
      "https://localhost/healthz",
      { headers: { "Cf-Access-Jwt-Assertion": assertion } },
      {
        ADMIN_HOST: "localhost",
        ACCESS_TEAM_DOMAIN: ACCESS_DOMAIN,
        ACCESS_AUD: ACCESS_AUDIENCE,
      },
    );

    await expectAuthInvalid(response);
  });

  it("fails closed when the JWKS endpoint is not OK", async () => {
    const key = await createSigningKey("fetch-error-key");
    const assertion = await key.sign({
      iss: ACCESS_ISSUER,
      aud: ACCESS_AUDIENCE,
      exp: NOW / 1000 + 300,
    });
    const application = createAdminApp({
      now: () => NOW,
      fetch: async () => new Response(null, { status: 503 }),
    });
    const response = await application.request(
      "https://localhost/healthz",
      { headers: { "Cf-Access-Jwt-Assertion": assertion } },
      {
        ADMIN_HOST: "localhost",
        ACCESS_TEAM_DOMAIN: ACCESS_DOMAIN,
        ACCESS_AUD: ACCESS_AUDIENCE,
      },
    );

    await expectAuthInvalid(response);
  });

  it("fails closed when the JWKS response is malformed", async () => {
    const key = await createSigningKey("malformed-jwks-key");
    const assertion = await key.sign({
      iss: ACCESS_ISSUER,
      aud: ACCESS_AUDIENCE,
      exp: NOW / 1000 + 300,
    });
    const application = createAdminApp({
      now: () => NOW,
      fetch: async () =>
        new Response(JSON.stringify({ keys: [{ kid: key.publicKey.kid }] }), { status: 200 }),
    });
    const response = await application.request(
      "https://localhost/healthz",
      { headers: { "Cf-Access-Jwt-Assertion": assertion } },
      {
        ADMIN_HOST: "localhost",
        ACCESS_TEAM_DOMAIN: ACCESS_DOMAIN,
        ACCESS_AUD: ACCESS_AUDIENCE,
      },
    );

    await expectAuthInvalid(response);
  });

  it("fails closed when the JWKS response has no matching key", async () => {
    const signingKey = await createSigningKey("missing-jwks-key");
    const otherKey = await createSigningKey("other-jwks-key");
    const assertion = await signingKey.sign({
      iss: ACCESS_ISSUER,
      aud: ACCESS_AUDIENCE,
      exp: NOW / 1000 + 300,
    });
    const application = createAdminApp({
      now: () => NOW,
      fetch: async () =>
        new Response(JSON.stringify({ keys: [otherKey.publicKey] }), { status: 200 }),
    });
    const response = await application.request(
      "https://localhost/healthz",
      { headers: { "Cf-Access-Jwt-Assertion": assertion } },
      {
        ADMIN_HOST: "localhost",
        ACCESS_TEAM_DOMAIN: ACCESS_DOMAIN,
        ACCESS_AUD: ACCESS_AUDIENCE,
      },
    );

    await expectAuthInvalid(response);
  });

  it("uses a cached JWKS response within the bounded cache window", async () => {
    const key = await createSigningKey("cache-hit-key");
    const assertion = await key.sign({
      iss: ACCESS_ISSUER,
      aud: ACCESS_AUDIENCE,
      exp: NOW / 1000 + 300,
    });
    let fetchCount = 0;
    const application = createAdminApp({
      now: () => NOW,
      fetch: async () => {
        fetchCount += 1;
        return new Response(JSON.stringify({ keys: [key.publicKey] }), { status: 200 });
      },
    });
    const request = () =>
      application.request(
        "https://localhost/healthz",
        { headers: { "Cf-Access-Jwt-Assertion": assertion } },
        {
          ADMIN_HOST: "localhost",
          ACCESS_TEAM_DOMAIN: ACCESS_DOMAIN,
          ACCESS_AUD: ACCESS_AUDIENCE,
        },
      );

    const firstResponse = await request();
    const secondResponse = await request();

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(fetchCount).toBe(1);
  });

  it("refreshes an expired JWKS cache before verifying", async () => {
    const key = await createSigningKey("cache-expiry-key");
    const assertion = await key.sign({
      iss: ACCESS_ISSUER,
      aud: ACCESS_AUDIENCE,
      exp: NOW / 1000 + 900,
    });
    let currentTime = NOW;
    let fetchCount = 0;
    const application = createAdminApp({
      now: () => currentTime,
      fetch: async () => {
        fetchCount += 1;
        return new Response(JSON.stringify({ keys: [key.publicKey] }), { status: 200 });
      },
    });
    const request = () =>
      application.request(
        "https://localhost/healthz",
        { headers: { "Cf-Access-Jwt-Assertion": assertion } },
        {
          ADMIN_HOST: "localhost",
          ACCESS_TEAM_DOMAIN: ACCESS_DOMAIN,
          ACCESS_AUD: ACCESS_AUDIENCE,
        },
      );

    expect((await request()).status).toBe(200);
    currentTime += 5 * 60 * 1000 + 1;
    expect((await request()).status).toBe(200);
    expect(fetchCount).toBe(2);
  });

  it("refreshes cached JWKS keys when a rotated kid is encountered", async () => {
    const oldKey = await createSigningKey("rotation-old-key");
    const newKey = await createSigningKey("rotation-new-key");
    const oldAssertion = await oldKey.sign({
      iss: ACCESS_ISSUER,
      aud: ACCESS_AUDIENCE,
      exp: NOW / 1000 + 900,
    });
    const newAssertion = await newKey.sign({
      iss: ACCESS_ISSUER,
      aud: ACCESS_AUDIENCE,
      exp: NOW / 1000 + 900,
    });
    let fetchCount = 0;
    const application = createAdminApp({
      now: () => NOW,
      fetch: async () => {
        fetchCount += 1;
        const keys = fetchCount === 1 ? [oldKey.publicKey] : [newKey.publicKey];
        return new Response(JSON.stringify({ keys }), { status: 200 });
      },
    });
    const request = (assertion: string) =>
      application.request(
        "https://localhost/healthz",
        { headers: { "Cf-Access-Jwt-Assertion": assertion } },
        {
          ADMIN_HOST: "localhost",
          ACCESS_TEAM_DOMAIN: ACCESS_DOMAIN,
          ACCESS_AUD: ACCESS_AUDIENCE,
        },
      );

    expect((await request(oldAssertion)).status).toBe(200);
    expect((await request(newAssertion)).status).toBe(200);
    expect(fetchCount).toBe(2);
  });

  it("rate limits forced JWKS refreshes for distinct unknown key IDs", async () => {
    const knownKey = await createSigningKey("known-key");
    const firstUnknownKey = await createSigningKey("first-unknown-key");
    const secondUnknownKey = await createSigningKey("second-unknown-key");
    const payload = {
      iss: ACCESS_ISSUER,
      aud: ACCESS_AUDIENCE,
      exp: NOW / 1000 + 900,
    };
    const knownAssertion = await knownKey.sign(payload);
    const firstUnknownAssertion = await firstUnknownKey.sign(payload);
    const secondUnknownAssertion = await secondUnknownKey.sign(payload);
    let currentTime = NOW;
    let fetchCount = 0;
    const application = createAdminApp({
      now: () => currentTime,
      fetch: async () => {
        fetchCount += 1;
        return new Response(JSON.stringify({ keys: [knownKey.publicKey] }), { status: 200 });
      },
    });
    const request = (assertion: string) =>
      application.request(
        "https://localhost/healthz",
        { headers: { "Cf-Access-Jwt-Assertion": assertion } },
        ACCESS_BINDINGS,
      );

    expect((await request(knownAssertion)).status).toBe(200);
    await expectAuthInvalid(await request(firstUnknownAssertion));
    expect(fetchCount).toBe(2);

    await expectAuthInvalid(await request(secondUnknownAssertion));
    expect(fetchCount).toBe(2);

    currentTime += 60 * 1000;
    await expectAuthInvalid(await request(secondUnknownAssertion));
    expect(fetchCount).toBe(3);
  });

  it("does not use stale keys when rotation refresh fails", async () => {
    const oldKey = await createSigningKey("stale-old-key");
    const newKey = await createSigningKey("stale-new-key");
    const otherNewKey = await createSigningKey("stale-other-new-key");
    const oldAssertion = await oldKey.sign({
      iss: ACCESS_ISSUER,
      aud: ACCESS_AUDIENCE,
      exp: NOW / 1000 + 900,
    });
    const newAssertion = await newKey.sign({
      iss: ACCESS_ISSUER,
      aud: ACCESS_AUDIENCE,
      exp: NOW / 1000 + 900,
    });
    const otherNewAssertion = await otherNewKey.sign({
      iss: ACCESS_ISSUER,
      aud: ACCESS_AUDIENCE,
      exp: NOW / 1000 + 900,
    });
    let fetchCount = 0;
    const application = createAdminApp({
      now: () => NOW,
      fetch: async () => {
        fetchCount += 1;
        if (fetchCount > 1) {
          throw new Error("refresh unavailable");
        }
        return new Response(JSON.stringify({ keys: [oldKey.publicKey] }), { status: 200 });
      },
    });
    const request = (assertion: string) =>
      application.request(
        "https://localhost/healthz",
        { headers: { "Cf-Access-Jwt-Assertion": assertion } },
        {
          ADMIN_HOST: "localhost",
          ACCESS_TEAM_DOMAIN: ACCESS_DOMAIN,
          ACCESS_AUD: ACCESS_AUDIENCE,
        },
      );

    expect((await request(oldAssertion)).status).toBe(200);
    expect((await request(newAssertion)).status).toBe(401);
    expect((await request(otherNewAssertion)).status).toBe(401);
    expect(fetchCount).toBe(2);
  });

  it("checks the request host before attempting JWKS fetches", async () => {
    const key = await createSigningKey("host-fence-key");
    const assertion = await key.sign({
      iss: ACCESS_ISSUER,
      aud: ACCESS_AUDIENCE,
      exp: NOW / 1000 + 300,
    });
    let fetchCount = 0;
    const application = createAdminApp({
      now: () => NOW,
      fetch: async () => {
        fetchCount += 1;
        return new Response(JSON.stringify({ keys: [key.publicKey] }), { status: 200 });
      },
    });
    const response = await application.request(
      "https://admin.example.test/healthz",
      { headers: { "Cf-Access-Jwt-Assertion": assertion, "X-Forwarded-Host": "localhost" } },
      {
        ADMIN_HOST: "localhost",
        ACCESS_TEAM_DOMAIN: ACCESS_DOMAIN,
        ACCESS_AUD: ACCESS_AUDIENCE,
      },
    );

    expect(response.status).toBe(404);
    expect(fetchCount).toBe(0);
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
    const key = await createSigningKey("forwarded-host-key");
    const assertion = await key.sign({
      iss: ACCESS_ISSUER,
      aud: ACCESS_AUDIENCE,
      exp: NOW / 1000 + 300,
    });
    const application = createAdminApp({
      now: () => NOW,
      fetch: async () => new Response(JSON.stringify({ keys: [key.publicKey] }), { status: 200 }),
    });
    const response = await application.request(
      "https://localhost/healthz",
      {
        headers: {
          "Cf-Access-Jwt-Assertion": assertion,
          "X-Forwarded-Host": "admin.example.test",
        },
      },
      {
        ADMIN_HOST: "localhost",
        ACCESS_TEAM_DOMAIN: ACCESS_DOMAIN,
        ACCESS_AUD: ACCESS_AUDIENCE,
      },
    );

    expect(response.status).toBe(200);
  });

  it("fails closed when the admin host is empty", async () => {
    const response = await app.request("https://localhost/healthz", undefined, {
      ADMIN_HOST: "",
    });

    expect(response.status).toBe(404);
  });

  it("round trips editorial mutations through Access, the Worker, and local D1", async () => {
    const key = await createSigningKey("editorial-round-trip-key");
    const ids = [
      "0192f5a4-7b3c-7d1e-8f20-123456789ac1",
      "0192f5a4-7b3c-7d1e-8f20-123456789ac2",
      "0192f5a4-7b3c-7d1e-8f20-123456789ac3",
      "0192f5a4-7b3c-7d1e-8f20-123456789ac4",
      "0192f5a4-7b3c-7d1e-8f20-123456789ac5",
      "0192f5a4-7b3c-7d1e-8f20-123456789ac6",
      "0192f5a4-7b3c-7d1e-8f20-123456789ac7",
      "0192f5a4-7b3c-7d1e-8f20-123456789ac8",
      "0192f5a4-7b3c-7d1e-8f20-123456789ac9",
      "0192f5a4-7b3c-7d1e-8f20-123456789aca",
      "0192f5a4-7b3c-7d1e-8f20-123456789acb",
      "0192f5a4-7b3c-7d1e-8f20-123456789acc",
      "0192f5a4-7b3c-7d1e-8f20-123456789acd",
      "0192f5a4-7b3c-7d1e-8f20-123456789ace",
      "0192f5a4-7b3c-7d1e-8f20-123456789acf",
      "0192f5a4-7b3c-7d1e-8f20-123456789ad0",
      "0192f5a4-7b3c-7d1e-8f20-123456789ad1",
      "0192f5a4-7b3c-7d1e-8f20-123456789ad2",
      "0192f5a4-7b3c-7d1e-8f20-123456789ad3",
      "0192f5a4-7b3c-7d1e-8f20-123456789ad4",
      "0192f5a4-7b3c-7d1e-8f20-123456789ad5",
      "0192f5a4-7b3c-7d1e-8f20-123456789ad6",
      "0192f5a4-7b3c-7d1e-8f20-123456789ad7",
      "0192f5a4-7b3c-7d1e-8f20-123456789ad8",
      "0192f5a4-7b3c-7d1e-8f20-123456789ad9",
      "0192f5a4-7b3c-7d1e-8f20-123456789ada",
    ];
    const application = createAdminApp({
      now: () => NOW,
      uuidv7: () => {
        const id = ids.shift();
        if (id === undefined) throw new Error("test UUID sequence exhausted");
        return id;
      },
      fetch: async () => new Response(JSON.stringify({ keys: [key.publicKey] }), { status: 200 }),
    });
    const assertion = await key.sign({
      iss: ACCESS_ISSUER,
      aud: ACCESS_AUDIENCE,
      exp: NOW / 1000 + 300,
      sub: "editorial-author-subject",
      email: "author@example.test",
    });
    const request = (path: string, init: RequestInit = {}) =>
      application.request(
        `https://localhost${path}`,
        {
          ...init,
          headers: {
            "Cf-Access-Jwt-Assertion": assertion,
            ...(init.body === undefined
              ? {}
              : {
                  "Content-Type": "application/json",
                  Origin: "https://localhost",
                  "X-TinyCMS-Request": "1",
                }),
            ...init.headers,
          },
        },
        DB_BINDINGS,
      );

    const document = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Initial" }] }],
    };
    const createdResponse = await request("/api/v1/admin/posts", {
      method: "POST",
      body: JSON.stringify({ title: "Round trip", contentVersion: 1, content: document }),
    });
    expect(createdResponse.status).toBe(200);
    const createdBody = (await createdResponse.json()) as {
      data: { id: string; slug: string; draftVersion: number; currentRevisionVersion: number };
    };
    expect(createdBody.data).toMatchObject({
      slug: "round-trip",
      draftVersion: 1,
      currentRevisionVersion: 1,
    });
    const postId = createdBody.data.id;

    await expect(request(`/api/v1/admin/posts/${postId}`)).resolves.toMatchObject({ status: 200 });

    const savedResponse = await request(`/api/v1/admin/posts/${postId}/draft`, {
      method: "PUT",
      body: JSON.stringify({
        expectedDraftVersion: 1,
        title: "Saved title",
        contentVersion: 1,
        content: document,
      }),
    });
    expect(savedResponse.status).toBe(200);
    const savedBody = (await savedResponse.json()) as { data: { draftVersion: number } };
    expect(savedBody.data.draftVersion).toBe(2);

    const staleSave = await request(`/api/v1/admin/posts/${postId}/draft`, {
      method: "PUT",
      body: JSON.stringify({
        expectedDraftVersion: 1,
        title: "Stale title",
        contentVersion: 1,
        content: document,
      }),
    });
    expect(staleSave.status).toBe(409);
    expect(await staleSave.json()).toMatchObject({ error: { code: "CONFLICT" } });

    const checkpointResponse = await request(`/api/v1/admin/posts/${postId}/revisions`, {
      method: "POST",
      body: JSON.stringify({ expectedDraftVersion: 2, expectedRevisionVersion: 1 }),
    });
    expect(checkpointResponse.status).toBe(200);
    const checkpointBody = (await checkpointResponse.json()) as {
      data: { revision: { revisionVersion: number; title: string } };
    };
    expect(checkpointBody.data.revision).toMatchObject({
      revisionVersion: 2,
      title: "Saved title",
    });

    const staleCheckpoint = await request(`/api/v1/admin/posts/${postId}/revisions`, {
      method: "POST",
      body: JSON.stringify({ expectedDraftVersion: 2, expectedRevisionVersion: 1 }),
    });
    expect(staleCheckpoint.status).toBe(409);
    expect(await staleCheckpoint.json()).toMatchObject({ error: { code: "CONFLICT" } });
    const revisionCountAfterStaleCheckpoint = await env.CMS_DB.prepare(
      "SELECT COUNT(*) AS count FROM post_revisions WHERE post_id = ?",
    )
      .bind(postId)
      .first<{ count: number }>();
    expect(revisionCountAfterStaleCheckpoint?.count).toBe(2);

    const firstRevisionPage = await request(`/api/v1/admin/posts/${postId}/revisions?limit=1`);
    expect(firstRevisionPage.status).toBe(200);
    const firstRevisionBody = (await firstRevisionPage.json()) as {
      data: { items: Array<{ revisionVersion: number }>; nextCursor: string | null };
    };
    expect(firstRevisionBody.data.items).toHaveLength(1);
    expect(firstRevisionBody.data.items[0]).toMatchObject({ revisionVersion: 2 });
    expect(firstRevisionBody.data.nextCursor).toEqual(expect.any(String));
    expect(firstRevisionBody.data.nextCursor).not.toContain("revisionVersion");
    const secondRevisionPage = await request(
      `/api/v1/admin/posts/${postId}/revisions?limit=1&cursor=${encodeURIComponent(firstRevisionBody.data.nextCursor as string)}`,
    );
    expect(secondRevisionPage.status).toBe(200);
    const secondRevisionBody = (await secondRevisionPage.json()) as {
      data: { items: Array<{ revisionVersion: number }> };
    };
    expect(secondRevisionBody.data.items).toHaveLength(1);
    expect(secondRevisionBody.data.items[0]).toMatchObject({ revisionVersion: 1 });

    const restoredResponse = await request(
      `/api/v1/admin/posts/${postId}/revisions/${(await env.CMS_DB.prepare("SELECT id FROM post_revisions WHERE post_id = ? AND version = 1").bind(postId).first<{ id: string }>())?.id}/restore`,
      {
        method: "POST",
        body: JSON.stringify({ expectedDraftVersion: 2, expectedRevisionVersion: 2 }),
      },
    );
    expect(restoredResponse.status).toBe(200);
    const restoredBody = (await restoredResponse.json()) as {
      data: { post: { draftVersion: number } };
    };
    expect(restoredBody.data.post.draftVersion).toBe(3);

    const countRows = async () =>
      Promise.all(
        ["authors", "posts", "post_revisions", "post_drafts"].map(async (table) => {
          const row = await env.CMS_DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{
            count: number;
          }>();
          return row?.count ?? 0;
        }),
      );
    const rowsBeforeDuplicate = await countRows();
    const duplicateSlugResponse = await request("/api/v1/admin/posts", {
      method: "POST",
      body: JSON.stringify({
        slug: "round-trip",
        title: "A different title",
        contentVersion: 1,
        content: document,
      }),
    });
    expect(duplicateSlugResponse.status).toBe(409);
    expect(await duplicateSlugResponse.json()).toMatchObject({ error: { code: "CONFLICT" } });
    expect(await countRows()).toEqual(rowsBeforeDuplicate);

    const secondPostResponse = await request("/api/v1/admin/posts", {
      method: "POST",
      body: JSON.stringify({ title: "Second post", contentVersion: 1, content: document }),
    });
    expect(secondPostResponse.status).toBe(200);
    const secondPostBody = (await secondPostResponse.json()) as { data: { id: string } };
    const firstRevision = await env.CMS_DB.prepare(
      "SELECT id FROM post_revisions WHERE post_id = ? AND version = 1",
    )
      .bind(postId)
      .first<{ id: string }>();
    const crossPostRestore = await request(
      `/api/v1/admin/posts/${secondPostBody.data.id}/revisions/${firstRevision?.id}/restore`,
      {
        method: "POST",
        body: JSON.stringify({ expectedDraftVersion: 1, expectedRevisionVersion: 1 }),
      },
    );
    expect(crossPostRestore.status).toBe(404);
    expect(await crossPostRestore.json()).toMatchObject({ error: { code: "NOT_FOUND" } });

    const firstPostPage = await request("/api/v1/admin/posts?limit=1");
    expect(firstPostPage.status).toBe(200);
    const firstPostPageBody = (await firstPostPage.json()) as {
      data: { items: Array<{ slug: string }>; nextCursor: string | null };
    };
    expect(firstPostPageBody.data.items).toHaveLength(1);
    expect(firstPostPageBody.data.items[0]?.slug).toBe("second-post");
    expect(firstPostPageBody.data.nextCursor).toEqual(expect.any(String));
    expect(firstPostPageBody.data.nextCursor).not.toContain("updatedAt");
    const secondPostPage = await request(
      `/api/v1/admin/posts?limit=1&cursor=${encodeURIComponent(firstPostPageBody.data.nextCursor as string)}`,
    );
    expect(secondPostPage.status).toBe(200);
    const secondPostPageBody = (await secondPostPage.json()) as {
      data: { items: Array<{ slug: string }>; nextCursor: string | null };
    };
    expect(secondPostPageBody.data.items).toHaveLength(1);
    expect(secondPostPageBody.data.items[0]?.slug).toBe("round-trip");
    expect(secondPostPageBody.data.nextCursor).toBeNull();

    const authorCount = await env.CMS_DB.prepare(
      "SELECT COUNT(*) AS count FROM authors WHERE access_subject = ?",
    )
      .bind("editorial-author-subject")
      .first<{ count: number }>();
    expect(authorCount?.count).toBe(1);
    const author = await env.CMS_DB.prepare(
      "SELECT display_name AS displayName, email FROM authors WHERE access_subject = ?",
    )
      .bind("editorial-author-subject")
      .first<{ displayName: string; email: string | null }>();
    expect(author).toMatchObject({
      displayName: "author@example.test",
      email: "author@example.test",
    });

    const fallbackFirstResponse = await request("/api/v1/admin/posts", {
      method: "POST",
      body: JSON.stringify({ title: "日本語の投稿" }),
    });
    expect(fallbackFirstResponse.status).toBe(200);
    const fallbackFirstBody = (await fallbackFirstResponse.json()) as {
      data: { id: string; slug: string };
    };
    expect(fallbackFirstBody.data.slug).toBe(`post-${fallbackFirstBody.data.id}`);

    const fallbackSecondResponse = await request("/api/v1/admin/posts", {
      method: "POST",
      body: JSON.stringify({ title: "別の日本語" }),
    });
    expect(fallbackSecondResponse.status).toBe(200);
    const fallbackSecondBody = (await fallbackSecondResponse.json()) as {
      data: { id: string; slug: string };
    };
    expect(fallbackSecondBody.data.slug).toBe(`post-${fallbackSecondBody.data.id}`);
    expect(fallbackSecondBody.data.slug).not.toBe(fallbackFirstBody.data.slug);
  });

  it("round trips editorial workflows through the typed editorial client", async () => {
    const key = await createSigningKey("editorial-client-key");
    const assertion = await key.sign({
      iss: ACCESS_ISSUER,
      aud: ACCESS_AUDIENCE,
      exp: NOW / 1000 + 300,
      sub: "editorial-author-subject",
      email: "author@example.test",
    });
    const ids = [
      "0194b2f5-8e9b-7a34-8f99-111111111111",
      "0194b2f5-8e9b-7a34-8f99-222222222222",
      "0194b2f5-8e9b-7a34-8f99-333333333333",
      "0194b2f5-8e9b-7a34-8f99-444444444444",
      "0194b2f5-8e9b-7a34-8f99-555555555555",
      "0194b2f5-8e9b-7a34-8f99-666666666666",
      "0194b2f5-8e9b-7a34-8f99-777777777777",
      "0194b2f5-8e9b-7a34-8f99-888888888888",
      "0194b2f5-8e9b-7a34-8f99-999999999999",
      "0194b2f5-8e9b-7a34-8f99-aaaaaaaaaaaa",
    ];
    const application = createAdminApp({
      now: () => NOW,
      uuidv7: () => {
        const id = ids.shift();
        if (id === undefined) {
          throw new Error("test UUID sequence exhausted");
        }
        return id;
      },
      fetch: async () => new Response(JSON.stringify({ keys: [key.publicKey] }), { status: 200 }),
    });
    const api = createEditorialApi({
      fetcher: async (path, init = {}) => {
        const resolved =
          typeof path === "string" && !/^https?:\/\//.test(path)
            ? `https://localhost${path}`
            : String(path);
        const headers = new Headers(init.headers);
        headers.set("Cf-Access-Jwt-Assertion", assertion);
        if (init.body !== undefined && init.body !== null) {
          headers.set("Origin", "https://localhost");
        }
        return application.request(resolved, { ...init, headers }, DB_BINDINGS);
      },
    });
    const document = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Editorial client test" }] }],
    };

    const beforePosts = await api.listPosts();

    const created = await api.createPost({
      title: "Client post",
      contentVersion: 1,
      content: document,
    });
    expect(created.slug).toBe("client-post");
    expect(created.draftVersion).toBe(1);
    expect(created.currentRevisionVersion).toBe(1);

    const loaded = await api.getPost(created.id);
    expect(loaded.id).toBe(created.id);
    expect(loaded.title).toBe("Client post");
    expect(loaded.currentRevisionVersion).toBe(created.currentRevisionVersion);

    const updated = await api.saveDraft(created.id, {
      expectedDraftVersion: created.draftVersion,
      title: "Client post updated",
      contentVersion: 1,
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Saved content" }] }],
      },
    });
    expect(updated.draftVersion).toBe(2);
    expect(updated.title).toBe("Client post updated");
    expect(updated.currentRevisionVersion).toBe(1);

    await expect(
      api.saveDraft(created.id, {
        expectedDraftVersion: created.draftVersion,
        title: "Stale save",
        contentVersion: 1,
        content: document,
      }),
    ).rejects.toSatisfy(isEditorialConflict);

    const revisionsAfterDraft = await api.listRevisions(created.id, { limit: 2 });
    expect(revisionsAfterDraft.items).toHaveLength(1);
    expect(revisionsAfterDraft.items[0]?.revisionVersion).toBe(1);

    const draftState = await env.CMS_DB.prepare(
      "SELECT version, title FROM post_drafts WHERE post_id = ?",
    )
      .bind(created.id)
      .first<{ version: number; title: string }>();
    expect(draftState).toMatchObject({ version: 2, title: "Client post updated" });
    const revisionState = await env.CMS_DB.prepare(
      "SELECT version FROM post_revisions WHERE post_id = ? ORDER BY version",
    )
      .bind(created.id)
      .all<{ version: number }>();
    expect(revisionState.results).toEqual([{ version: 1 }]);

    const checkpointed = await api.checkpointRevision(created.id, {
      expectedDraftVersion: updated.draftVersion,
      expectedRevisionVersion:
        updated.currentRevisionVersion ??
        (() => {
          throw new Error("Expected currentRevisionVersion to be present");
        })(),
    });
    expect(checkpointed.revision.revisionVersion).toBe(2);
    expect(checkpointed.post.currentRevisionVersion).toBe(2);
    expect(checkpointed.post.draftVersion).toBe(2);

    const revisionsAfterCheckpoint = await api.listRevisions(created.id, { limit: 2 });
    expect(revisionsAfterCheckpoint.items).toHaveLength(2);
    expect(revisionsAfterCheckpoint.items[0]?.revisionVersion).toBe(2);
    expect(revisionsAfterCheckpoint.items[1]?.revisionVersion).toBe(1);

    const restoreTargetRevision = revisionsAfterCheckpoint.items[1];
    if (restoreTargetRevision === undefined) {
      throw new Error("Expected a revision to restore");
    }

    const restored = await api.restoreRevision(created.id, restoreTargetRevision.id, {
      expectedDraftVersion: checkpointed.post.draftVersion,
      expectedRevisionVersion: checkpointed.revision.revisionVersion,
    });
    expect(restored.post.draftVersion).toBe(3);
    expect(restored.revision.revisionVersion).toBeGreaterThan(
      checkpointed.revision.revisionVersion,
    );
    expect(restored.post.title).toBe("Client post");

    const final = await api.getPost(created.id);
    expect(final.title).toBe("Client post");
    expect(final.draftVersion).toBe(3);
    const afterPosts = await api.listPosts();
    expect(afterPosts.items.length).toBe(beforePosts.items.length + 1);
  });

  it("rejects each invalid browser write boundary before D1", async () => {
    const key = await createSigningKey("boundary-key");
    const application = createAdminApp({
      now: () => NOW,
      fetch: async () => new Response(JSON.stringify({ keys: [key.publicKey] }), { status: 200 }),
    });
    const assertion = await key.sign({
      iss: ACCESS_ISSUER,
      aud: ACCESS_AUDIENCE,
      exp: NOW / 1000 + 300,
      sub: "boundary-subject",
    });
    const validBoundary = {
      "Content-Type": "application/json",
      Origin: "https://localhost",
      "X-TinyCMS-Request": "1",
    };
    const cases = [
      {
        name: "non-JSON content type",
        headers: { ...validBoundary, "Content-Type": "text/plain" },
      },
      {
        name: "missing marker",
        headers: { "Content-Type": validBoundary["Content-Type"], Origin: validBoundary.Origin },
      },
      {
        name: "wrong marker",
        headers: { ...validBoundary, "X-TinyCMS-Request": "0" },
      },
      {
        name: "missing origin",
        headers: { "Content-Type": validBoundary["Content-Type"], "X-TinyCMS-Request": "1" },
      },
      {
        name: "wrong origin",
        headers: { ...validBoundary, Origin: "https://evil.example.test" },
      },
    ] as const;
    for (const testCase of cases) {
      const before = await env.CMS_DB.prepare("SELECT COUNT(*) AS count FROM posts").first<{
        count: number;
      }>();
      const response = await application.request(
        "https://localhost/api/v1/admin/posts",
        {
          method: "POST",
          headers: { "Cf-Access-Jwt-Assertion": assertion, ...testCase.headers },
          body: JSON.stringify({ title: `Rejected ${testCase.name}` }),
        },
        DB_BINDINGS,
      );
      expect(response.status, testCase.name).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
      const after = await env.CMS_DB.prepare("SELECT COUNT(*) AS count FROM posts").first<{
        count: number;
      }>();
      expect(after?.count, testCase.name).toBe(before?.count);
    }

    const malformedJson = await application.request(
      "https://localhost/api/v1/admin/posts",
      {
        method: "POST",
        headers: { "Cf-Access-Jwt-Assertion": assertion, ...validBoundary },
        body: "not-json",
      },
      DB_BINDINGS,
    );
    expect(malformedJson.status).toBe(400);

    const oversizedBody = await application.request(
      "https://localhost/api/v1/admin/posts",
      {
        method: "POST",
        headers: {
          "Cf-Access-Jwt-Assertion": assertion,
          ...validBoundary,
          "Content-Length": "1048577",
        },
        body: "{}",
      },
      DB_BINDINGS,
    );
    expect(oversizedBody.status).toBe(400);

    const invalidContent = await application.request(
      "https://localhost/api/v1/admin/posts",
      {
        method: "POST",
        headers: { "Cf-Access-Jwt-Assertion": assertion, ...validBoundary },
        body: JSON.stringify({ contentVersion: 1, content: { type: "script" } }),
      },
      DB_BINDINGS,
    );
    expect(invalidContent.status).toBe(400);

    const invalidCursor = await application.request(
      "https://localhost/api/v1/admin/posts?cursor=not-an-opaque-cursor",
      { headers: { "Cf-Access-Jwt-Assertion": assertion } },
      DB_BINDINGS,
    );
    expect(invalidCursor.status).toBe(400);
    expect(await invalidCursor.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });

    const malformedParams = await application.request(
      "https://localhost/api/v1/admin/posts/not-a-uuid",
      { headers: { "Cf-Access-Jwt-Assertion": assertion } },
      DB_BINDINGS,
    );
    expect(malformedParams.status).toBe(400);
    expect(await malformedParams.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });

    const overLimit = await application.request(
      "https://localhost/api/v1/admin/posts?limit=101",
      { headers: { "Cf-Access-Jwt-Assertion": assertion } },
      DB_BINDINGS,
    );
    expect(overLimit.status).toBe(400);

    const missingPost = await application.request(
      "https://localhost/api/v1/admin/posts/0192f5a4-7b3c-7d1e-8f20-ffffffffffff",
      { headers: { "Cf-Access-Jwt-Assertion": assertion } },
      DB_BINDINGS,
    );
    expect(missingPost.status).toBe(404);
    expect(await missingPost.json()).toMatchObject({ error: { code: "NOT_FOUND" } });

    const corruptionCreate = await application.request(
      "https://localhost/api/v1/admin/posts",
      {
        method: "POST",
        headers: { "Cf-Access-Jwt-Assertion": assertion, ...validBoundary },
        body: JSON.stringify({ title: "Corrupted stored content" }),
      },
      DB_BINDINGS,
    );
    expect(corruptionCreate.status).toBe(200);
    const corruptionBody = (await corruptionCreate.json()) as { data: { id: string } };
    await env.CMS_DB.prepare("UPDATE post_drafts SET content_json = ? WHERE post_id = ?")
      .bind('{"type":"script"}', corruptionBody.data.id)
      .run();
    const corruptedRead = await application.request(
      `https://localhost/api/v1/admin/posts/${corruptionBody.data.id}`,
      { headers: { "Cf-Access-Jwt-Assertion": assertion } },
      DB_BINDINGS,
    );
    expect(corruptedRead.status).toBe(500);
    const corruptedResponseBody = await corruptedRead.json();
    expect(corruptedResponseBody).toMatchObject({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
    expect(JSON.stringify(corruptedResponseBody)).not.toContain("Stored content");
  });

  it("requires a nonempty Access subject", async () => {
    const key = await createSigningKey("missing-subject-key");
    const assertion = await key.sign({
      iss: ACCESS_ISSUER,
      aud: ACCESS_AUDIENCE,
      exp: NOW / 1000 + 300,
      sub: "",
    });
    const application = createAdminApp({
      now: () => NOW,
      fetch: async () => new Response(JSON.stringify({ keys: [key.publicKey] }), { status: 200 }),
    });
    const response = await application.request(
      "https://localhost/healthz",
      { headers: { "Cf-Access-Jwt-Assertion": assertion } },
      ACCESS_BINDINGS,
    );
    await expectAuthInvalid(response);
  });
});
