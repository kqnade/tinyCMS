import {
  type AccessIdentity,
  ApplicationError,
  ApplicationErrorCode,
  createEditorialApplication,
  createMediaApplication,
  type EditorialApplication,
  MAX_MEDIA_BYTES,
  type MediaApplication,
} from "@tinycms/application";
import {
  ADMIN_MEDIA_ITEM_ROUTE,
  ADMIN_MEDIA_ORIGINAL_ROUTE,
  ADMIN_MEDIA_ROUTE,
  ADMIN_POST_DRAFT_ROUTE,
  ADMIN_POST_PREVIEW_ROUTE,
  ADMIN_POST_PUBLISH_ROUTE,
  ADMIN_POST_REVISION_RESTORE_ROUTE,
  ADMIN_POST_REVISIONS_ROUTE,
  ADMIN_POST_ROUTE,
  ADMIN_POSTS_ROUTE,
  type ContractParseResult,
  ErrorCode,
  errorResponse,
  HTTP_STATUS_BY_ERROR_CODE,
  parseCheckpointPostRevisionRequest,
  parseCreatePostRequest,
  parseDeleteMediaRequest,
  parseMediaListQuery,
  parseMediaRouteParams,
  parsePostListQuery,
  parsePostRevisionListQuery,
  parsePostRevisionRouteParams,
  parsePostRouteParams,
  parsePreviewPostRequest,
  parsePublishPostRequest,
  parseRestorePostRevisionRequest,
  parseSavePostDraftRequest,
  parseUpdateMediaRequest,
  successResponse,
  WRITE_BOUNDARY_HEADER,
  WRITE_BOUNDARY_VALUE,
} from "@tinycms/contracts";
import { createEditorialRepository, createMediaRepository } from "@tinycms/database";
import { type Context, Hono } from "hono";
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
    CONTENT_ARTIFACTS?: R2Bucket;
    MEDIA_ORIGINALS?: R2Bucket;
    MEDIA_DERIVATIVES?: R2Bucket;
    IMAGES?: ImagesBinding;
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
  mediaApplication?: MediaApplication;
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

type MediaMultipartReadResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly filename: string;
        readonly mediaType: string;
        readonly bytes: Uint8Array;
        readonly altText?: string;
      };
    }
  | { readonly ok: false; readonly message: string };

const MAX_MULTIPART_ENVELOPE_BYTES = 64 * 1024;
const MAX_MULTIPART_BODY_BYTES = MAX_MEDIA_BYTES + MAX_MULTIPART_ENVELOPE_BYTES;

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

async function readMediaMultipart(request: Request): Promise<MediaMultipartReadResult> {
  const contentLength = request.headers.get("Content-Length");
  if (contentLength === null || !/^[0-9]+$/.test(contentLength)) {
    return { ok: false, message: "Content-Length must be a decimal integer" };
  }
  const parsedLength = Number(contentLength);
  if (!Number.isSafeInteger(parsedLength) || parsedLength > MAX_MULTIPART_BODY_BYTES) {
    return { ok: false, message: "Request body is too large" };
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { ok: false, message: "Request body must be valid multipart form data" };
  }

  let file: File | undefined;
  let altText: string | undefined;
  let fileCount = 0;
  let altTextCount = 0;
  for (const [name, value] of form.entries()) {
    if (name === "file") {
      fileCount += 1;
      if (!(value instanceof File)) {
        return { ok: false, message: "A file field is required" };
      }
      file = value;
      continue;
    }
    if (name === "altText") {
      altTextCount += 1;
      if (typeof value !== "string") {
        return { ok: false, message: "altText must be text" };
      }
      altText = value;
      continue;
    }
    return { ok: false, message: "Unexpected multipart field" };
  }

  if (fileCount !== 1 || file === undefined || altTextCount > 1) {
    return { ok: false, message: "Exactly one file field is required" };
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { ok: false, message: "File could not be read" };
  }

  return {
    ok: true,
    value: {
      filename: file.name,
      mediaType: file.type,
      bytes,
      ...(altText === undefined ? {} : { altText }),
    },
  };
}

function mediaByteStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  const copy = bytes.slice();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(copy);
      controller.close();
    },
  });
}

function createMediaObjectStore(bucket: R2Bucket) {
  return {
    put: async (
      key: string,
      bytes: Uint8Array,
      options: { readonly contentType: string; readonly cacheControl: string },
    ): Promise<void> => {
      await bucket.put(key, bytes, {
        httpMetadata: {
          contentType: options.contentType,
          cacheControl: options.cacheControl,
        },
      });
    },
    delete: async (key: string): Promise<void> => {
      await bucket.delete(key);
    },
  };
}

function createPublicationArtifactStore(bucket: R2Bucket) {
  return {
    put: async (
      key: string,
      value: string,
      options: { readonly contentType: string; readonly cacheControl: string },
    ): Promise<void> => {
      await bucket.put(key, value, {
        httpMetadata: {
          contentType: options.contentType,
          cacheControl: options.cacheControl,
        },
      });
    },
  };
}

function createMediaInspector(images: ImagesBinding) {
  return async (bytes: Uint8Array) => {
    const result = await images.info(mediaByteStream(bytes));
    if (result.format === "image/svg+xml" || !("fileSize" in result)) {
      throw new Error("Media inspection failed");
    }
    return {
      format: result.format,
      fileSize: result.fileSize,
      width: result.width,
      height: result.height,
    };
  };
}

function createMediaTransformer(images: ImagesBinding) {
  return async (input: {
    readonly bytes: Uint8Array;
    readonly width: number;
    readonly height: number;
    readonly format: "avif" | "webp";
  }): Promise<Uint8Array> => {
    const output = await images
      .input(mediaByteStream(input.bytes))
      .transform({ width: input.width, height: input.height, fit: "scale-down" })
      .output({ format: `image/${input.format}` });
    const response = await output.response();
    if (!response.ok) {
      throw new Error("Media transformation failed");
    }
    return new Uint8Array(await response.arrayBuffer());
  };
}

function applicationResponse<T>(
  context: AdminContext,
  result: Promise<T>,
  status: 200 | 201 = 200,
): Promise<Response> {
  return result
    .then((data) => context.json(successResponse(data, context.get("requestId")), status))
    .catch((error: unknown): Response => applicationErrorResponse(context, error));
}

function applicationErrorResponse(context: AdminContext, error: unknown): Response {
  if (!(error instanceof ApplicationError)) {
    throw error;
  }
  const code = error.code;
  if (code === ApplicationErrorCode.MEDIA_WRITE_FAILED) {
    console.error({
      requestId: context.get("requestId"),
      errorCategory: "MEDIA_WRITE_FAILED",
    });
  }
  const isInternal = code === ApplicationErrorCode.INTERNAL_ERROR;
  const isMediaWriteFailure = code === ApplicationErrorCode.MEDIA_WRITE_FAILED;
  return context.json(
    errorResponse(
      code,
      isInternal
        ? "Internal server error"
        : isMediaWriteFailure
          ? "Media write failed"
          : error.message,
      context.get("requestId"),
      isInternal || isMediaWriteFailure ? undefined : error.details,
    ),
    HTTP_STATUS_BY_ERROR_CODE[code],
  );
}

function requestParams<T>(context: AdminContext, result: ContractParseResult<T>): T | Response {
  if (!result.ok) {
    return invalidRequest(context, result.issues);
  }
  return result.value;
}

function mediaContentDisposition(filename: string): string {
  const fallback =
    [...filename]
      .map((character) =>
        /^[\x20-\x7e]$/.test(character) && !/["\\;]/.test(character) ? character : "_",
      )
      .join("")
      .replace(/[\r\n]/g, "_")
      .slice(0, 120) || "download";
  const encoded = [...new TextEncoder().encode(filename)]
    .map((byte) => {
      const character = String.fromCharCode(byte);
      return /^[A-Za-z0-9!#$&+.^_`|~-]$/.test(character)
        ? character
        : `%${byte.toString(16).padStart(2, "0").toUpperCase()}`;
    })
    .join("");
  return `inline; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function weakEtagMatches(header: string | null, etag: string): boolean {
  if (header === null) return false;
  return header
    .split(",")
    .map((value) => value.trim())
    .some((value) => value === "*" || value === etag || value === `W/${etag}`);
}

function strongEtagMatches(header: string | null, etag: string): boolean {
  if (header === null) return false;
  return header
    .split(",")
    .map((value) => value.trim())
    .some((value) => value === "*" || value === etag);
}

const HTTP_DATE_SHORT_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HTTP_DATE_LONG_WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const HTTP_DATE_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const HTTP_DATE_IMF_FIXDATE =
  /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), ([0-9]{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ([0-9]{4}) ([0-9]{2}):([0-9]{2}):([0-9]{2}) GMT$/;
const HTTP_DATE_RFC850 =
  /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), ([0-9]{2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-([0-9]{2}) ([0-9]{2}):([0-9]{2}):([0-9]{2}) GMT$/;
const HTTP_DATE_ASCTIME =
  /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (?:( [0-9])|([0-9]{2})) ([0-9]{2}):([0-9]{2}):([0-9]{2}) ([0-9]{4})$/;

function createHttpDateTimestamp(
  weekday: number,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): number | undefined {
  if (
    !Number.isInteger(weekday) ||
    weekday < 0 ||
    weekday > 6 ||
    !Number.isInteger(year) ||
    year < 1900 ||
    year > 9999 ||
    !Number.isInteger(month) ||
    month < 0 ||
    month > 11 ||
    !Number.isInteger(day) ||
    day < 1 ||
    day > 31 ||
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23 ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59 ||
    !Number.isInteger(second) ||
    second < 0 ||
    second > 60 ||
    (second === 60 && (hour !== 23 || minute !== 59))
  ) {
    return undefined;
  }

  const leapSecond = second === 60;
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  date.setUTCHours(hour, minute, leapSecond ? 59 : second, 0);

  if (!Number.isFinite(date.getTime())) {
    return undefined;
  }

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== (leapSecond ? 59 : second) ||
    date.getUTCDay() !== weekday
  ) {
    return undefined;
  }

  const timestamp = date.getTime() + (leapSecond ? 1000 : 0);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function parseHttpDate(header: string): number | undefined {
  let match = HTTP_DATE_IMF_FIXDATE.exec(header);
  if (match !== null && match[0] === header) {
    return createHttpDateTimestamp(
      HTTP_DATE_SHORT_WEEKDAYS.indexOf(match[1] ?? ""),
      Number(match[4]),
      HTTP_DATE_MONTHS.indexOf(match[3] ?? ""),
      Number(match[2]),
      Number(match[5]),
      Number(match[6]),
      Number(match[7]),
    );
  }

  match = HTTP_DATE_RFC850.exec(header);
  if (match !== null && match[0] === header) {
    const currentYear = new Date().getUTCFullYear();
    let year = Math.floor(currentYear / 100) * 100 + Number(match[4]);
    if (year - currentYear > 50) {
      year -= 100;
    }
    return createHttpDateTimestamp(
      HTTP_DATE_LONG_WEEKDAYS.indexOf(match[1] ?? ""),
      year,
      HTTP_DATE_MONTHS.indexOf(match[3] ?? ""),
      Number(match[2]),
      Number(match[5]),
      Number(match[6]),
      Number(match[7]),
    );
  }

  match = HTTP_DATE_ASCTIME.exec(header);
  if (match !== null && match[0] === header) {
    return createHttpDateTimestamp(
      HTTP_DATE_SHORT_WEEKDAYS.indexOf(match[1] ?? ""),
      Number(match[8]),
      HTTP_DATE_MONTHS.indexOf(match[2] ?? ""),
      Number(match[3] ?? match[4]),
      Number(match[5]),
      Number(match[6]),
      Number(match[7]),
    );
  }

  return undefined;
}

function ifUnmodifiedSinceFailed(header: string | null, uploaded: Date): boolean {
  if (header === null) return false;
  const timestamp = parseHttpDate(header);
  return (
    timestamp !== undefined && Math.floor(uploaded.getTime() / 1000) > Math.floor(timestamp / 1000)
  );
}

async function streamMediaOriginal(
  context: AdminContext,
  descriptor: { readonly key: string; readonly filename: string; readonly mediaType: string },
): Promise<Response> {
  const bucket = context.env.MEDIA_ORIGINALS;
  if (bucket === undefined) {
    throw new ApplicationError(ApplicationErrorCode.INTERNAL_ERROR, "Internal server error");
  }
  const request = context.req.raw;
  const forwardedConditions = new Headers();
  const ifNoneMatch = request.headers.get("If-None-Match");
  if (ifNoneMatch !== null) {
    forwardedConditions.set("If-None-Match", ifNoneMatch);
  }
  const object = await bucket.get(descriptor.key, { onlyIf: forwardedConditions });
  if (object === null) {
    return context.json(
      errorResponse(ErrorCode.NOT_FOUND, "Resource not found", context.get("requestId")),
      HTTP_STATUS_BY_ERROR_CODE[ErrorCode.NOT_FOUND],
    );
  }

  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": descriptor.mediaType,
    "Content-Disposition": mediaContentDisposition(descriptor.filename),
    ETag: object.httpEtag,
  });
  const ifMatch = request.headers.get("If-Match");
  if (ifMatch !== null && !strongEtagMatches(ifMatch, object.httpEtag)) {
    return new Response(null, { status: 412, headers });
  }
  if (
    ifMatch === null &&
    ifUnmodifiedSinceFailed(request.headers.get("If-Unmodified-Since"), object.uploaded)
  ) {
    return new Response(null, { status: 412, headers });
  }
  const hasBody = "body" in object && object.body !== undefined;
  if (weakEtagMatches(ifNoneMatch, object.httpEtag)) {
    return new Response(null, { status: 304, headers });
  }

  if (!hasBody) {
    throw new ApplicationError(ApplicationErrorCode.INTERNAL_ERROR, "Internal server error");
  }

  return new Response(object.body, { status: 200, headers });
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
      const isMediaUpload =
        context.req.method === "POST" && new URL(request.url).pathname === ADMIN_MEDIA_ROUTE;
      const normalizedContentType = contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? null;
      const contentTypeAllowed = isMediaUpload
        ? normalizedContentType === "multipart/form-data"
        : normalizedContentType === "application/json";
      if (
        !contentTypeAllowed ||
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
      ...(context.env.CONTENT_ARTIFACTS === undefined
        ? {}
        : { artifactStore: createPublicationArtifactStore(context.env.CONTENT_ARTIFACTS) }),
      ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
      ...(dependencies.uuidv7 === undefined ? {} : { uuidv7: dependencies.uuidv7 }),
    });
  };

  const resolveMediaApplication = (context: AdminContext): MediaApplication => {
    if (dependencies.mediaApplication !== undefined) {
      return dependencies.mediaApplication;
    }
    const { CMS_DB, MEDIA_ORIGINALS, MEDIA_DERIVATIVES, IMAGES } = context.env;
    if (
      CMS_DB === undefined ||
      MEDIA_ORIGINALS === undefined ||
      MEDIA_DERIVATIVES === undefined ||
      IMAGES === undefined
    ) {
      throw new ApplicationError(ApplicationErrorCode.INTERNAL_ERROR, "Internal server error");
    }
    return createMediaApplication({
      repository: createMediaRepository(CMS_DB),
      inspector: createMediaInspector(IMAGES),
      originalStore: createMediaObjectStore(MEDIA_ORIGINALS),
      derivativeStore: createMediaObjectStore(MEDIA_DERIVATIVES),
      transformer: createMediaTransformer(IMAGES),
      ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
      ...(dependencies.uuidv7 === undefined ? {} : { uuidv7: dependencies.uuidv7 }),
    });
  };

  application.get("/healthz", (context) => {
    return context.json(successResponse({ status: "ok" }, context.get("requestId")));
  });

  application.get(ADMIN_MEDIA_ROUTE, (context) => {
    const rawQuery: Record<string, string> = {};
    const cursor = context.req.query("cursor");
    const limit = context.req.query("limit");
    if (cursor !== undefined) rawQuery.cursor = cursor;
    if (limit !== undefined) rawQuery.limit = limit;
    const parsed = parseMediaListQuery(rawQuery);
    const query = requestParams(context, parsed);
    if (query instanceof Response) return query;
    return applicationResponse(context, resolveMediaApplication(context).listMedia(query));
  });

  application.post(ADMIN_MEDIA_ROUTE, async (context) => {
    const body = await readMediaMultipart(context.req.raw);
    if (!body.ok) return invalidRequest(context, [{ code: "invalid_body", message: body.message }]);
    return applicationResponse(
      context,
      resolveMediaApplication(context).createMedia(body.value, context.get("accessIdentity")),
      201,
    );
  });

  application.get(ADMIN_MEDIA_ITEM_ROUTE, (context) => {
    const params = requestParams(
      context,
      parseMediaRouteParams({ mediaId: context.req.param("mediaId") }),
    );
    if (params instanceof Response) return params;
    return applicationResponse(context, resolveMediaApplication(context).getMedia(params.mediaId));
  });

  application.patch(ADMIN_MEDIA_ITEM_ROUTE, async (context) => {
    const params = requestParams(
      context,
      parseMediaRouteParams({ mediaId: context.req.param("mediaId") }),
    );
    if (params instanceof Response) return params;
    const body = await readJsonBody(context.req.raw);
    if (!body.ok) return invalidRequest(context, [{ code: "invalid_body", message: body.message }]);
    const parsed = parseUpdateMediaRequest(body.value);
    const request = requestParams(context, parsed);
    if (request instanceof Response) return request;
    return applicationResponse(
      context,
      resolveMediaApplication(context).updateMediaAlt(params.mediaId, request),
    );
  });

  application.delete(ADMIN_MEDIA_ITEM_ROUTE, async (context) => {
    const params = requestParams(
      context,
      parseMediaRouteParams({ mediaId: context.req.param("mediaId") }),
    );
    if (params instanceof Response) return params;
    const body = await readJsonBody(context.req.raw);
    if (!body.ok) return invalidRequest(context, [{ code: "invalid_body", message: body.message }]);
    const parsed = parseDeleteMediaRequest(body.value);
    const request = requestParams(context, parsed);
    if (request instanceof Response) return request;
    return applicationResponse(
      context,
      resolveMediaApplication(context).trashMedia(params.mediaId, request),
    );
  });

  application.get(ADMIN_MEDIA_ORIGINAL_ROUTE, async (context) => {
    const params = requestParams(
      context,
      parseMediaRouteParams({ mediaId: context.req.param("mediaId") }),
    );
    if (params instanceof Response) return params;
    try {
      const descriptor = await resolveMediaApplication(context).getMediaOriginal(params.mediaId);
      return await streamMediaOriginal(context, descriptor);
    } catch (error: unknown) {
      return applicationErrorResponse(context, error);
    }
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

  application.post(ADMIN_POST_PREVIEW_ROUTE, async (context) => {
    const params = requestParams(
      context,
      parsePostRouteParams({ postId: context.req.param("postId") }),
    );
    if (params instanceof Response) return params;
    const body = await readJsonBody(context.req.raw);
    if (!body.ok) return invalidRequest(context, [{ code: "invalid_body", message: body.message }]);
    const parsed = parsePreviewPostRequest(body.value);
    const request = requestParams(context, parsed);
    if (request instanceof Response) return request;
    return applicationResponse(context, resolveApplication(context).previewPost(request));
  });

  application.post(ADMIN_POST_PUBLISH_ROUTE, async (context) => {
    const params = requestParams(
      context,
      parsePostRouteParams({ postId: context.req.param("postId") }),
    );
    if (params instanceof Response) return params;
    const body = await readJsonBody(context.req.raw);
    if (!body.ok) return invalidRequest(context, [{ code: "invalid_body", message: body.message }]);
    const parsed = parsePublishPostRequest(body.value);
    const request = requestParams(context, parsed);
    if (request instanceof Response) return request;
    return applicationResponse(
      context,
      resolveApplication(context).publishPost(
        params.postId,
        request,
        context.get("accessIdentity"),
      ),
    );
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
