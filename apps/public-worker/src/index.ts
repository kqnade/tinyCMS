import { errorResponse, successResponse } from "@tinycms/contracts";
import { type Context, Hono } from "hono";

type PublicWorker = {
  Variables: {
    requestId: string;
  };
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

function internalErrorResponse(error: unknown, context: Context<PublicWorker>) {
  const requestId = context.get("requestId");
  console.error("Unhandled request error", {
    requestId,
    errorCategory: error instanceof Error ? "Error" : "Unknown",
  });
  context.header("Cache-Control", "no-store");
  return context.json(errorResponse("INTERNAL_ERROR", "Internal server error", requestId), 500);
}

export function createPublicApp(registerRoutes?: RouteRegistrar) {
  const app = new Hono<PublicWorker>();

  app.use("*", async (context, next) => {
    const requestId = crypto.randomUUID();
    context.set("requestId", requestId);

    try {
      await next();
    } catch (error) {
      context.res = internalErrorResponse(error, context);
    }

    if (context.res.status >= 400) {
      context.header("Cache-Control", "no-store");
    }
    context.header("X-Request-Id", requestId);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      if (!context.res.headers.has(name)) {
        context.header(name, value);
      }
    }
  });

  app.get("/healthz", (context) => {
    context.header("Cache-Control", "no-store");
    return context.json(successResponse({ status: "ok" }, context.get("requestId")));
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
