import { errorResponse, parseUuidV7, successResponse } from "@tinycms/contracts";
import { type Context, Hono } from "hono";

type PublicWorker = {
  Bindings: {
    CMS_DB?: D1Database;
    CONTENT_ARTIFACTS?: R2Bucket;
    MEDIA_DERIVATIVES?: R2Bucket;
  };
  Variables: {
    requestId: string;
  };
};

type PublicArtifactFormat = "html" | "markdown";

type PublishedEntry = {
  readonly post: {
    readonly slug: string;
    readonly canonicalUrl: string | null;
    readonly noindex: 0 | 1;
  };
  readonly artifact: {
    readonly body: BodyInit;
    readonly etag: string;
  } | null;
};

export type PublicContentSource = {
  readonly readPublishedEntry: (
    slug: string,
    format: PublicArtifactFormat,
  ) => Promise<PublishedEntry | null>;
  readonly readPublicMedia: (
    mediaId: string,
    preferredFormat: "avif" | "webp",
  ) => Promise<{
    readonly body: BodyInit;
    readonly etag: string;
    readonly format: "avif" | "webp";
  } | null>;
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
  "Content-Security-Policy":
    "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
} as const;

type RouteRegistrar = (app: Hono<PublicWorker>) => void;

function requestsMarkdown(accept: string | undefined): boolean {
  if (accept === undefined) return false;
  return accept.split(",").some((range) => {
    const [mediaType, ...parameters] = range.split(";").map((part) => part.trim().toLowerCase());
    if (mediaType !== "text/markdown") return false;
    const quality = parameters.find((parameter) => parameter.startsWith("q="));
    return quality === undefined || Number(quality.slice(2)) > 0;
  });
}

function createPublicContentSource(
  database: D1Database,
  contentArtifacts?: R2Bucket,
  mediaDerivatives?: R2Bucket,
): PublicContentSource {
  return {
    readPublishedEntry: async (slug, format) => {
      if (contentArtifacts === undefined) {
        throw new Error("Public content artifacts are unavailable");
      }
      const post = await database
        .prepare(
          `SELECT id, slug, canonical_url AS "canonicalUrl", noindex,
             active_published_revision_id AS "activePublishedRevisionId"
           FROM posts
           WHERE slug = ? AND status = 'published'
             AND active_published_revision_id IS NOT NULL
           LIMIT 1`,
        )
        .bind(slug)
        .first<{
          id: string;
          slug: string;
          canonicalUrl: string | null;
          noindex: 0 | 1;
          activePublishedRevisionId: string;
        }>();
      if (post === null) {
        return null;
      }
      const extension = format === "html" ? "html" : "md";
      const key = `posts/${post.id}/revisions/${post.activePublishedRevisionId}.${extension}`;
      const artifact = await contentArtifacts.get(key);
      return {
        post: {
          slug: post.slug,
          canonicalUrl: post.canonicalUrl,
          noindex: post.noindex,
        },
        artifact: artifact === null ? null : { body: artifact.body, etag: artifact.httpEtag },
      };
    },
    readPublicMedia: async (mediaId, preferredFormat) => {
      if (mediaDerivatives === undefined) {
        throw new Error("Public media derivatives are unavailable");
      }
      const variant = await database
        .prepare(
          `SELECT variants.r2_key AS "r2Key", variants.format
           FROM media
           JOIN media_variants AS variants ON variants.media_id = media.id
           WHERE media.id = ? AND media.state = 'ready'
           ORDER BY CASE WHEN variants.format = ? THEN 0 ELSE 1 END,
             variants.width DESC, variants.name ASC
           LIMIT 1`,
        )
        .bind(mediaId, preferredFormat)
        .first<{ r2Key: string; format: "avif" | "webp" }>();
      if (variant === null) {
        return null;
      }
      const artifact = await mediaDerivatives.get(variant.r2Key);
      return artifact === null
        ? null
        : { body: artifact.body, etag: artifact.httpEtag, format: variant.format };
    },
  };
}

function internalErrorResponse(error: unknown, context: Context<PublicWorker>) {
  const requestId = context.get("requestId");
  console.error("Unhandled request error", {
    requestId,
    errorCategory: error instanceof Error ? "Error" : "Unknown",
  });
  context.header("Cache-Control", "no-store");
  return context.json(errorResponse("INTERNAL_ERROR", "Internal server error", requestId), 500);
}

export function createPublicApp(
  registerRoutes?: RouteRegistrar,
  configuredContentSource?: PublicContentSource,
) {
  const app = new Hono<PublicWorker>();

  app.use("*", async (context, next) => {
    const requestId = crypto.randomUUID();
    context.set("requestId", requestId);

    try {
      await next();
    } catch (error) {
      context.res = internalErrorResponse(error, context);
    }

    const routeResponse = context.res;
    context.res = new Response(routeResponse.body, routeResponse);
    const responseHeaders = context.res.headers;

    if (context.res.status >= 400) {
      responseHeaders.set("Cache-Control", "no-store");
    }
    responseHeaders.set("X-Request-Id", requestId);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      if (!responseHeaders.has(name)) {
        responseHeaders.set(name, value);
      }
    }
  });

  app.get("/healthz", (context) => {
    context.header("Cache-Control", "no-store");
    return context.json(successResponse({ status: "ok" }, context.get("requestId")));
  });

  app.get("/entry/:slug", async (context) => {
    const pathSlug = context.req.param("slug");
    const explicitMarkdown = pathSlug.endsWith(".md");
    const slug = explicitMarkdown ? pathSlug.slice(0, -3) : pathSlug;
    if (!/^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/.test(slug)) {
      return context.json(errorResponse("NOT_FOUND", "Not found", context.get("requestId")), 404);
    }
    const contentSource =
      configuredContentSource ??
      (context.env.CMS_DB === undefined || context.env.CONTENT_ARTIFACTS === undefined
        ? null
        : createPublicContentSource(
            context.env.CMS_DB,
            context.env.CONTENT_ARTIFACTS,
            context.env.MEDIA_DERIVATIVES,
          ));
    if (contentSource === null) {
      throw new Error("Public content source is unavailable");
    }
    const format =
      explicitMarkdown || requestsMarkdown(context.req.header("Accept")) ? "markdown" : "html";
    const entry = await contentSource.readPublishedEntry(slug, format);
    if (entry === null) {
      return context.json(errorResponse("NOT_FOUND", "Not found", context.get("requestId")), 404);
    }
    if (entry.artifact === null) {
      return context.json(
        errorResponse("INTERNAL_ERROR", "Published content unavailable", context.get("requestId")),
        503,
      );
    }

    const headers = new Headers({
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      "Content-Type":
        format === "markdown" ? "text/markdown; charset=utf-8" : "text/html; charset=utf-8",
      ETag: entry.artifact.etag,
      Link: `<${entry.post.canonicalUrl ?? new URL(`/entry/${entry.post.slug}`, context.req.url).href}>; rel="canonical"`,
      Vary: "Accept",
    });
    if (entry.post.noindex === 1) {
      headers.set("X-Robots-Tag", "noindex, nofollow");
    }
    if (context.req.header("If-None-Match") === entry.artifact.etag) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(entry.artifact.body, { status: 200, headers });
  });

  app.get("/media/:mediaId", async (context) => {
    const parsedId = parseUuidV7(context.req.param("mediaId"));
    if (!parsedId.ok) {
      return context.json(errorResponse("NOT_FOUND", "Not found", context.get("requestId")), 404);
    }
    const contentSource =
      configuredContentSource ??
      (context.env.CMS_DB === undefined || context.env.MEDIA_DERIVATIVES === undefined
        ? null
        : createPublicContentSource(
            context.env.CMS_DB,
            context.env.CONTENT_ARTIFACTS,
            context.env.MEDIA_DERIVATIVES,
          ));
    if (contentSource === null) {
      throw new Error("Public media source is unavailable");
    }
    const preferredFormat = context.req.header("Accept")?.includes("image/avif") ? "avif" : "webp";
    const media = await contentSource.readPublicMedia(parsedId.value, preferredFormat);
    if (media === null) {
      return context.json(errorResponse("NOT_FOUND", "Not found", context.get("requestId")), 404);
    }
    const headers = new Headers({
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": `image/${media.format}`,
      ETag: media.etag,
      Vary: "Accept",
    });
    if (context.req.header("If-None-Match") === media.etag) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(media.body, { status: 200, headers });
  });

  registerRoutes?.(app);

  app.notFound((context) => {
    context.header("Cache-Control", "no-store");
    return context.json(errorResponse("NOT_FOUND", "Not found", context.get("requestId")), 404);
  });

  app.onError(internalErrorResponse);

  return app;
}

const app = createPublicApp();

export default app;
