import { errorResponse, successResponse } from "@tinycms/contracts";
import { type Context, Hono } from "hono";

type PublicWorker = {
  Bindings: {
    CMS_DB?: D1Database;
    CONTENT_ARTIFACTS?: R2Bucket;
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

function createPublicContentSource(database: D1Database, artifacts: R2Bucket): PublicContentSource {
  return {
    readPublishedEntry: async (slug, format) => {
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
      const artifact = await artifacts.get(key);
      return {
        post: {
          slug: post.slug,
          canonicalUrl: post.canonicalUrl,
          noindex: post.noindex,
        },
        artifact: artifact === null ? null : { body: artifact.body, etag: artifact.httpEtag },
      };
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
    const slug = context.req.param("slug");
    if (!/^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/.test(slug)) {
      return context.json(errorResponse("NOT_FOUND", "Not found", context.get("requestId")), 404);
    }
    const contentSource =
      configuredContentSource ??
      (context.env.CMS_DB === undefined || context.env.CONTENT_ARTIFACTS === undefined
        ? null
        : createPublicContentSource(context.env.CMS_DB, context.env.CONTENT_ARTIFACTS));
    if (contentSource === null) {
      throw new Error("Public content source is unavailable");
    }
    const entry = await contentSource.readPublishedEntry(slug, "html");
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
      "Content-Type": "text/html; charset=utf-8",
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
