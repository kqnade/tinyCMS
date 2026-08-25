import { errorResponse, successResponse } from "@tinycms/contracts";
import { Hono } from "hono";
import type { HonoJsonWebKey } from "hono/utils/jwt/jws";
import { decodeHeader, verify } from "hono/utils/jwt/jwt";
import type { JWTPayload } from "hono/utils/jwt/types";

const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TEAM_DOMAIN_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+cloudflareaccess\.com$/;

type AdminWorker = {
  Bindings: {
    ADMIN_HOST: string;
    ACCESS_TEAM_DOMAIN?: string;
    ACCESS_AUD?: string;
  };
  Variables: {
    requestId: string;
  };
};

type AccessDependencies = {
  fetch?: typeof fetch;
  now?: () => number;
};

type AccessConfig = {
  issuer: string;
  jwksUrl: string;
  audience: string;
};

type JwksCache = {
  expiresAt: number;
  jwksUrl: string;
  keys: HonoJsonWebKey[];
};

type LoadedJwks = {
  fromCache: boolean;
  keys: HonoJsonWebKey[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAccessJwk(value: unknown): value is HonoJsonWebKey {
  if (!isRecord(value)) {
    return false;
  }

  const keyOps = value.key_ops;

  return (
    value.kty === "RSA" &&
    typeof value.kid === "string" &&
    value.kid.length > 0 &&
    typeof value.n === "string" &&
    value.n.length > 0 &&
    typeof value.e === "string" &&
    value.e.length > 0 &&
    (value.alg === undefined || value.alg === "RS256") &&
    (value.use === undefined || value.use === "sig") &&
    (keyOps === undefined || (Array.isArray(keyOps) && keyOps.includes("verify")))
  );
}

function isJwksPayload(value: unknown): value is { keys: HonoJsonWebKey[] } {
  return isRecord(value) && Array.isArray(value.keys) && value.keys.every(isAccessJwk);
}

function getAccessConfig(bindings: AdminWorker["Bindings"]): AccessConfig | undefined {
  const teamDomain = bindings.ACCESS_TEAM_DOMAIN?.toLowerCase();
  const audience = bindings.ACCESS_AUD;

  if (
    !teamDomain ||
    !ACCESS_TEAM_DOMAIN_PATTERN.test(teamDomain) ||
    !audience ||
    audience.trim() !== audience
  ) {
    return undefined;
  }

  return {
    issuer: `https://${teamDomain}`,
    jwksUrl: `https://${teamDomain}/cdn-cgi/access/certs`,
    audience,
  };
}

function hasValidAccessClaims(payload: JWTPayload, config: AccessConfig, now: number): boolean {
  if (payload.iss !== config.issuer) {
    return false;
  }

  const audience = payload.aud;
  const hasAudience =
    typeof audience === "string"
      ? audience === config.audience
      : Array.isArray(audience) && audience.some((value) => value === config.audience);

  if (!hasAudience || typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
    return false;
  }

  const nowSeconds = Math.floor(now / 1000);

  if (payload.exp <= nowSeconds) {
    return false;
  }

  return (
    payload.nbf === undefined ||
    (typeof payload.nbf === "number" && Number.isFinite(payload.nbf) && payload.nbf <= nowSeconds)
  );
}

function createAccessVerifier(dependencies: AccessDependencies = {}) {
  const fetcher = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
  const now = dependencies.now ?? (() => Date.now());
  let cachedJwks: JwksCache | undefined;

  const loadJwks = async (config: AccessConfig, forceRefresh: boolean): Promise<LoadedJwks> => {
    const currentTime = now();

    if (
      !forceRefresh &&
      cachedJwks &&
      cachedJwks.jwksUrl === config.jwksUrl &&
      cachedJwks.expiresAt > currentTime
    ) {
      return { fromCache: true, keys: cachedJwks.keys };
    }

    const response = await fetcher(config.jwksUrl);

    if (!response.ok) {
      throw new Error("JWKS request failed");
    }

    const body: unknown = await response.json();

    if (!isJwksPayload(body)) {
      throw new Error("JWKS response is invalid");
    }

    cachedJwks = {
      expiresAt: currentTime + JWKS_CACHE_TTL_MS,
      jwksUrl: config.jwksUrl,
      keys: body.keys,
    };

    return { fromCache: false, keys: body.keys };
  };

  return async (assertion: string, bindings: AdminWorker["Bindings"]): Promise<boolean> => {
    const config = getAccessConfig(bindings);

    if (!config) {
      return false;
    }

    let header: ReturnType<typeof decodeHeader>;

    try {
      header = decodeHeader(assertion);
    } catch {
      return false;
    }

    if (header.alg !== "RS256" || typeof header.kid !== "string" || header.kid.length === 0) {
      return false;
    }

    let loadedJwks: LoadedJwks;

    try {
      loadedJwks = await loadJwks(config, false);
    } catch {
      return false;
    }

    let matchingKey = loadedJwks.keys.find((key) => key.kid === header.kid);

    if (!matchingKey && loadedJwks.fromCache) {
      try {
        loadedJwks = await loadJwks(config, true);
      } catch {
        return false;
      }

      matchingKey = loadedJwks.keys.find((key) => key.kid === header.kid);
    }

    if (!matchingKey) {
      return false;
    }

    try {
      const payload = await verify(assertion, matchingKey, {
        alg: "RS256",
        iss: config.issuer,
        aud: config.audience,
        exp: false,
        nbf: false,
        iat: false,
      });

      return hasValidAccessClaims(payload, config, now());
    } catch {
      return false;
    }
  };
}

export function createAdminApp(dependencies: AccessDependencies = {}) {
  const verifyAccessAssertion = createAccessVerifier(dependencies);
  const application = new Hono<AdminWorker>();

  application.use("*", async (context, next) => {
    const requestId = crypto.randomUUID();
    context.set("requestId", requestId);

    await next();

    context.header("X-Request-Id", requestId);
  });

  application.use("*", async (context, next) => {
    const configuredHost = context.env.ADMIN_HOST?.trim().toLowerCase();
    const requestHost = new URL(context.req.url).hostname.toLowerCase();

    if (!configuredHost || requestHost !== configuredHost) {
      return context.json(errorResponse("NOT_FOUND", "Not found", context.get("requestId")), 404);
    }

    return next();
  });

  application.use("*", async (context, next) => {
    const assertion = context.req.header("Cf-Access-Jwt-Assertion");

    if (!assertion) {
      return context.json(
        errorResponse("AUTH_REQUIRED", "Authentication required", context.get("requestId")),
        401,
      );
    }

    let isValid = false;

    try {
      isValid = await verifyAccessAssertion(assertion, context.env);
    } catch {
      isValid = false;
    }

    if (!isValid) {
      return context.json(
        errorResponse("AUTH_INVALID", "Invalid authentication", context.get("requestId")),
        401,
      );
    }

    return next();
  });

  application.get("/healthz", (context) => {
    return context.json(successResponse({ status: "ok" }, context.get("requestId")));
  });

  application.notFound((context) => {
    return context.json(errorResponse("NOT_FOUND", "Not found", context.get("requestId")), 404);
  });

  application.onError((_, context) => {
    return context.json(
      errorResponse("INTERNAL_ERROR", "Internal server error", context.get("requestId")),
      500,
    );
  });

  return application;
}

export const app = createAdminApp();

export default app;
