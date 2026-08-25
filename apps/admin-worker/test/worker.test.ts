import { exports } from "cloudflare:workers";
import type { HonoJsonWebKey } from "hono/utils/jwt/jws";
import { sign } from "hono/utils/jwt/jwt";
import { describe, expect, it } from "vitest";
import { app, createAdminApp } from "../src/index";

const ACCESS_DOMAIN = "team.cloudflareaccess.com";
const ACCESS_ISSUER = `https://${ACCESS_DOMAIN}`;
const ACCESS_AUDIENCE = "test-access-audience";
const NOW = 1_700_000_000_000;

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
    sign: (payload: Parameters<typeof sign>[0]) => sign(payload, privateKey, "RS256"),
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

describe("admin worker", () => {
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
    const response = await exports.default.fetch("https://localhost/healthz", {
      headers: { "Cf-Access-Jwt-Assertion": "not-a-jwt" },
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

  it("rejects an assertion with invalid JWT parts", async () => {
    const response = await exports.default.fetch("https://localhost/healthz", {
      headers: { "Cf-Access-Jwt-Assertion": "aaa.bbb.ccc" },
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

  it("rejects an assertion that is not RS256", async () => {
    const assertion = await sign(
      { exp: Math.floor(Date.now() / 1000) + 300 },
      "test-secret",
      "HS256",
    );
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

  it("does not use stale keys when rotation refresh fails", async () => {
    const oldKey = await createSigningKey("stale-old-key");
    const newKey = await createSigningKey("stale-new-key");
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
});
