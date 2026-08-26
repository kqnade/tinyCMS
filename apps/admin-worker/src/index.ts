import {
  ADMIN_POST_DRAFT_ROUTE,
  ADMIN_POST_REVISION_RESTORE_ROUTE,
  ADMIN_POST_REVISIONS_ROUTE,
  ADMIN_POST_ROUTE,
  ADMIN_POSTS_ROUTE,
  ErrorCode,
  HTTP_STATUS_BY_ERROR_CODE,
  type ContractParseResult,
  WRITE_BOUNDARY_HEADER,
  WRITE_BOUNDARY_VALUE,
  errorResponse,
  parseCheckpointPostRevisionRequest,
  parseCreatePostRequest,
  parsePostListQuery,
  parsePostRevisionListQuery,
  parsePostRevisionRouteParams,
  parsePostRouteParams,
  parseRestorePostRevisionRequest,
  parseSavePostDraftRequest,
  successResponse,
} from "@tinycms/contracts";
import {
  ApplicationError,
  ApplicationErrorCode,
  type AccessIdentity,
  type EditorialApplication,
  createEditorialApplication,
} from "@tinycms/application";
import { createEditorialRepository } from "@tinycms/database";
import { Hono, type Context } from "hono";
import type { HonoJsonWebKey } from "hono/utils/jwt/jws";
import { decodeHeader, verify } from "hono/utils/jwt/jwt";
import type { JWTPayload } from "hono/utils/jwt/types";

const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;
const JWKS_FORCED_REFRESH_COOLDOWN_MS = 60 * 1000;
const ACCESS_TEAM_DOMAIN_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+cloudflareaccess\.com$/;

type AdminWorker = {
  Bindings: {
    ADMIN_HOST: string;
    ACCESS_TEAM_DOMAIN?: string;
    ACCESS_AUD?: string;
    CMS_DB: D1Database;
  };
  Variables: {
    requestId: string;
    accessIdentity: AccessIdentity;
  };
};

type AccessDependencies = {
  fetch?: typeof fetch;
  now?: () => number;
  uuidv7?: () => string;
  application?: EditorialApplication;
};

const MAX_JSON_BODY_BYTES = 1_048_576;
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
  "Content-Security-Policy":
    "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
} as const;

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

type ForcedRefreshCooldown = {
  expiresAt: number;
  jwksUrl: string;
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

  if (typeof payload.sub !== "string" || payload.sub.trim() === "" || payload.sub.length > 256) {
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

function accessIdentityFromPayload(payload: JWTPayload): AccessIdentity | undefined {
  if (typeof payload.sub !== "string" || payload.sub.trim() === "") {
    return undefined;
  }
  const identity: AccessIdentity = { subject: payload.sub };
  const displayName =
    typeof payload.name === "string"
      ? payload.name
      : typeof payload.preferred_username === "string"
        ? payload.preferred_username
        : undefined;
  const boundedDisplayName =
    displayName !== undefined && displayName.length <= 512 ? displayName : undefined;
  const avatarUrl = typeof payload.picture === "string" ? payload.picture : undefined;
  const boundedAvatarUrl =
    avatarUrl !== undefined && avatarUrl.length <= 2048 ? avatarUrl : undefined;
  const metadata = {
    ...(boundedDisplayName === undefined ? {} : { displayName: boundedDisplayName }),
    ...(boundedAvatarUrl === undefined ? {} : { avatarUrl: boundedAvatarUrl }),
  };
  if (typeof payload.email === "string" && payload.email.length <= 320) {
    return { ...identity, email: payload.email, ...metadata };
  }
  return { ...identity, ...metadata };
}

function createAccessVerifier(dependencies: AccessDependencies = {}) {
  const fetcher = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
  const now = dependencies.now ?? (() => Date.now());
  let cachedJwks: JwksCache | undefined;
  let forcedRefreshCooldown: ForcedRefreshCooldown | undefined;

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

  return async (
    assertion: string,
    bindings: AdminWorker["Bindings"],
  ): Promise<AccessIdentity | undefined> => {
    const config = getAccessConfig(bindings);

    if (!config) {
      return undefined;
    }

    let header: ReturnType<typeof decodeHeader>;

    try {
      header = decodeHeader(assertion);
    } catch {
      return undefined;
    }

    if (header.alg !== "RS256" || typeof header.kid !== "string" || header.kid.length === 0) {
      return undefined;
    }

    let loadedJwks: LoadedJwks;

    try {
      loadedJwks = await loadJwks(config, false);
    } catch {
      return undefined;
    }

    let matchingKey = loadedJwks.keys.find((key) => key.kid === header.kid);

    if (!matchingKey && loadedJwks.fromCache) {
      const currentTime = now();

      if (
        forcedRefreshCooldown?.jwksUrl === config.jwksUrl &&
        forcedRefreshCooldown.expiresAt > currentTime
      ) {
        return undefined;
      }

      forcedRefreshCooldown = {
        expiresAt: currentTime + JWKS_FORCED_REFRESH_COOLDOWN_MS,
        jwksUrl: config.jwksUrl,
      };

      try {
        loadedJwks = await loadJwks(config, true);
      } catch {
        return undefined;
      }

      matchingKey = loadedJwks.keys.find((key) => key.kid === header.kid);
    }

    if (!matchingKey) {
      return undefined;
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

      if (!hasValidAccessClaims(payload, config, now())) {
        return undefined;
      }
      return accessIdentityFromPayload(payload);
    } catch {
      return undefined;
    }
  };
}

type AdminContext = Context<AdminWorker>;

type JsonReadResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly message: string };

function invalidRequest(context: AdminContext, details?: unknown): Response {
  return context.json(
    errorResponse(ErrorCode.INVALID_REQUEST, "Invalid request", context.get("requestId"), details),
    HTTP_STATUS_BY_ERROR_CODE[ErrorCode.INVALID_REQUEST],
  );
}

async function readJsonBody(request: Request): Promise<JsonReadResult> {
  const contentType = request.headers.get("Content-Type");
  if (
    contentType === null ||
    contentType.split(";", 1)[0]?.trim().toLowerCase() !== "application/json"
  ) {
    return { ok: false, message: "Content-Type must be application/json" };
  }
  const contentLength = request.headers.get("Content-Length");
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength < 0 ||
      parsedLength > MAX_JSON_BODY_BYTES
    ) {
      return { ok: false, message: "Request body is too large" };
    }
  }
  let body: ArrayBuffer;
  try {
    body = await request.arrayBuffer();
  } catch {
    return { ok: false, message: "Request body could not be read" };
  }
  if (body.byteLength > MAX_JSON_BODY_BYTES) {
    return { ok: false, message: "Request body is too large" };
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(body)) as unknown };
  } catch {
    return { ok: false, message: "Request body must be valid JSON" };
  }
}

function applicationResponse<T>(context: AdminContext, result: Promise<T>): Promise<Response> {
  return result
    .then((data) => context.json(successResponse(data, context.get("requestId"))))
    .catch((error: unknown): Response => {
      if (error instanceof ApplicationError) {
        const code = error.code;
        const isInternal = code === ApplicationErrorCode.INTERNAL_ERROR;
        return context.json(
          errorResponse(
            code,
            isInternal ? "Internal server error" : error.message,
            context.get("requestId"),
            isInternal ? undefined : error.details,
          ),
          HTTP_STATUS_BY_ERROR_CODE[code],
        );
      }
      throw error;
    });
}

function requestParams<T>(context: AdminContext, result: ContractParseResult<T>): T | Response {
  if (!result.ok) {
    return invalidRequest(context, result.issues);
  }
  return result.value;
}

export function createAdminApp(dependencies: AccessDependencies = {}) {
  const verifyAccessAssertion = createAccessVerifier(dependencies);
  const application = new Hono<AdminWorker>();

  application.use("*", async (context, next) => {
    const requestId = crypto.randomUUID();
    context.set("requestId", requestId);
    try {
      await next();
    } catch (error) {
      context.res = genericInternalError(context, error);
    }
    const response = new Response(context.res.body, context.res);
    response.headers.set("X-Request-Id", requestId);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      response.headers.set(name, value);
    }
    if (response.status >= 400 || context.req.path === "/healthz") {
      response.headers.set("Cache-Control", "no-store");
    }
    context.res = response;
  });

  application.use("*", async (context, next) => {
    const configuredHost = context.env.ADMIN_HOST?.trim().toLowerCase();
    const requestHost = new URL(context.req.url).hostname.toLowerCase();
    if (!configuredHost || requestHost !== configuredHost) {
      return context.json(
        errorResponse(ErrorCode.NOT_FOUND, "Not found", context.get("requestId")),
        404,
      );
    }
    return next();
  });

  application.use("*", async (context, next) => {
    const assertion = context.req.header("Cf-Access-Jwt-Assertion");
    if (!assertion) {
      return context.json(
        errorResponse(ErrorCode.AUTH_REQUIRED, "Authentication required", context.get("requestId")),
        HTTP_STATUS_BY_ERROR_CODE[ErrorCode.AUTH_REQUIRED],
      );
    }
    let identity: AccessIdentity | undefined;
    try {
      identity = await verifyAccessAssertion(assertion, context.env);
    } catch {
      identity = undefined;
    }
    if (identity === undefined) {
      return context.json(
        errorResponse(ErrorCode.AUTH_INVALID, "Invalid authentication", context.get("requestId")),
        HTTP_STATUS_BY_ERROR_CODE[ErrorCode.AUTH_INVALID],
      );
    }
    context.set("accessIdentity", identity);
    return next();
  });

  application.use("*", async (context, next) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(context.req.method)) {
      const request = context.req.raw;
      const contentType = request.headers.get("Content-Type");
      const origin = request.headers.get("Origin");
      if (
        contentType === null ||
        contentType.split(";", 1)[0]?.trim().toLowerCase() !== "application/json" ||
        request.headers.get(WRITE_BOUNDARY_HEADER) !== WRITE_BOUNDARY_VALUE ||
        origin !== new URL(request.url).origin
      ) {
        return invalidRequest(context);
      }
    }
    return next();
  });

  const resolveApplication = (context: AdminContext): EditorialApplication => {
    if (dependencies.application !== undefined) {
      return dependencies.application;
    }
    if (context.env.CMS_DB === undefined) {
      throw new ApplicationError(ApplicationErrorCode.INTERNAL_ERROR, "Internal server error");
    }
    return createEditorialApplication({
      repository: createEditorialRepository(context.env.CMS_DB),
      ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
      ...(dependencies.uuidv7 === undefined ? {} : { uuidv7: dependencies.uuidv7 }),
    });
  };

  application.get("/healthz", (context) => {
    return context.json(successResponse({ status: "ok" }, context.get("requestId")));
  });

  application.get(ADMIN_POSTS_ROUTE, (context) => {
    const rawQuery: Record<string, string> = {};
    const cursor = context.req.query("cursor");
    const limit = context.req.query("limit");
    if (cursor !== undefined) rawQuery.cursor = cursor;
    if (limit !== undefined) rawQuery.limit = limit;
    const parsed = parsePostListQuery(rawQuery);
    const query = requestParams(context, parsed);
    if (query instanceof Response) return query;
    return applicationResponse(context, resolveApplication(context).listPosts(query));
  });

  application.post(ADMIN_POSTS_ROUTE, async (context) => {
    const body = await readJsonBody(context.req.raw);
    if (!body.ok) return invalidRequest(context, [{ code: "invalid_body", message: body.message }]);
    const parsed = parseCreatePostRequest(body.value);
    const request = requestParams(context, parsed);
    if (request instanceof Response) return request;
    return applicationResponse(
      context,
      resolveApplication(context).createPost(request, context.get("accessIdentity")),
    );
  });

  application.get(ADMIN_POST_ROUTE, (context) => {
    const params = requestParams(
      context,
      parsePostRouteParams({ postId: context.req.param("postId") }),
    );
    if (params instanceof Response) return params;
    return applicationResponse(context, resolveApplication(context).getPost(params.postId));
  });

  application.put(ADMIN_POST_DRAFT_ROUTE, async (context) => {
    const params = requestParams(
      context,
      parsePostRouteParams({ postId: context.req.param("postId") }),
    );
    if (params instanceof Response) return params;
    const body = await readJsonBody(context.req.raw);
    if (!body.ok) return invalidRequest(context, [{ code: "invalid_body", message: body.message }]);
    const parsed = parseSavePostDraftRequest(body.value);
    const request = requestParams(context, parsed);
    if (request instanceof Response) return request;
    return applicationResponse(
      context,
      resolveApplication(context).saveDraft(params.postId, request, context.get("accessIdentity")),
    );
  });

  application.get(ADMIN_POST_REVISIONS_ROUTE, (context) => {
    const params = requestParams(
      context,
      parsePostRouteParams({ postId: context.req.param("postId") }),
    );
    if (params instanceof Response) return params;
    const rawQuery: Record<string, string> = {};
    const cursor = context.req.query("cursor");
    const limit = context.req.query("limit");
    if (cursor !== undefined) rawQuery.cursor = cursor;
    if (limit !== undefined) rawQuery.limit = limit;
    const parsed = parsePostRevisionListQuery(rawQuery);
    const query = requestParams(context, parsed);
    if (query instanceof Response) return query;
    return applicationResponse(
      context,
      resolveApplication(context).listRevisions(params.postId, query),
    );
  });

  application.post(ADMIN_POST_REVISIONS_ROUTE, async (context) => {
    const params = requestParams(
      context,
      parsePostRouteParams({ postId: context.req.param("postId") }),
    );
    if (params instanceof Response) return params;
    const body = await readJsonBody(context.req.raw);
    if (!body.ok) return invalidRequest(context, [{ code: "invalid_body", message: body.message }]);
    const parsed = parseCheckpointPostRevisionRequest(body.value);
    const request = requestParams(context, parsed);
    if (request instanceof Response) return request;
    return applicationResponse(
      context,
      resolveApplication(context).checkpointRevision(
        params.postId,
        request,
        context.get("accessIdentity"),
      ),
    );
  });

  application.post(ADMIN_POST_REVISION_RESTORE_ROUTE, async (context) => {
    const params = requestParams(
      context,
      parsePostRevisionRouteParams({
        postId: context.req.param("postId"),
        revisionId: context.req.param("revisionId"),
      }),
    );
    if (params instanceof Response) return params;
    const body = await readJsonBody(context.req.raw);
    if (!body.ok) return invalidRequest(context, [{ code: "invalid_body", message: body.message }]);
    const parsed = parseRestorePostRevisionRequest(body.value);
    const request = requestParams(context, parsed);
    if (request instanceof Response) return request;
    return applicationResponse(
      context,
      resolveApplication(context).restoreRevision(
        params.postId,
        params.revisionId,
        request,
        context.get("accessIdentity"),
      ),
    );
  });

  application.notFound((context) => {
    return context.json(
      errorResponse(ErrorCode.NOT_FOUND, "Not found", context.get("requestId")),
      404,
    );
  });

  application.onError((error, context) => genericInternalError(context, error));

  return application;
}

function genericInternalError(context: AdminContext, error: unknown): Response {
  console.error("Unhandled request error", {
    requestId: context.get("requestId"),
    errorCategory: error instanceof Error ? "Error" : "Unknown",
  });
  return context.json(
    errorResponse(ErrorCode.INTERNAL_ERROR, "Internal server error", context.get("requestId")),
    HTTP_STATUS_BY_ERROR_CODE[ErrorCode.INTERNAL_ERROR],
  );
}

export const app = createAdminApp();

export default app;
